"""Cross-organization authorization tests for the hotel SaaS.

Save as tests/test_tenant_isolation.py in the existing project.
Run only against the dedicated hotel_inquiry_test PostgreSQL database.
Clerk identity and AI extraction are replaced with deterministic test values.
"""

import os
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from side_project_v1.app import auth as auth_module
from side_project_v1.app import main as main_module
from side_project_v1.app.db.models import Base, Hotel
from side_project_v1.app.db.session import get_db
from side_project_v1.app.schemas.reservation import RoomBooking, RoomPeriod


@pytest.fixture
def tenants(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or make_url(url).database != "hotel_inquiry_test":
        pytest.fail("Set TEST_DATABASE_URL to the separate hotel_inquiry_test database")

    engine = create_engine(url)
    Base.metadata.create_all(engine)
    connection = engine.connect()
    transaction = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    actor = {"org_id": "org_test_alpha", "user_id": "user_test_alpha"}

    def override_db():
        yield db

    app = main_module.app
    original_overrides = app.dependency_overrides.copy()
    app.dependency_overrides[get_db] = override_db

    # The dependency instances used by the routes are overridden, not JWT parsing.
    # These tests exercise organization WHERE clauses, not Clerk cryptography.
    app.dependency_overrides[auth_module.require_user] = lambda: actor["user_id"]
    app.dependency_overrides[auth_module.require_organization] = lambda: actor["org_id"]
    app.dependency_overrides[auth_module.require_organization_user] = lambda: (
        auth_module.OrganizationUser(
            user_id=actor["user_id"],
            org_id=actor["org_id"],
            is_admin=True,
        )
    )
    # Support either the original or renamed admin dependency in the user's app.
    for dep_name in ("require_org_id", "require_org_admin"):
        dependency = getattr(auth_module, dep_name, None)
        if dependency is not None:
            app.dependency_overrides[dependency] = lambda: actor["org_id"]

    def fake_extract(email: str, email_date: date) -> RoomBooking:
        return RoomBooking(
            reservations=[
                RoomPeriod(
                    arrival_date=date(2026, 12, 12),
                    departure_date=date(2026, 12, 15),
                    num_rooms=1,
                    num_adults=2,
                    num_children=None,
                    children_ages=[],
                    room_type="double",
                )
            ]
        )

    monkeypatch.setattr(main_module, "extract_room_bookings", fake_extract)

    try:
        hotel_a = Hotel(name="Alpha Hotel", clerk_organization_id="org_test_alpha")
        hotel_b = Hotel(name="Beta Hotel", clerk_organization_id="org_test_beta")
        db.add_all([hotel_a, hotel_b])
        db.flush()

        with TestClient(app) as client:
            # Create one enquiry using each organization's verified context.
            enquiries = {}
            for org, hotel in (
                ("org_test_alpha", hotel_a),
                ("org_test_beta", hotel_b),
            ):
                actor["org_id"] = org
                actor["user_id"] = (
                    "user_test_alpha" if org == "org_test_alpha" else "user_test_beta"
                )
                response = client.post(
                    "/api/v1/enquiries",
                    json={
                        "email": "Please book one double room, Dec 12–15.",
                        "email_date": "2026-11-26",
                        "hotel_id": hotel.id,
                    },
                )
                assert response.status_code == 201, response.text
                enquiries[org] = response.json()["id"]

            actor.update(org_id="org_test_alpha", user_id="user_test_alpha")
            yield client, actor, hotel_a.id, hotel_b.id, enquiries
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)
        db.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


def test_each_org_sees_only_its_own_enquiries(tenants):
    client, actor, _, _, enquiries = tenants
    for org in ("org_test_alpha", "org_test_beta"):
        actor["org_id"] = org
        response = client.get("/api/v1/enquiries")
        assert response.status_code == 200, response.text
        actual_ids = {entry["id"] for entry in response.json()}
        assert enquiries[org] in actual_ids
        other_org = "org_test_beta" if org == "org_test_alpha" else "org_test_alpha"
        assert enquiries[other_org] not in actual_ids


def test_org_cannot_read_another_orgs_enquiry(tenants):
    client, actor, _, _, enquiries = tenants
    actor["org_id"] = "org_test_alpha"
    response = client.get(f"/api/v1/enquiries/{enquiries['org_test_beta']}")
    assert response.status_code == 404, response.text


def test_org_cannot_edit_approve_or_delete_another_orgs_enquiry(tenants):
    client, actor, _, _, enquiries = tenants
    beta_id = enquiries["org_test_beta"]
    actor["org_id"] = "org_test_beta"
    detail = client.get(f"/api/v1/enquiries/{beta_id}")
    assert detail.status_code == 200, detail.text
    reservation_id = detail.json()["reservations"][0]["id"]

    actor["org_id"] = "org_test_alpha"
    response = client.patch(
        f"/api/v1/reservations/{reservation_id}", json={"num_adults": 3}
    )
    assert response.status_code == 404, response.text
    response = client.post(f"/api/v1/enquiries/{beta_id}/approve")
    assert response.status_code == 404, response.text
    response = client.delete(f"/api/v1/enquiries/{beta_id}")
    assert response.status_code == 404, response.text

    # Nothing in Beta's data was changed by Alpha's attempts.
    actor["org_id"] = "org_test_beta"
    detail_after = client.get(f"/api/v1/enquiries/{beta_id}")
    assert detail_after.status_code == 200
    assert detail_after.json()["status"] == "needs_review"
    assert detail_after.json()["reservations"][0]["num_adults"] == 2


def test_org_cannot_create_enquiry_for_foreign_hotel(tenants):
    client, actor, _, beta_hotel_id, _ = tenants
    actor["org_id"] = "org_test_alpha"
    response = client.post(
        "/api/v1/enquiries",
        json={
            "email": "One double room",
            "email_date": "2026-11-26",
            "hotel_id": beta_hotel_id,
        },
    )
    assert response.status_code == 404, response.text


def test_org_cannot_list_another_orgs_hotels(tenants):
    client, actor, alpha_hotel_id, beta_hotel_id, _ = tenants
    actor["org_id"] = "org_test_alpha"
    response = client.get("/api/v1/hotels")
    assert response.status_code == 200, response.text
    ids = {hotel["id"] for hotel in response.json()}
    assert alpha_hotel_id in ids
    assert beta_hotel_id not in ids


def test_org_can_access_its_own_enquiry(tenants):
    client, actor, _, _, enquiries = tenants
    actor["org_id"] = "org_test_alpha"
    response = client.get(f"/api/v1/enquiries/{enquiries['org_test_alpha']}")
    assert response.status_code == 200, response.text
