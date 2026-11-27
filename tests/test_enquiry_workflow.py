"""Integration tests for the hotel enquiry review workflow.

Uses a dedicated PostgreSQL database and mocks only LLM extraction.
All writes are rolled back after each test.
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


@pytest.fixture(scope="session")
def test_engine():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.fail("Set TEST_DATABASE_URL to your separate PostgreSQL test database.")
    if make_url(url).database != "hotel_inquiry_test":
        pytest.fail("TEST_DATABASE_URL must point to 'hotel_inquiry_test'.")

    engine = create_engine(url)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def client(test_engine, monkeypatch):
    connection = test_engine.connect()
    transaction = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")

    def override_get_db():
        yield db

    main_module.app.dependency_overrides[get_db] = override_get_db

    # Pretend that Clerk authenticated a test user for normal workflow tests.
    # This overrides authentication only inside pytest, not in the real app.
    main_module.app.dependency_overrides[auth_module.require_user] = lambda: (
        "test_user_123"
    )
    main_module.app.dependency_overrides[auth_module.require_organization] = lambda: (
        "org_test_workflow"
    )

    main_module.app.dependency_overrides[auth_module.require_organization_user] = (
        lambda: auth_module.OrganizationUser(
            user_id="test_user_123",
            org_id="org_test_workflow",
            is_admin=True,
        )
    )
    # Account for either the current admin dependency name or the renamed one.
    for dep_name in ("require_org_id", "require_org_admin"):
        dependency = getattr(auth_module, dep_name, None)
        if dependency is not None:
            main_module.app.dependency_overrides[dependency] = lambda: (
                "org_test_workflow"
            )

    # All integration test enquiries now belong to this test hotel.
    hotel = Hotel(name="Workflow Test Hotel", clerk_organization_id="org_test_workflow")
    db.add(hotel)
    db.flush()

    # Keep LLM calls out of integration tests: deterministic extraction.
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
        with TestClient(main_module.app) as test_client:
            yield test_client
    finally:
        main_module.app.dependency_overrides.pop(get_db, None)
        main_module.app.dependency_overrides.pop(auth_module.require_user, None)
        main_module.app.dependency_overrides.pop(auth_module.require_organization, None)
        main_module.app.dependency_overrides.pop(
            auth_module.require_organization_user, None
        )
        for dep_name in ("require_org_id", "require_org_admin"):
            dependency = getattr(auth_module, dep_name, None)
            if dependency is not None:
                main_module.app.dependency_overrides.pop(dependency, None)
        db.close()
        transaction.rollback()
        connection.close()


def create_enquiry(client: TestClient) -> int:
    hotels = client.get("/api/v1/hotels")
    assert hotels.status_code == 200, hotels.text
    hotel_id = hotels.json()[0]["id"]
    response = client.post(
        "/api/v1/enquiries",
        json={
            "email": "Please book a double room for two adults, Dec 12–15.",
            "email_date": "2026-11-25",
            "hotel_id": hotel_id,
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["status"] == "needs_review"
    assert data["reservations_count"] == 1
    return data["id"]


def test_create_and_read_enquiry(client):
    enquiry_id = create_enquiry(client)

    listing = client.get("/api/v1/enquiries")
    assert listing.status_code == 200
    assert any(item["id"] == enquiry_id for item in listing.json())

    response = client.get(f"/api/v1/enquiries/{enquiry_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "needs_review"
    assert len(data["reservations"]) == 1
    assert data["reservations"][0]["num_rooms"] == 1
    assert data["reservations"][0]["num_adults"] == 2


def test_edit_then_approve(client):
    enquiry_id = create_enquiry(client)
    detail = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    reservation_id = detail["reservations"][0]["id"]

    edited = client.patch(
        f"/api/v1/reservations/{reservation_id}",
        json={"num_adults": 3},
    )
    assert edited.status_code == 200, edited.text

    updated = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert updated["reservations"][0]["num_adults"] == 3

    approved = client.post(f"/api/v1/enquiries/{enquiry_id}/approve")
    assert approved.status_code == 200, approved.text
    detail_after = client.get(f"/api/v1/enquiries/{enquiry_id}").json()
    assert detail_after["status"] == "approved"

    # Approved data should not be silently changed or deleted.
    assert (
        client.patch(
            f"/api/v1/reservations/{reservation_id}", json={"num_adults": 4}
        ).status_code
        == 409
    )
    assert client.delete(f"/api/v1/enquiries/{enquiry_id}").status_code == 409


def test_delete_unapproved_enquiry(client):
    enquiry_id = create_enquiry(client)
    response = client.delete(f"/api/v1/enquiries/{enquiry_id}")
    assert response.status_code == 204, response.text
    assert client.get(f"/api/v1/enquiries/{enquiry_id}").status_code == 404


# --- Failure and validation scenarios ---


def test_missing_enquiry_returns_404(client):
    missing_id = 999999999
    assert client.get(f"/api/v1/enquiries/{missing_id}").status_code == 404
    assert client.post(f"/api/v1/enquiries/{missing_id}/approve").status_code == 404
    assert client.delete(f"/api/v1/enquiries/{missing_id}").status_code == 404


def test_missing_reservation_returns_404(client):
    response = client.patch("/api/v1/reservations/999999999", json={"num_adults": 2})
    assert response.status_code == 404


def test_cannot_approve_twice(client):
    enquiry_id = create_enquiry(client)
    assert client.post(f"/api/v1/enquiries/{enquiry_id}/approve").status_code == 200
    assert client.post(f"/api/v1/enquiries/{enquiry_id}/approve").status_code == 409


def test_invalid_create_request_returns_422(client):
    response = client.post(
        "/api/v1/enquiries", json={"email": "", "email_date": "2026-11-25"}
    )
    assert response.status_code == 422


def test_invalid_reservation_update_returns_422(client):
    enquiry_id = create_enquiry(client)
    reservation_id = client.get(f"/api/v1/enquiries/{enquiry_id}").json()[
        "reservations"
    ][0]["id"]

    # Number of rooms must be positive, and number of adults cannot be negative.
    assert (
        client.patch(
            f"/api/v1/reservations/{reservation_id}", json={"num_rooms": 0}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/v1/reservations/{reservation_id}", json={"num_adults": -1}
        ).status_code
        == 422
    )
    assert (
        client.patch(f"/api/v1/reservations/{reservation_id}", json={}).status_code
        == 422
    )


def test_ai_connection_failure_returns_503(client, monkeypatch):
    import httpx
    from openai import APIConnectionError

    def fail_extract(email, email_date):
        raise APIConnectionError(
            message="Simulated network failure",
            request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
        )

    monkeypatch.setattr(main_module, "extract_room_bookings", fail_extract)
    response = client.post(
        "/api/v1/reservations/extract",
        json={"email": "A room for two adults", "email_date": "2026-11-25"},
    )
    assert response.status_code == 503, response.text


def test_ai_parser_failure_returns_502(client, monkeypatch):
    from langchain_core.exceptions import OutputParserException

    def fail_extract(email, email_date):
        raise OutputParserException("Simulated invalid AI output")

    monkeypatch.setattr(main_module, "extract_room_bookings", fail_extract)
    response = client.post(
        "/api/v1/reservations/extract",
        json={"email": "A room for two adults", "email_date": "2026-11-25"},
    )
    assert response.status_code == 502, response.text


# --- Real authentication-gate checks (no require_user override) ---


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/v1/enquiries", None),
        ("GET", "/api/v1/enquiries/1", None),
        (
            "POST",
            "/api/v1/enquiries",
            {"email": "One room for two adults", "email_date": "2026-11-26"},
        ),
        ("POST", "/api/v1/enquiries/1/approve", None),
        ("PATCH", "/api/v1/reservations/1", {"num_adults": 2}),
        ("DELETE", "/api/v1/enquiries/1", None),
        (
            "POST",
            "/api/v1/reservations/extract",
            {"email": "One room for two adults", "email_date": "2026-11-26"},
        ),
    ],
)
def test_requires_authentication(method, path, body):
    # No dependency override and no Authorization header: real auth must deny.
    with TestClient(main_module.app) as anonymous_client:
        response = anonymous_client.request(method, path, json=body)

    assert response.status_code == 401, response.text


def test_invalid_clerk_token_is_rejected():
    # Calls the real require_user dependency; uses no actual Clerk login.
    with TestClient(main_module.app) as anonymous_client:
        response = anonymous_client.get(
            "/api/v1/enquiries",
            headers={"Authorization": "Bearer not.a.real.jwt"},
        )

    assert response.status_code == 401, response.text


def test_health_stays_public():
    with TestClient(main_module.app) as anonymous_client:
        response = anonymous_client.get("/health")

    assert response.status_code == 200, response.text
