from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.session import engine
from app.attachments.routers.attachment_router import router as attachments_router
from app.auth.routers.auth_router import router as auth_router
from app.conversations.routers.conversation_router import router as conversations_router
from app.profiles.routers.profile_router import router as profiles_router
from app.groups.routers.group_router import router as groups_router
from app.channels.routers.channel_router import router as channels_router
from app.messages.routers.message_router import router as messages_router
from app.study_rooms.routers.study_room_router import router as study_rooms_router
from app.resources.routers.resource_router import router as resources_router
from app.notes.routers.note_router import router as notes_router
from app.notifications.routers.notification_router import router as notifications_router
from app.invitations.routers.invitation_router import router as invitations_router
from app.tasks.routers.task_router import router as tasks_router
from app.group_tasks.routers.group_task_router import router as group_tasks_router
from app.room_tasks.routers.room_task_router import router as room_tasks_router
from app.rewards.routers.reward_router import router as rewards_router
from app.roadmaps.routers.roadmap_router import router as roadmaps_router
from app.activities.routers.activity_router import music_router, router as activities_router
from app.meetings.routers.livekit_webhook_router import router as livekit_webhook_router
from app.meetings.services.live_caption_service import live_caption_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm up the DB connection pool on startup so the first real requests
    don't pay the cold-connection cost (~200-400ms per connection). We warm up
    5 connections since many frontend pages do 4-5 parallel fetches (Promise.all)."""
    import asyncio
    
    async def _ping_db():
        try:
            async with engine.connect() as conn:
                await conn.exec_driver_sql("SELECT 1")
        except Exception:
            pass

    # Launch 5 concurrent connections to warm up the pool
    await asyncio.gather(*[_ping_db() for _ in range(5)])
    
    try:
        yield
    finally:
        await live_caption_service.aclose()


app = FastAPI(title="Study Platform API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


@app.get("/health", include_in_schema=False)
async def health_check():
    """Lightweight keep-alive endpoint — no DB call, no auth.
    Frontend pings this every 10 min to prevent Render free-tier spin-down."""
    return JSONResponse({"status": "ok"})


app.include_router(auth_router)
app.include_router(profiles_router)
app.include_router(groups_router)
app.include_router(channels_router)
app.include_router(conversations_router)
app.include_router(messages_router)
app.include_router(attachments_router)
app.include_router(study_rooms_router)
app.include_router(resources_router)
app.include_router(notes_router)
app.include_router(notifications_router)
app.include_router(invitations_router)
app.include_router(tasks_router)
app.include_router(group_tasks_router)
app.include_router(room_tasks_router)
app.include_router(rewards_router)
app.include_router(roadmaps_router)
app.include_router(activities_router)
app.include_router(music_router)
app.include_router(livekit_webhook_router)
