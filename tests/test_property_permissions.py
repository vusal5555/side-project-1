"""Property-level authorization integration tests.

Run with TEST_DATABASE_URL pointing to hotel_inquiry_test only.
Clerk identity and AI extraction are simulated; FastAPI routes and DB queries are real.
"""

import os
from datetime import date

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from side_project_v1.app import auth as auth_module
from side_project_v1.app import main as main_module
from side_project_v1.app.db.models import (
    Base,
    Enquiry,
    Hotel,
    HotelStaffAccess,
    Reservation,
)
from side_project_v1.app.db.session import get_db
from side_project_v1.app.schemas.reservation import RoomBooking, RoomPeriod


@pytest.fixture
def property_case(monkeypatch):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url or make_url(url).database != "hotel_inquiry_test":
        pytest.fail("TEST_DATABASE_URL must point to hotel_inquiry_test")

    engine = create_engine(url)
    Base.metadata.create_all(engine)
    connection = engine.connect()
    transaction = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    app = main_module.app
    previous_overrides = app.dependency_overrides.copy()

    actor = {
        "user_id": "user_property_admin",
        "org_id": "org_property_alpha",
        "is_admin": True,
    }

    def override_db():
        yield db

    def override_org_user():
        return auth_module.OrganizationUser(**actor)

    def override_admin():
        if not actor["is_admin"]:
            raise HTTPException(403, "Organization admin required")
        return actor["org_id"]

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[auth_module.require_organization_user] = override_org_user
    app.dependency_overrides[auth_module.require_user] = lambda: actor["user_id"]
    app.dependency_overrides[auth_module.require_organization] = lambda: actor["org_id"]
    for name in ("require_org_admin", "require_org_id"):
        dependency = getattr(auth_module, name, None)
        if dependency is not None:
            app.dependency_overrides[dependency] = override_admin

    def fake_extract(email: str, email_date: date) -> RoomBooking:
        return RoomBooking(
            reservations=[
                RoomPeriod(
                    arrival_date=date(2026, 12, 10),
                    departure_date=date(2026, 12, 12),
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
        hotel_a = Hotel(name="Property A", clerk_organization_id="org_property_alpha")
        hotel_b = Hotel(name="Property B", clerk_organization_id="org_property_alpha")
        hotel_foreign = Hotel(name="Foreign Property", clerk_organization_id="org_property_beta")
        db.add_all([hotel_a, hotel_b, hotel_foreign])
        db.flush()

        # This employee belongs to Alpha but is assigned only to Property A.
        db.add(HotelStaffAccess(hotel_id=hotel_a.id, clerk_user_id="user_property_employee"))
        db.flush()

        with TestClient(app) as client:
            def create_enquiry(hotel_id: int) -> int:
                response = client.post(
                    "/api/v1/enquiries",
                    json={
                        "hotel_id": hotel_id,
                        "email": "One double room for two adults",
                        "email_date": "2026-11-27",
                    },
                )
                assert response.status_code == 201, response.text
                return response.json()["id"]

            enquiry_a = create_enquiry(hotel_a.id)
            enquiry_b = create_enquiry(hotel_b.id)
            actor["org_id"] = "org_property_beta"
            enquiry_foreign = create_enquiry(hotel_foreign.id)
            actor.update(
                user_id="user_property_employee",
                org_id="org_property_alpha",
                is_admin=False,
            )

            reservation_b = db.scalar(
                select(Reservation).where(Reservation.enquiry_id == enquiry_b)
            )
            assert reservation_b is not None

            yield {
                "client": client,
                "actor": actor,
                "db": db,
                "hotels": (hotel_a.id, hotel_b.id, hotel_foreign.id),
                "enquiries": (enquiry_a, enquiry_b, enquiry_foreign),
                "reservation_b": reservation_b.id,
            }
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous_overrides)
        db.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


def test_employee_sees_only_assigned_hotel_and_enquiries(property_case):
    case = property_case
    hotel_a, hotel_b, _ = case["hotels"]
    enquiry_a, enquiry_b, _ = case["enquiries"]
    client = case["client"]

    hotels = client.get("/api/v1/hotels")
    assert hotels.status_code == 200, hotels.text
    assert {h["id"] for h in hotels.json()} == {hotel_a}

    enquiries = client.get("/api/v1/enquiries")
    assert enquiries.status_code == 200, enquiries.text
    ids = {e["id"] for e in enquiries.json()}
    assert enquiry_a in ids
    assert enquiry_b not in ids


def test_employee_can_read_own_but_not_unassigned_enquiry(property_case):
    case = property_case
    enquiry_a, enquiry_b, enquiry_foreign = case["enquiries"]
    client = case["client"]
    assert client.get(f"/api/v1/enquiries/{enquiry_a}").status_code == 200
    assert client.get(f"/api/v1/enquiries/{enquiry_b}").status_code == 404
    assert client.get(f"/api/v1/enquiries/{enquiry_foreign}").status_code == 404


def test_employee_can_create_only_for_assigned_hotel(property_case):
    case = property_case
    hotel_a, hotel_b, hotel_foreign = case["hotels"]
    client = case["client"]
    payload = {"email": "One room", "email_date": "2026-11-27"}

    own = client.post("/api/v1/enquiries", json={**payload, "hotel_id": hotel_a})
    assert own.status_code == 201, own.text
    other = client.post("/api/v1/enquiries", json={**payload, "hotel_id": hotel_b})
    assert other.status_code == 404, other.text
    foreign = client.post("/api/v1/enquiries", json={**payload, "hotel_id": hotel_foreign})
    assert foreign.status_code == 404, foreign.text


def test_employee_cannot_edit_approve_or_delete_unassigned_enquiry(property_case):
    case = property_case
    client = case["client"]
    _, enquiry_b, _ = case["enquiries"]
    reservation_b = case["reservation_b"]

    assert client.patch(
        f"/api/v1/reservations/{reservation_b}", json={"num_adults": 3}
    ).status_code == 404
    assert client.post(f"/api/v1/enquiries/{enquiry_b}/approve").status_code == 404
    assert client.delete(f"/api/v1/enquiries/{enquiry_b}").status_code == 404

    # Denied operations must not mutate the enquiry or its reservation.
    enquiry = case["db"].get(Enquiry, enquiry_b)
    reservation = case["db"].get(Reservation, reservation_b)
    case["db"].refresh(enquiry)
    case["db"].refresh(reservation)
    assert enquiry.status == "needs_review"
    assert reservation.num_adults == 2


def test_employee_can_edit_and_approve_assigned_enquiry(property_case):
    case = property_case
    client = case["client"]
    enquiry_a, _, _ = case["enquiries"]
    detail = client.get(f"/api/v1/enquiries/{enquiry_a}")
    assert detail.status_code == 200, detail.text
    reservation_a = detail.json()["reservations"][0]["id"]

    updated = client.patch(
        f"/api/v1/reservations/{reservation_a}", json={"num_adults": 3}
    )
    assert updated.status_code == 200, updated.text
    approved = client.post(f"/api/v1/enquiries/{enquiry_a}/approve")
    assert approved.status_code == 200, approved.text


def test_admin_sees_all_organization_hotels_but_not_foreign(property_case):
    case = property_case
    actor = case["actor"]
    actor.update(user_id="user_property_admin", is_admin=True)
    hotel_a, hotel_b, hotel_foreign = case["hotels"]
    enquiry_a, enquiry_b, enquiry_foreign = case["enquiries"]

    hotels = case["client"].get("/api/v1/hotels")
    assert hotels.status_code == 200, hotels.text
    assert {h["id"] for h in hotels.json()} == {hotel_a, hotel_b}

    enquiries = case["client"].get("/api/v1/enquiries")
    assert enquiries.status_code == 200, enquiries.text
    assert {e["id"] for e in enquiries.json()} >= {enquiry_a, enquiry_b}
    assert enquiry_foreign not in {e["id"] for e in enquiries.json()}


def test_employee_cannot_revoke_staff_access(property_case):
    case = property_case
    hotel_a, _, _ = case["hotels"]
    response = case["client"].delete(
        f"/api/v1/hotels/{hotel_a}/staff/user_property_employee"
    )
    assert response.status_code == 403, response.text


def test_admin_can_revoke_access_and_employee_loses_it(property_case):
    case = property_case
    client = case["client"]
    actor = case["actor"]
    hotel_a, _, _ = case["hotels"]
    enquiry_a, _, _ = case["enquiries"]

    actor.update(user_id="user_property_admin", is_admin=True)
    removed = client.delete(
        f"/api/v1/hotels/{hotel_a}/staff/user_property_employee"
    )
    assert removed.status_code == 204, removed.text

    actor.update(user_id="user_property_employee", is_admin=False)
    hotels = client.get("/api/v1/hotels")
    assert hotels.status_code == 200, hotels.text
    assert hotels.json() == []
    assert client.get(f"/api/v1/enquiries/{enquiry_a}").status_code == 404
    assert client.get("/api/v1/enquiries").json() == []
