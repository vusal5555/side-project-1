import os

from clerk_backend_api import (
    AuthenticateRequestOptions,
    authenticate_request,
)
from dotenv import load_dotenv
from fastapi import HTTPException, Request

load_dotenv()

CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")
CLERK_JWT_KEY = os.getenv("CLERK_JWT_KEY")


def require_user(request: Request):
    state = authenticate_request(
        request,
        AuthenticateRequestOptions(
            secret_key=os.environ["CLERK_SECRET_KEY"],
            jwt_key=os.environ["CLERK_JWT_KEY"].replace("\\n", "\n"),
            authorized_parties=["http://localhost:3000"],
            accepts_token=["session_token"],
        ),
    )

    if not state.is_signed_in:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
        )

    return state.payload["sub"]
