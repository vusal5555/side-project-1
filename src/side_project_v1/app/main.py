import os
from datetime import date

from clerk_backend_api import Clerk
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.encoders import jsonable_encoder
from langchain_core.exceptions import OutputParserException
from openai import APIConnectionError, InternalServerError, RateLimitError
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    PositiveInt,
    ValidationError,
    field_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql import delete

from side_project_v1.app.auth import (
    OrganizationUser,
    require_org_admin,
    require_organization_user,
    require_user,
)
from side_project_v1.app.db.models import (
    Enquiry,
    Hotel,
    HotelStaffAccess,
    Reservation,
    ReviewEvent,
)
from side_project_v1.app.db.session import get_db
from side_project_v1.app.schemas.reservation import UpdateReservation
from side_project_v1.app.services.enquiry_service import save_enquiry
from side_project_v1.app.services.hotel_access import check_hotel_access
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


class AssignHotelStaff(BaseModel):
    clerk_user_id: str = Field(min_length=1)


class SetStaffHotels(BaseModel):
    hotel_ids: list[PositiveInt] = Field(max_length=10000)

    model_config = ConfigDict(extra="forbid")


class BulkCreateHotelsRequest(BaseModel):
    names: list[str] = Field(min_length=1, max_length=500)
    model_config = ConfigDict(extra="forbid")

    @field_validator("names")
    @classmethod
    def clean_names(cls, names: list[str]) -> list[str]:
        cleaned = [name.strip() for name in names]
        if any(not name or len(name) > 255 for name in cleaned):
            raise ValueError("Each hotel name must be 1-255 characters long")
        if len({name.casefold() for name in cleaned}) != len(cleaned):
            raise ValueError("Duplicate hotel names in request")
        return cleaned


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
    user: OrganizationUser = Depends(require_organization_user),
):

    hotel = check_hotel_access(
        session=session,
        hotel_id=request.hotel_id,
        user=user,
    )

    booking = extract_room_bookings(request.email, request.email_date)
    print("AI EXTRACTION:", booking.model_dump(mode="json"))
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
    user: OrganizationUser = Depends(require_organization_user),
):
    query = (
        select(Enquiry)
        .join(Hotel, Enquiry.hotel_id == Hotel.id)
        .where(Hotel.clerk_organization_id == user.org_id)
    )

    if not user.is_admin:
        query = query.join(
            HotelStaffAccess,
            Hotel.id == HotelStaffAccess.hotel_id,
        ).where(HotelStaffAccess.clerk_user_id == user.user_id)

    enquiries = session.scalars(query.order_by(Enquiry.created_at.desc())).all()

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
    user: OrganizationUser = Depends(require_organization_user),
):

    enquiry = session.get(Enquiry, enquiry_id)

    if enquiry is None or enquiry.hotel_id is None:
        raise HTTPException(
            status_code=404,
            detail="Enquiry not found",
        )

    check_hotel_access(
        session=session,
        hotel_id=enquiry.hotel_id,
        user=user,
    )

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
    user: OrganizationUser = Depends(require_organization_user),
):
    enquiry = session.get(Enquiry, enquiry_id)

    if enquiry is None or enquiry.hotel_id is None:
        raise HTTPException(
            status_code=404,
            detail="Enquiry not found",
        )

    check_hotel_access(
        session=session,
        hotel_id=enquiry.hotel_id,
        user=user,
    )

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
    user: OrganizationUser = Depends(require_organization_user),
):
    reservation = session.get(Reservation, reservation_id)

    if reservation is None:
        raise HTTPException(status_code=404, detail="Reservation not found")

    enquiry = session.get(Enquiry, reservation.enquiry_id)

    if enquiry is None or enquiry.hotel_id is None:
        raise HTTPException(
            status_code=404,
            detail="Reservation not found",
        )

    check_hotel_access(
        session=session,
        hotel_id=enquiry.hotel_id,
        user=user,
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
    user: OrganizationUser = Depends(require_organization_user),
):
    enquiry = session.get(Enquiry, enquiry_id)

    if enquiry is None or enquiry.hotel_id is None:
        raise HTTPException(
            status_code=404,
            detail="Enquiry not found",
        )

    check_hotel_access(
        session=session,
        hotel_id=enquiry.hotel_id,
        user=user,
    )

    if enquiry.status == "approved":
        raise HTTPException(409, "Cannot delete approved enquiry")

    session.delete(enquiry)
    session.commit()
    return {"message": "Enquiry deleted successfully"}


