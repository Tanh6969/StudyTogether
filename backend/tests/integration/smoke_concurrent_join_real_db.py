"""Force two same-identity first joins to overlap against isolated PostgreSQL."""
import asyncio, os, uuid
from httpx import ASGITransport, AsyncClient
import psycopg
EXPECTED = 'postgresql+psycopg://mcppro@127.0.0.1:6544/studytogether_preview'
assert os.environ.get('DATABASE_URL') == EXPECTED, 'Refusing non-preview database'
from app.auth.dependencies import get_current_user
from app.auth.dto.auth_dto import CurrentUser
from app.main import app
from app.study_rooms.routers import study_room_router

async def main():
    with psycopg.connect('host=127.0.0.1 port=6544 user=mcppro dbname=studytogether_preview') as c:
        room_id, group_id = c.execute("SELECT id, group_id FROM public.study_rooms WHERE name='Preview Lifecycle Room' ORDER BY created_at DESC LIMIT 1").fetchone()
        uid=uuid.uuid4()
        c.execute('INSERT INTO auth.users(id,email) VALUES (%s,%s)',(uid,str(uid)+'@preview.invalid'))
        c.execute("INSERT INTO public.profiles(id,display_name) VALUES (%s,'Parallel Join Test')",(uid,))
        c.execute("INSERT INTO public.group_members(group_id,user_id,role,status) VALUES (%s,%s,'member','active')",(group_id,uid))
        c.commit()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=uid,email='parallel@preview.invalid',role='authenticated')
    old_get_member=study_room_router.service.get_member
    count=0
    ready=asyncio.Event()
    async def overlapped(session, rid, user):
        nonlocal count
        member=await old_get_member(session, rid, user)
        if rid==room_id and user==uid and member is None:
            count+=1
            if count>=2: ready.set()
            await asyncio.wait_for(ready.wait(),timeout=5)
        return member
    study_room_router.service.get_member=overlapped
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://preview.test') as cli:
            responses=await asyncio.gather(
                cli.post(f'/study-rooms/{room_id}/join'),
                cli.post(f'/study-rooms/{room_id}/join'),
                return_exceptions=True,
            )
        summary=[]
        for res in responses:
            summary.append(f'{type(res).__name__}: {str(res)[:350]} cause={str(getattr(res,"__cause__",None))[:250]}' if isinstance(res,Exception) else str(res.status_code))
        print('CONCURRENT_FIRST_JOIN_STATUSES',summary)
        assert summary == ['200', '200'], f'Idempotent parallel join regressed: {summary}'
        print('LOCAL_DB_CONCURRENT_JOIN_SUCCESS')
    finally:
        study_room_router.service.get_member=old_get_member
        app.dependency_overrides.pop(get_current_user,None)
if __name__=='__main__': asyncio.run(main())
