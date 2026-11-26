from datetime import date, datetime
from typing import Any

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Enquiry(Base):
    __tablename__ = "enquiries"

    id: Mapped[int] = mapped_column(primary_key=True)
    hotel_id: Mapped[int | None] = mapped_column(
        ForeignKey("hotels.id"),
        nullable=True,
        index=True,
    )
    email_content: Mapped[str] = mapped_column(Text)
    email_date: Mapped[date] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(30), default="needs_review")

    raw_extraction: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    reservations: Mapped[list[Reservation]] = relationship(
        back_populates="enquiry",
        cascade="all, delete-orphan",
    )

    review_events: Mapped[list[ReviewEvent]] = relationship(
        back_populates="enquiry",
        cascade="all, delete-orphan",
    )


class Reservation(Base):
    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(primary_key=True)

    enquiry_id: Mapped[int] = mapped_column(
        ForeignKey("enquiries.id", ondelete="CASCADE")
    )

    arrival_date: Mapped[date | None]
    departure_date: Mapped[date | None]
    num_rooms: Mapped[int | None]
    num_adults: Mapped[int | None]
    num_children: Mapped[int | None]
    children_ages: Mapped[list[int]] = mapped_column(JSONB, default=list)
    room_type: Mapped[str | None] = mapped_column(String(100))

    enquiry: Mapped[Enquiry] = relationship(back_populates="reservations")


class ReviewEvent(Base):
    __tablename__ = "review_events"

    id: Mapped[int] = mapped_column(primary_key=True)

    enquiry_id: Mapped[int] = mapped_column(
        ForeignKey("enquiries.id", ondelete="CASCADE")
    )

    action: Mapped[str] = mapped_column(String(50))
    changes: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    enquiry: Mapped[Enquiry] = relationship(back_populates="review_events")


class Hotel(Base):
    __tablename__ = "hotels"

    id: Mapped[int] = mapped_column(primary_key=True)

    clerk_organization_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