@app.get("/api/v1/hotels")
def get_hotels(
    session: Session = Depends(get_db),
    user: OrganizationUser = Depends(require_organization_user),
):
    query = select(Hotel).where(Hotel.clerk_organization_id == user.org_id)

    if not user.is_admin:
        query = query.join(
            HotelStaffAccess,
            HotelStaffAccess.hotel_id == Hotel.id,
        ).where(HotelStaffAccess.clerk_user_id == user.user_id)

    hotels = session.scalars(query).all()

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


@app.post("/api/v1/hotels/{hotel_id}/staff", status_code=201)
def add_hotel_staff(
    hotel_id: int,
    request: AssignHotelStaff,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):

    hotel = session.scalar(
        select(Hotel).where(
            Hotel.id == hotel_id,
            Hotel.clerk_organization_id == org_id,
        )
    )
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")

    with Clerk(bearer_auth=os.environ["CLERK_SECRET_KEY"]) as clerk:
        memberships = clerk.organization_memberships.list(
            organization_id=org_id,
            user_id=[request.clerk_user_id],
            limit=1,
        )

    is_member = any(
        m.public_user_data is not None
        and m.public_user_data.user_id == request.clerk_user_id
        for m in memberships.data
    )

    if not is_member:
        raise HTTPException(
            status_code=404, detail="User is not a member of the organization"
        )

    existing = session.scalar(
        select(HotelStaffAccess).where(
            HotelStaffAccess.hotel_id == hotel_id,
            HotelStaffAccess.clerk_user_id == request.clerk_user_id,
        )
    )

    if existing:
        raise HTTPException(status_code=409, detail="Employee already assigned")

    staff_access = HotelStaffAccess(
        hotel_id=hotel_id,
        clerk_user_id=request.clerk_user_id,
    )
    session.add(staff_access)
    session.commit()
    return {"message": "Employee assigned successfully"}


