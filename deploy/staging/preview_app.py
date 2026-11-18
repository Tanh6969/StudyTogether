"""Isolated StudyTogether preview API (never imported or deployed in production).

Only local PostgreSQL is writable. Authentication is verified using the existing
Supabase Auth verifier, then the verified account is copied *to local preview DB*
to permit an interactive login using the real frontend. No real Supabase database
rows or users are created or modified by this wrapper.
"""
import asyncio
import logging
import os
import uuid

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

DB_URL = "postgresql+psycopg://mcppro@127.0.0.1:6544/studytogether_preview"
if os.getenv("DATABASE_URL") != DB_URL:
    raise RuntimeError("Preview API refuses to use a non-isolated database")

from app.main import app
from app.auth.services.auth_service import supabase_auth_service
from app.db.session import async_session_factory

logger = logging.getLogger("studytogether.preview")
initialized_users: set[uuid.UUID] = set()
init_lock = asyncio.Lock()


async def provision_local_identity(user_id: uuid.UUID, email: str | None):
    if user_id in initialized_users:
        return
    async with init_lock:
        if user_id in initialized_users:
            return
        # Private PostgreSQL only. Profile name is cosmetic, never used for auth.
        async with async_session_factory() as session:
            await session.execute(text("""
                INSERT INTO auth.users (id,email)
                VALUES (:id,:email)
                ON CONFLICT (id) DO NOTHING
            """), {"id": user_id, "email": email})
            await session.execute(text("""
                INSERT INTO public.profiles (id,username,display_name)
                VALUES (:id,:username,:display_name)
                ON CONFLICT (id) DO NOTHING
            """), {
                "id":user_id,
                "username":"preview_" + user_id.hex[:18],
                "display_name":"Preview " + user_id.hex[:8],
            })
            await session.commit()
        initialized_users.add(user_id)


@app.middleware("http")
async def local_preview_identity(request: Request, call_next):
    # Never mint fake LiveKit tokens for review. Return an explicit status
    # until the reviewer authorizes a distinct cloud LiveKit test credential.
    if (request.url.path.startswith("/study-rooms/")
            and request.url.path.endswith("/meeting/token")
            and request.method.upper() == "POST"
            and (os.getenv("PREVIEW_REAL_LIVEKIT") != "enabled"
                 or os.getenv("LIVEKIT_URL", "").endswith(".invalid")
                 or os.getenv("LIVEKIT_API_KEY") == "previewkey")):
        return JSONResponse(
            {"detail":"LiveKit preview credentials are not configured; production not used"},
            status_code=503,
            headers={"Cache-Control":"no-store"}
        )
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        try:
            # Uses the same signature/issuer verification as the normal backend.
            claims = await asyncio.to_thread(supabase_auth_service.verify, token)
            user_id = uuid.UUID(str(claims["sub"]))
            await provision_local_identity(user_id, claims.get("email"))
        except Exception as exc:
            # The actual endpoint must still authenticate and return its own
            # 401; the preview middleware never relaxes signature validation.
            logger.debug("Preview identity not provisioned: %s", type(exc).__name__)
    return await call_next(request)
