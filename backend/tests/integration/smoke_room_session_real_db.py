"""Isolated PostgreSQL API integration, does not contact production DB or LiveKit.
Auth identities are test overrides; calls exercise real FastAPI routes and real DB.
"""
import asyncio
import os
import uuid
from unittest.mock import AsyncMock
import psycopg
from httpx import ASGITransport, AsyncClient

EXPECTED = "postgresql+psycopg://mcppro@127.0.0.1:6544/studytogether_preview"
assert os.environ.get("DATABASE_URL") == EXPECTED, "Refusing non-preview database"

from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.main import app
from app.study_rooms.routers import study_room_router

holder = {}
app.dependency_overrides[get_current_user] = lambda: holder["user"]
study_room_router.livekit_service.remove_participant = AsyncMock()

def ensure_ok(res, status=200):
    assert res.status_code == status, f"{res.request.method} {res.request.url}: {res.status_code} {res.text[:600]}"
    return res.json() if res.status_code != 204 else None

async def main():
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    with psycopg.connect("host=127.0.0.1 port=6544 user=mcppro dbname=studytogether_preview") as conn:
        for name, uid in [("Preview Owner", user_a), ("Preview Member", user_b)]:
            conn.execute("INSERT INTO auth.users(id,email) VALUES (%s,%s)", (uid, str(uid)+"@preview.invalid"))
            conn.execute("INSERT INTO public.profiles(id,display_name) VALUES (%s,%s)", (uid, name))
        conn.commit()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://preview.test") as client:
        holder["user"] = CurrentUser(id=user_a,email="owner@preview.invalid",role="authenticated")
        group = ensure_ok(await client.post("/groups/",json={"name":"Isolated Session Regression Group"}),201)
        group_id=group["id"]
        room=ensure_ok(await client.post("/study-rooms/",json={"group_id":group_id,"name":"Preview Lifecycle Room"}),201)
        room_id=room["id"]
        owner_session=ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))
        assert owner_session["can_connect"] and owner_session["member"]["user_id"]==str(user_a)

        holder["user"] = CurrentUser(id=user_b,email="member@preview.invalid",role="authenticated")
        ensure_ok(await client.get(f"/study-rooms/{room_id}/session"),403)
        with psycopg.connect("host=127.0.0.1 port=6544 user=mcppro dbname=studytogether_preview") as conn:
            conn.execute("INSERT INTO public.group_members(group_id,user_id,role,status) VALUES (%s,%s,'member','active')",(group_id,user_b))
            conn.commit()

        pre=ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))
        assert pre["member"] is None and not pre["can_connect"]
        joined=ensure_ok(await client.post(f"/study-rooms/{room_id}/join"))
        after=ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))
        assert after["can_connect"] and joined["user_id"]==str(user_b)

        token=ensure_ok(await client.post(f"/study-rooms/{room_id}/meeting/token"))
        assert token["participant_token"] and token["server_url"]
        print("DATABASE_JOIN_AND_TOKEN_PASS")

        leave=ensure_ok(await client.post(f"/study-rooms/{room_id}/leave",params={"expected_joined_at":joined["joined_at"]}))
        assert leave["left_at"]
        denied=await client.post(f"/study-rooms/{room_id}/meeting/token")
        assert denied.status_code==403
        after_leave=ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))
        assert not after_leave["can_connect"]
        print("DATABASE_LEAVE_AND_PERMISSION_REVOCATION_PASS")

        rejoined=ensure_ok(await client.post(f"/study-rooms/{room_id}/join"))
        stale=ensure_ok(await client.post(f"/study-rooms/{room_id}/leave",params={
            "expected_joined_at":joined["joined_at"],"disconnect_livekit":True,
        }))
        assert stale["left_at"] is None
        assert stale["joined_at"]==rejoined["joined_at"]
        assert ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))["can_connect"]
        print("DATABASE_STALE_LEAVE_PROTECTION_PASS")

        holder["user"] = CurrentUser(id=user_a,email="owner@preview.invalid",role="authenticated")
        action=ensure_ok(await client.post(f"/study-rooms/{room_id}/moderation",json={
            "room_id":room_id, "moderator_id":str(user_a), "target_user_id":str(user_b), "action":"kick"
        }))
        assert action["action"]=="kick"
        holder["user"] = CurrentUser(id=user_b,email="member@preview.invalid",role="authenticated")
        kicked=ensure_ok(await client.get(f"/study-rooms/{room_id}/session"))
        assert not kicked["can_connect"]
        assert (await client.post(f"/study-rooms/{room_id}/meeting/token")).status_code==403
        assert (await client.post(f"/conversations/{room['conversation_id']}/messages",json={"content":"denied"})).status_code==403
        print("DATABASE_KICK_REVOKES_TOKEN_AND_CHAT_PASS")
        print("LOCAL_DB_INTEGRATION_SUCCESS")
    app.dependency_overrides.pop(get_current_user,None)

if __name__=="__main__":
    asyncio.run(main())