@app.delete("/api/v1/hotels/{hotel_id}/staff/{clerk_user_id}", status_code=204)
def delete_hotel_staff(
    hotel_id: int,
    clerk_user_id: str,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    hotel = session.scalar(
        select(Hotel).where(
            Hotel.id == hotel_id,
            Hotel.clerk_organization_id == org_id,
        )
    )
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")

    assignment = session.scalar(
        select(HotelStaffAccess).where(
            HotelStaffAccess.hotel_id == hotel_id,
            HotelStaffAccess.clerk_user_id == clerk_user_id,
        )
    )
    if assignment is None:
        raise HTTPException(status_code=404, detail="Staff access not found")

    session.delete(assignment)
    session.commit()


@app.get("/api/v1/hotel-access")
def get_hotel_access(
    clerk_user_id: str,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    hotel_ids = session.scalars(
        select(HotelStaffAccess.hotel_id)
        .join(Hotel, Hotel.id == HotelStaffAccess.hotel_id)
        .where(
            Hotel.clerk_organization_id == org_id,
            HotelStaffAccess.clerk_user_id == clerk_user_id,
        )
    ).all()

    return {
        "clerk_user_id": clerk_user_id,
        "hotel_ids": hotel_ids,
    }


@app.put("/api/v1/staff/{clerk_user_id}/hotels")
def set_staff_hotels(
    clerk_user_id: str,
    request: SetStaffHotels,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    # Verify that this employee belongs to the organization.
    with Clerk(bearer_auth=os.environ["CLERK_SECRET_KEY"]) as clerk:
        memberships = clerk.organization_memberships.list(
            organization_id=org_id,
            user_id=[clerk_user_id],
            limit=1,
        )

    is_member = any(
        m.public_user_data is not None and m.public_user_data.user_id == clerk_user_id
        for m in memberships.data
    )

    if not is_member:
        raise HTTPException(403, "User is not an organization member")

    # Check that every requested hotel belongs to this organization.
    requested_ids = set(request.hotel_ids)

    valid_ids = set(
        session.scalars(
            select(Hotel.id).where(
                Hotel.id.in_(requested_ids),
                Hotel.clerk_organization_id == org_id,
            )
        ).all()
    )

    if requested_ids != valid_ids:
        raise HTTPException(404, "One or more hotels not found")

    # Retrieve this employee's existing assignments.
    existing = session.scalars(
        select(HotelStaffAccess)
        .join(Hotel, Hotel.id == HotelStaffAccess.hotel_id)
        .where(
            Hotel.clerk_organization_id == org_id,
            HotelStaffAccess.clerk_user_id == clerk_user_id,
        )
    ).all()

    existing_ids = {a.hotel_id for a in existing}

    # Remove assignments that are no longer selected.
    for assignment in existing:
        if assignment.hotel_id not in requested_ids:
            session.delete(assignment)

    # Add newly selected hotels.
    for hotel_id in requested_ids - existing_ids:
        session.add(
            HotelStaffAccess(
                hotel_id=hotel_id,
                clerk_user_id=clerk_user_id,
            )
        )

    session.commit()

    return {
        "clerk_user_id": clerk_user_id,
        "hotel_ids": sorted(requested_ids),
    }


@app.delete("/api/v1/hotels/{hotel_id}", status_code=204)
def delete_hotel(
    hotel_id: int,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    # Lock the property row while checking its references and deleting it.
    # Avoid cross-organization deletion even when IDs are guessed.
    hotel = session.scalar(
        select(Hotel)
        .where(Hotel.id == hotel_id, Hotel.clerk_organization_id == org_id)
        .with_for_update()
    )
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")

    # Never silently delete or orphan reservation enquiries.
    has_enquiry = session.scalar(
        select(Enquiry.id).where(Enquiry.hotel_id == hotel_id).limit(1)
    )
    if has_enquiry is not None:
        raise HTTPException(
            status_code=409,
            detail="This hotel has existing enquiries and cannot be deleted. Archive it instead.",
        )

    # Staff assignment rows refer to the hotel through a foreign key.
    try:
        session.execute(
            delete(HotelStaffAccess).where(HotelStaffAccess.hotel_id == hotel_id)
        )
        session.delete(hotel)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="This hotel is referenced by other records and cannot be deleted.",
        )

    return Response(status_code=204)


@app.post("/api/v1/hotels/bulk", status_code=201)
def create_hotels_bulk(
    request: BulkCreateHotelsRequest,
    session: Session = Depends(get_db),
    org_id: str = Depends(require_org_admin),
):
    # Look only inside the active organization.
    existing_names = session.scalars(
        select(Hotel.name).where(Hotel.clerk_organization_id == org_id)
    ).all()
    existing_normalized = {name.casefold() for name in existing_names}

    duplicates = [
        name for name in request.names if name.casefold() in existing_normalized
    ]
    if duplicates:
        raise HTTPException(
            status_code=409,
            detail=f"Hotel already exists in this organization: {duplicates[0]}",
        )

    # All inserts use a single transaction. No partial results on a failed commit.
    hotels = [Hotel(name=name, clerk_organization_id=org_id) for name in request.names]
    try:
        session.add_all(hotels)
        session.flush()  # Obtains generated IDs before the response.
        result = [{"id": hotel.id, "name": hotel.name} for hotel in hotels]
        session.commit()
        return result
    except Exception:
        session.rollback()
        raise
