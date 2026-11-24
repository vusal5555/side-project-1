from datetime import date

import pytest
from pydantic import ValidationError

from side_project_v1.app.schemas.reservation import (
    RoomBooking,
    RoomPeriod,
)


def test_valid_room_reservation():
    reservation = RoomPeriod(
        arrival_date="2026-12-12",
        departure_date="2026-12-15",
        num_rooms=2,
        num_adults=4,
        num_children=1,
        children_ages=[7],
        room_type="double",
    )

    assert reservation.arrival_date == date(2026, 12, 12)
    assert reservation.num_rooms == 2
    assert reservation.children_ages == [7]


def test_invalid_room_count():
    with pytest.raises(ValidationError):
        RoomPeriod(
            arrival_date="2026-12-12",
            departure_date="2026-12-15",
            num_rooms=-1,
            num_adults=2,
            num_children=0,
            children_ages=[],
            room_type=None,
        )


def test_multiple_reservations():
    booking = RoomBooking(
        reservations=[
            RoomPeriod(
                arrival_date="2026-12-12",
                departure_date="2026-12-15",
                num_rooms=2,
                num_adults=4,
                num_children=0,
                children_ages=[],
                room_type="double",
            ),
            RoomPeriod(
                arrival_date="2026-12-20",
                departure_date="2026-12-23",
                num_rooms=1,
                num_adults=2,
                num_children=0,
                children_ages=[],
                room_type="single",
            ),
        ]
    )

    assert len(booking.reservations) == 2
    assert booking.reservations[1].num_rooms == 1


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        RoomPeriod(
            arrival_date=None,
            departure_date=None,
            num_rooms=1,
            num_adults=2,
            num_children=0,
            children_ages=[],
            room_type=None,
            hotel_name="Example Hotel",
        )
