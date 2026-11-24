from datetime import date

from fastapi import FastAPI, HTTPException
from langchain_core.exceptions import OutputParserException
from openai import APIConnectionError, InternalServerError, RateLimitError
from pydantic import BaseModel, Field, ValidationError

from side_project_v1.app.services.room_booking_agent import (
    RoomBooking,
    extract_room_bookings,
)

app = FastAPI()


class EmailRequest(BaseModel):
    email: str = Field(min_length=1)
    email_date: date


@app.get("/health")
def health_check():
    return {"message": "OK"}


@app.get("/")
def read_root():
    return {"message": "Hello, World!"}


@app.post("/api/v1/reservations/extract", response_model=RoomBooking)
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
