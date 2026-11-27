from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from side_project_v1.app.auth import OrganizationUser
from side_project_v1.app.db.models import Hotel, HotelStaffAccess


def check_hotel_access(session: Session, user: OrganizationUser, hotel_id: int):

    hotel = session.scalar(
        select(Hotel).where(
            Hotel.id == hotel_id, Hotel.clerk_organization_id == user.org_id
        )
    )
    if not hotel:
        raise HTTPException(status_code=404, detail="Hotel not found")

    if user.is_admin:
        return hotel

    assignment = session.scalar(
        select(HotelStaffAccess).where(
            HotelStaffAccess.hotel_id == hotel.id,
            HotelStaffAccess.clerk_user_id == user.user_id,
        )
    )

    if assignment is None:
        raise HTTPException(404, "Hotel not found")

    return hotel
