import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from side_project_v1.app.prompts.room_booking import SYSTEM_PROMPT
from side_project_v1.app.schemas.reservation import RoomBooking

load_dotenv()


USER_MESSAGE = """
Email date: {email_date}

Email:
{email}
"""

llm = ChatOpenAI(model="gpt-6-luna", temperature=1, api_key=os.getenv("OPENAI_API_KEY"))

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
