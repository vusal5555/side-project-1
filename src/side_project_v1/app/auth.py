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


def get_clerk_session(request: Request):
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

    return state


def require_user(request: Request):
    state = get_clerk_session(request)
    return state.payload["sub"]


def require_organization(request: Request):
    state = get_clerk_session(request)
    org_id = state.payload.get("org_id")

    if not org_id:
        raise HTTPException(
            status_code=403,
            detail="Select an organization first",
        )

    return org_id


def require_org_admin(request: Request):
    state = get_clerk_session(request)
    org_id = state.payload.get("org_id")
    org_admin_role = state.payload.get("org_role")

    if not org_id:
        raise HTTPException(
            status_code=403,
            detail="Select an organization first",
        )

    if org_admin_role != "admin":
        raise HTTPException(
            status_code=403,
            detail="You are not an organization admin",
        )

    return org_id
