from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from langchain_core.exceptions import OutputParserException
from openai import APIConnectionError, InternalServerError, RateLimitError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from side_project_v1.app.db.models import Enquiry, Reservation, ReviewEvent
from side_project_v1.app.db.session import get_db
from side_project_v1.app.schemas.reservation import UpdateReservation
from side_project_v1.app.services.enquiry_service import save_enquiry
from side_project_v1.app.services.room_booking_agent import (
    RoomBooking,
    extract_room_bookings,
)

app = FastAPI()


class EmailRequest(BaseModel):
    email: str = Field(min_length=1)
    email_date: date


@app.get("/health")
def health_check():
    return {"message": "OK"}


@app.get("/")
def read_root():
    return {"message": "Hello, World!"}


@app.post("/api/v1/reservations/extract", response_model=RoomBooking)
def extract_reservations(request: EmailRequest):
    try:
        return extract_room_bookings(request.email, request.email_date)
    except (APIConnectionError, RateLimitError, InternalServerError) as exc:
        raise HTTPException(
            status_code=503,
            detail="AI service temporarily unavailable.",
        ) from exc

    except (OutputParserException, ValidationError) as exc:
        raise HTTPException(
            status_code=502,
            detail="AI returned invalid structured data.",
        ) from exc


@app.post("/api/v1/enquiries", status_code=201)
def create_enquiry(request: EmailRequest, session: Session = Depends(get_db)):
    booking = extract_room_bookings(request.email, request.email_date)
    enquiry = save_enquiry(session, request.email, request.email_date, booking)
    return {
        "id": enquiry.id,
        "status": enquiry.status,
        "reservations_count": len(booking.reservations),
    }


@app.get("/api/v1/enquiries")
def get_enquiries(session: Session = Depends(get_db)):
    enquiries = session.scalars(
        select(Enquiry).order_by(Enquiry.created_at.desc())
    ).all()

    return [
        {
            "id": e.id,
            "email": e.email_content,
            "status": e.status,
            "created_at": e.created_at,
        }
        for e in enquiries
    ]


@app.get("/api/v1/enquiries/{enquiry_id}", status_code=200)
def get_enquiry(enquiry_id: int, session: Session = Depends(get_db)):

    enquiry = session.get(Enquiry, enquiry_id)
    if not enquiry:
        raise HTTPException(status_code=404, detail="Enquiry not found")

    return {
        "id": enquiry.id,
        "status": enquiry.status,
        "email": enquiry.email_content,
        "reservations": [
            {
                "id": r.id,
                "arrival_date": r.arrival_date,
                "departure_date": r.departure_date,
                "num_rooms": r.num_rooms,
                "num_adults": r.num_adults,
            }
            for r in enquiry.reservations
        ],
    }


@app.post("/api/v1/enquiries/{enquiry_id}/approve")
def approve_enquiry(enquiry_id: int, session: Session = Depends(get_db)):
    enquiry = session.get(Enquiry, enquiry_id)
    if not enquiry:
        raise HTTPException(status_code=404, detail="Enquiry not found")

    if enquiry.status == "approved":
        raise HTTPException(
            status_code=409,
            detail="Enquiry already approved",
        )

    enquiry.status = "approved"

    review_event = ReviewEvent(
        enquiry_id=enquiry_id,
        action="approved",
        changes={},
    )
    session.add(review_event)
    session.commit()
    return {
        "id": enquiry.id,
        "status": enquiry.status,
    }


@app.patch("/api/v1/reservations/{reservation_id}")
def update_reservation(
    reservation_id: int,
    request: UpdateReservation,
    session: Session = Depends(get_db),
):
    reservation = session.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    enquiry = session.get(Enquiry, reservation.enquiry_id)

    if enquiry.status == "approved":
        raise HTTPException(
            status_code=409,
            detail="Enquiry already approved",
        )

    updates = request.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=422,
            detail="No updates provided",
        )

    changes = {}

    for field, value in updates.items():
        old_value = getattr(reservation, field)
        if old_value != value:
            changes[field] = {
                "old": old_value,
                "new": value,
            }
        setattr(reservation, field, value)

    if changes:
        session.add(
            ReviewEvent(
                enquiry=enquiry,
                action="corrected",
                changes={
                    "reservation_id": reservation_id,
                    "fields": jsonable_encoder(changes),
                },
            )
        )
    session.commit()
    return {
        "reservation_id": reservation_id,
        "changes": changes,
    }


@app.delete("/api/v1/enquiries/{enquiry_id}", status_code=204)
def delete_enquiry(
    enquiry_id: int,
    session: Session = Depends(get_db),
):
    enquiry = session.get(Enquiry, enquiry_id)

    if enquiry is None:
        raise HTTPException(404, "Enquiry not found")

    if enquiry.status == "approved":
        raise HTTPException(409, "Cannot delete approved enquiry")

    session.delete(enquiry)
    session.commit()
