import os
from datetime import date

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from side_project_v1.app.db.models import Enquiry, Reservation

load_dotenv()
engine = create_engine(os.environ["DATABASE_URL"])

with Session(engine) as session:
    enquiry = Enquiry(
        email_content="I need 2 rooms for December 12.",
        email_date=date(2026, 11, 24),
        status="needs_review",
        reservations=[
            Reservation(
                arrival_date=date(2026, 12, 12),
                departure_date=date(2026, 12, 15),
                num_rooms=2,
                num_adults=4,
                num_children=0,
                children_ages=[],
                room_type="double",
            )
        ],
    )

    session.add(enquiry)
    session.commit()

    enquiry_id = enquiry.id
    print("Saved enquiry ID:", enquiry_id)

    saved = session.get(Enquiry, enquiry_id)

    print("Email:", saved.email_content)
    print("Rooms:", saved.reservations[0].num_rooms)
