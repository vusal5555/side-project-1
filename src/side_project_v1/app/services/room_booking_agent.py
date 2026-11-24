import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from side_project_v1.app.prompts.room_booking import SYSTEM_PROMPT
from side_project_v1.app.schemas.reservation import RoomBooking

load_dotenv()

SYSTEM_PROMPT = """
You are an AI assistant that extracts hotel accommodation
requests from incoming guest emails.

Follow these rules:

1. Extract only hotel accommodation requests.
2. Identify all distinct reservation requests in the email.
3. Extract information explicitly provided by the guest.
4. Never invent missing information.
5. Return null for unknown nullable fields.
6. Do not assume adult counts from room types.
7. Use the email date as context when interpreting dates.
8. Prioritize the latest guest request over older quoted emails.
9. Do not confuse meeting room requests with accommodation.
10. If there is no active accommodation request, return an
    empty reservations list.

Return the information according to the provided schema.
"""

USER_MESSAGE = """
Email date: {email_date}

Email:
{email}
"""

llm = ChatOpenAI(model="gpt-5-mini", temperature=0, api_key=os.getenv("OPENAI_API_KEY"))

structured_llm = llm.with_structured_output(
    RoomBooking,
    method="json_schema",
)


def extract_room_bookings(email: str, email_date: str) -> RoomBooking:

    response = structured_llm.invoke(
        [
            (
                "system",
                SYSTEM_PROMPT,
            ),
            ("human", USER_MESSAGE.format(email_date=email_date, email=email)),
        ]
    )

    return response
