from side_project_v1.app.services.room_booking_agent import extract_room_bookings

email = """
Hello,

I would like 2 double rooms from December 12 to December 15, 2026.

We are 4 adults and 1 child aged 7.
"""

result = extract_room_bookings(
    email=email,
    email_date="2026-11-23",
)

print(result.model_dump_json(indent=2))
