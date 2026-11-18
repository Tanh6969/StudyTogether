"""Isolated preview application process (never installed into production).

Two explicit resource modes:
- isolated: local PostgreSQL, real Supabase Auth, local profile bootstrap;
- shared-production: existing Supabase DB, Auth and LiveKit, without any profile
  bootstrap or automatic migrations. Writes made by users affect real data.
Neither mode changes the deployed FastAPI or frontend service.
"""
import asyncio
import logging
import os
import uuid
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

LOCAL_DB_URL = "postgresql+psycopg://mcppro@127.0.0.1:6544/studytogether_preview"
PRODUCTION_SUPABASE_REF = "auieyzwvehuwnbkbaqud"
PREVIEW_RESOURCE_MODE = os.getenv("PREVIEW_RESOURCE_MODE", "isolated")


def validate_preview_target() -> None:
    db_url = os.getenv("DATABASE_URL", "")
    if PREVIEW_RESOURCE_MODE == "isolated":
        if db_url != LOCAL_DB_URL:
            raise RuntimeError("Isolated preview requires the exact local preview database")
        return
    if PREVIEW_RESOURCE_MODE != "shared-production":
        raise RuntimeError("Unknown preview resource mode")
    if os.getenv("PREVIEW_SHARED_PRODUCTION_APPROVED") != "yes-real-data-affected":
        raise RuntimeError("Sharing production resources requires an explicit approval marker")
    if os.getenv("SUPABASE_URL", "").rstrip("/") != f"https://{PRODUCTION_SUPABASE_REF}.supabase.co":
        raise RuntimeError("Supabase project URL does not match the approved production project")
    try:
        db_target = urlsplit(db_url)
        hostname = (db_target.hostname or "").lower()
        username = db_target.username or ""
    except ValueError as exc:
        raise RuntimeError("Malformed production database URL") from exc
    project_db = hostname == f"db.{PRODUCTION_SUPABASE_REF}.supabase.co"
    pooler_db = hostname.endswith(".pooler.supabase.com") and PRODUCTION_SUPABASE_REF in username
    if not (project_db or pooler_db):
        raise RuntimeError("Database host / user do not identify the approved Supabase project")
    if not all(os.getenv(k) for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")):
        raise RuntimeError("Missing real LiveKit configuration")
    if os.getenv("LIVEKIT_API_KEY") == "previewkey" or os.getenv("LIVEKIT_URL", "").endswith(".invalid"):
        raise RuntimeError("Placeholder LiveKit config cannot be used in shared mode")
    # Media-session ownership is stored on private local PostgreSQL in review.
    # Never apply migration 011 or write the coordinator to Supabase production.
    if os.getenv("MEETING_SESSION_REQUIRED", "").lower() in ("true", "1", "yes"):
        coordinator_url = urlsplit(os.getenv("MEETING_SESSION_DATABASE_URL", ""))
        if coordinator_url.hostname != "127.0.0.1" or coordinator_url.port != 6544:
            raise RuntimeError("Shared-production media coordinator must use private loopback PostgreSQL")


validate_preview_target()

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
    # Real Supabase DB already owns Auth users and profiles. Never run the
    # preview-only identity bootstrap against production, including on login.
    if PREVIEW_RESOURCE_MODE == "isolated" and header.lower().startswith("bearer "):
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
