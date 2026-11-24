from datetime import date

import httpx
from fastapi.testclient import TestClient
from langchain_core.exceptions import OutputParserException
from openai import APIConnectionError

from side_project_v1.app import main
from side_project_v1.app.schemas.reservation import RoomBooking

client = TestClient(main.app)


def test_successful_extraction(monkeypatch):
    def fake_extraction(email: str, email_date: str):
        assert email == "I need 2 rooms."
        assert email_date == date(2026, 11, 23)

        return RoomBooking(
            reservations=[
                {
                    "arrival_date": None,
                    "departure_date": None,
                    "num_rooms": 2,
                    "num_adults": None,
                    "num_children": None,
                    "children_ages": [],
                    "room_type": None,
                }
            ]
        )

    monkeypatch.setattr(main, "extract_room_bookings", fake_extraction)

    response = client.post(
        "/api/v1/reservations/extract",
        json={
            "email": "I need 2 rooms.",
            "email_date": "2026-11-23",
        },
    )

    assert response.status_code == 200
    assert response.json()["reservations"][0]["num_rooms"] == 2


def test_invalid_email():
    response = client.post(
        "/api/v1/reservations/extract",
        json={
            "email": "",
            "email_date": "2026-11-23",
        },
    )

    assert response.status_code == 422


def test_ai_connection_failure(monkeypatch):
    def fake_extraction(email: str, email_date: str):
        raise APIConnectionError(
            request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        )

    monkeypatch.setattr(main, "extract_room_bookings", fake_extraction)

    response = client.post(
        "/api/v1/reservations/extract",
        json={
            "email": "I need 2 rooms.",
            "email_date": "2026-11-23",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == ("AI service temporarily unavailable.")


def test_invalid_ai_output(monkeypatch):

    def fake_extraction(email, email_date):
        raise OutputParserException("Invalid structured output")

    monkeypatch.setattr(
        main,
        "extract_room_bookings",
        fake_extraction,
    )

    response = client.post(
        "/api/v1/reservations/extract",
        json={
            "email": "I need two rooms.",
            "email_date": "2026-11-23",
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == ("AI returned invalid structured data.")
