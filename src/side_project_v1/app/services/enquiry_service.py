from datetime import date

from sqlalchemy.orm import Session

from side_project_v1.app.db.models import Enquiry, Reservation
from side_project_v1.app.schemas.reservation import RoomBooking


def save_enquiry(
    session: Session,
    email: str,
    email_date: date,
    booking: RoomBooking,
) -> Enquiry:
    enquiry = Enquiry(
        email_content=email,
        email_date=email_date,
        status="needs_review",
        raw_extraction=booking.model_dump(mode="json"),
        reservations=[
            Reservation(**reservation.model_dump())
            for reservation in booking.reservations
        ],
    )
    session.add(enquiry)
    session.commit()
    session.refresh(enquiry)
    return enquiry
