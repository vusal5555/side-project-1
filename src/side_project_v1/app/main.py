from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from langchain_core.exceptions import OutputParserException
from openai import APIConnectionError, InternalServerError, RateLimitError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from side_project_v1.app.auth import (
    require_org_admin,
    require_organization,
    require_user,
)
from side_project_v1.app.db.models import Enquiry, Hotel, Reservation, ReviewEvent
from side_project_v1.app.db.session import get_db
from side_project_v1.app.schemas.reservation import UpdateReservation
from side_project_v1.app.services.enquiry_service import save_enquiry
from side_project_v1.app.services.room_booking_agent import (
    RoomBooking,
    extract_room_bookings,
)

app = FastAPI()


class CreateHotel(BaseModel):
    name: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class EmailRequest(BaseModel):
    email: str = Field(min_length=1)
    email_date: date


class CreateEnquiryRequest(EmailRequest):
    hotel_id: int = Field(gt=0)


@app.get("/health")
def health_check():
    return {"message": "OK"}


@app.get("/")
def read_root():
    return {"message": "Hello, World!"}


@app.post(
    "/api/v1/reservations/extract",
    response_model=RoomBooking,
    dependencies=[Depends(require_user)],
)
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


@app.post(
    "/api/v1/enquiries",
    status_code=201,
    dependencies=[Depends(require_user)],
)
def create_enquiry(
    request: CreateEnquiryRequest,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):

    hotel = session.scalar(
        select(Hotel).where(
            Hotel.id == request.hotel_id,
            Hotel.clerk_organization_id == org_id,
        )
    )

    if hotel is None:
        raise HTTPException(
            status_code=404,
            detail="Hotel not found",
        )
    booking = extract_room_bookings(request.email, request.email_date)
    enquiry = save_enquiry(
        session, hotel.id, request.email, request.email_date, booking
    )
    return {
        "id": enquiry.id,
        "hotel_id": hotel.id,
        "status": enquiry.status,
        "reservations_count": len(booking.reservations),
    }


@app.get("/api/v1/enquiries", dependencies=[Depends(require_user)])
def get_enquiries(
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):
    enquiries = session.scalars(
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(Hotel.clerk_organization_id == org_id)
        .order_by(Enquiry.created_at.desc())
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


@app.get(
    "/api/v1/enquiries/{enquiry_id}",
    status_code=200,
    dependencies=[Depends(require_user)],
)
def get_enquiry(
    enquiry_id: int,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):

    enquiry = session.scalar(
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(
            Enquiry.id == enquiry_id,
            Hotel.clerk_organization_id == org_id,
        )
    )

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


@app.post(
    "/api/v1/enquiries/{enquiry_id}/approve", dependencies=[Depends(require_user)]
)
def approve_enquiry(
    enquiry_id: int,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):
    enquiry = session.scalar(
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(
            Enquiry.id == enquiry_id,
            Hotel.clerk_organization_id == org_id,
        )
    )
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


@app.patch(
    "/api/v1/reservations/{reservation_id}", dependencies=[Depends(require_user)]
)
def update_reservation(
    reservation_id: int,
    request: UpdateReservation,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):
    reservation = session.get(Reservation, reservation_id)
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    enquiry = session.scalar(
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(
            Enquiry.id == reservation.enquiry_id,
            Hotel.clerk_organization_id == org_id,
        )
    )

    if enquiry is None:
        raise HTTPException(
            status_code=404,
            detail="Reservation not found",
        )

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


@app.delete(
    "/api/v1/enquiries/{enquiry_id}",
    status_code=204,
    dependencies=[Depends(require_user)],
)
def delete_enquiry(
    enquiry_id: int,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):
    enquiry = session.scalar(
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(
            Enquiry.id == enquiry_id,
            Hotel.clerk_organization_id == org_id,
        )
    )

    if enquiry is None:
        raise HTTPException(404, "Enquiry not found")

    if enquiry.status == "approved":
        raise HTTPException(409, "Cannot delete approved enquiry")

    session.delete(enquiry)
    session.commit()
    return {"message": "Enquiry deleted successfully"}


@app.get("/api/v1/hotels")
def get_hotels(
    session: Session = Depends(get_db),
    org_id: str = Depends(require_organization),
):
    hotels = session.scalars(
        select(Hotel).where(Hotel.clerk_organization_id == org_id)
    ).all()

    return [{"id": hotel.id, "name": hotel.name} for hotel in hotels]


@app.post("/api/v1/hotels", status_code=201)
def create_hotel(
    request: CreateHotel,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    hotel = Hotel(name=request.name, clerk_organization_id=org_id)
    session.add(hotel)
    session.commit()
    session.refresh(hotel)
    return {"id": hotel.id, "name": hotel.name}
