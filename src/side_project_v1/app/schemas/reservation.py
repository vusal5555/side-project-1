from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class RoomPeriod(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arrival_date: date | None = Field(
        ...,
        description="Check-in date in YYYY-MM-DD format, or null if unknown.",
    )

    departure_date: date | None = Field(
        ...,
        description="Check-out date in YYYY-MM-DD format, or null if unknown.",
    )

    num_rooms: int | None = Field(
        ...,
        ge=1,
        description="Number of requested rooms, or null if unknown.",
    )

    num_adults: int | None = Field(
        ...,
        ge=0,
        description=(
            "Total number of adults for this reservation block. "
            "For single rooms or rooms explicitly requested for single use, "
            "assign one adult per room unless otherwise specified. "
            "For double, twin, and other rooms, do not assume occupancy. "
            "Return null if genuinely unknown."
        ),
    )

    num_children: int | None = Field(
        ...,
        ge=0,
        description=(
            "Number of children. Return 0 if explicitly none, or null if unknown."
        ),
    )

    children_ages: list[int] = Field(
        ...,
        description="Known child ages, or [] if not provided.",
    )

    room_type: str | None = Field(
        ...,
        description=(
            "Extract the requested hotel room category as a string. "
            "Preserve meaningful category names and details. "
            "Exclude breakfast, meal plans, and unrelated guest preferences. "
            "Do not treat amenities alone as room types. "
            "Return null if no room category is specified."
        ),
    )


class RoomBooking(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reservations: list[RoomPeriod] = Field(
        ...,
        description=(
            "All identifiable hotel stay blocks, including "
            "partial reservations and existing stays. "
            "An arrival date alone can form a reservation block."
        ),
    )


class UpdateReservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    arrival_date: date | None = None
    departure_date: date | None = None
    num_rooms: int | None = Field(default=None, ge=1)
    num_adults: int | None = Field(default=None, ge=0)
    num_children: int | None = Field(default=None, ge=0)
    children_ages: list[int] = Field(default_factory=list)
    room_type: str | None = None
