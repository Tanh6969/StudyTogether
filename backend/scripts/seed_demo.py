"""Seed demo accounts + sample data into the Supabase project in backend/.env.

Usage (from backend/):  .venv/Scripts/python scripts/seed_demo.py

Idempotent: accounts are created once (password is re-set every run); everything the demo
accounts own (groups and all their content, personal tasks, roadmaps) is wiped and re-created,
so re-running restores a clean demo state. Never touches other users' data.

Keep DEMO_ACCOUNTS in sync with frontend/src/lib/demoAccounts.ts.
"""

import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.rewards.catalog import REWARDS  # noqa: E402  (frames/cheers granted to demo accounts)

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
DEMO_PASSWORD = "123456"  # same as the frontend mock password (MOCK_PASSWORD)
DEMO_ACCOUNTS = [
    # key, email, username, display name, organization, bio
    ("minhanh", "minhanh@study.local", "minhanh", "Minh Anh", "ĐH Bách khoa Hà Nội", "Đang ôn IELTS và Giải tích 2."),
    ("hoangnam", "hoangnam@study.local", "hoangnam", "Hoàng Nam", "ĐH Bách khoa Hà Nội", "Thích chữa đề và giải bài khó."),
    ("thutrang", "thutrang@study.local", "thutrang", "Thu Trang", "ĐH Công nghệ – ĐHQGHN", "Frontend dev, đang học React."),
    ("duchuy", "duchuy@study.local", "duchuy", "Đức Huy", None, None),
    ("lanphuong", "lanphuong@study.local", "lanphuong", "Lan Phương", None, None),
    ("quocbao", "quocbao@study.local", "quocbao", "Quốc Bảo", None, None),
]

NS = uuid.UUID("6f1c2a52-7d0e-4c55-9a7e-3b1f0d6c9a10")


def sid(name: str) -> uuid.UUID:
    """Stable id per seed object, so re-runs produce the same ids (handy for bookmarks)."""
    return uuid.uuid5(NS, name)


def load_env() -> dict[str, str]:
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key] = value
    return env


def ensure_auth_users(env: dict[str, str]) -> dict[str, uuid.UUID]:
    base = env["SUPABASE_URL"].rstrip("/") + "/auth/v1/admin/users"
    headers = {"apikey": env["SUPABASE_SECRET_KEY"]}
    ids: dict[str, uuid.UUID] = {}
    with httpx.Client(timeout=30, headers=headers) as client:
        existing = {}
        page = 1
        while True:
            resp = client.get(base, params={"page": page, "per_page": 200})
            resp.raise_for_status()
            users = resp.json().get("users", [])
            existing.update({u["email"].lower(): u["id"] for u in users if u.get("email")})
            if len(users) < 200:
                break
            page += 1

        for key, email, _username, display_name, _org, _bio in DEMO_ACCOUNTS:
            payload = {"password": DEMO_PASSWORD, "email_confirm": True, "user_metadata": {"full_name": display_name}}
            if email in existing:
                resp = client.put(f"{base}/{existing[email]}", json=payload)
                action = "updated"
            else:
                resp = client.post(base, json={"email": email, **payload})
                action = "created"
            resp.raise_for_status()
            ids[key] = uuid.UUID(resp.json()["id"])
            print(f"  auth user {action}: {email}")
    return ids


def seed_data(conn: psycopg.Connection, uid: dict[str, uuid.UUID]) -> None:
    now = datetime.now(timezone.utc)
    today = date.today()
    ago = lambda **kw: now - timedelta(**kw)  # noqa: E731
    me, nam, trang = uid["minhanh"], uid["hoangnam"], uid["thutrang"]
    demo_ids = list(uid.values())

    with conn.cursor() as cur:
        # ---- wipe previous demo content (cascades through group children) ----
        cur.execute("delete from groups where owner_id = any(%s)", (demo_ids,))
        cur.execute("delete from tasks where user_id = any(%s)", (demo_ids,))
        cur.execute("delete from roadmaps where user_id = any(%s)", (demo_ids,))
        cur.execute("delete from notifications where user_id = any(%s)", (demo_ids,))
        cur.execute("delete from user_rewards where user_id = any(%s)", (demo_ids,))

        # ---- profiles ----
        for key, _email, username, display_name, org, bio in DEMO_ACCOUNTS:
            cur.execute(
                """insert into profiles (id, username, display_name, organization, bio)
                   values (%s, %s, %s, %s, %s)
                   on conflict (id) do update set username = excluded.username, display_name = excluded.display_name,
                     organization = excluded.organization, bio = excluded.bio""",
                (uid[key], username, display_name, org, bio),
            )

        # ---- cosmetic rewards: demo accounts own everything, each wears something different ----
        for user_id in demo_ids:
            for reward in REWARDS:
                cur.execute(
                    "insert into user_rewards (user_id, reward_id) values (%s, %s) on conflict do nothing",
                    (user_id, reward.id),
                )
        for user_id, frame, cheer in ((me, "galaxy", "sparkle"), (nam, "dragon", "drum"), (trang, "inferno", "fanfare")):
            cur.execute("update profiles set avatar_frame = %s, cheer_style = %s where id = %s", (frame, cheer, user_id))

        # ---- groups (owner membership comes from the groups_add_owner trigger) ----
        groups = [
            ("ielts", "Ôn thi IELTS 7.0", "Cùng luyện 4 kỹ năng mỗi tối, mục tiêu 7.0 trước kỳ thi tháng 3.", me, True, [(nam, "moderator"), (trang, "member"), (uid["duchuy"], "member")]),
            ("giaitich", "Giải tích 2 – K67", "Chữa bài tập, chia sẻ đề cũ và ôn thi giữa kỳ, cuối kỳ.", nam, True, [(me, "member"), (uid["duchuy"], "member"), (uid["lanphuong"], "member")]),
            ("react", "Lập trình Web với React", "Học React + TypeScript từ cơ bản, làm project nhỏ mỗi tuần.", trang, True, [(me, "member"), (nam, "member"), (uid["lanphuong"], "member"), (uid["quocbao"], "member")]),
            ("doan", "Đồ án tốt nghiệp", "Nhóm kín để họp và theo dõi tiến độ đồ án.", me, False, [(trang, "member")]),
        ]
        for key, name, desc, owner, is_public, members in groups:
            gid = sid(f"group:{key}")
            cur.execute(
                "insert into groups (id, name, description, owner_id, is_public, created_at) values (%s,%s,%s,%s,%s,%s)",
                (gid, name, desc, owner, is_public, ago(days=30)),
            )
            for user_id, role in members:
                cur.execute(
                    "insert into group_members (group_id, user_id, role, joined_at) values (%s,%s,%s,%s)",
                    (gid, user_id, role, ago(days=20)),
                )

        # ---- channels + their conversations ----
        def channel(group_key, key, name, created_by, description=None, private=False, members=()):
            ch_id, conv_id = sid(f"channel:{group_key}:{key}"), sid(f"conv:channel:{group_key}:{key}")
            cur.execute(
                "insert into channels (id, group_id, name, description, is_private, created_by) values (%s,%s,%s,%s,%s,%s)",
                (ch_id, sid(f"group:{group_key}"), name, description, private, created_by),
            )
            cur.execute(
                "insert into conversations (id, type, channel_id, created_by) values (%s,'channel',%s,%s)",
                (conv_id, ch_id, created_by),
            )
            for user_id in members:
                cur.execute("insert into channel_members (channel_id, user_id) values (%s,%s)", (ch_id, user_id))
            return conv_id

        c_ielts = channel("ielts", "chung", "chung", me, "Kênh trao đổi chung của nhóm")
        channel("ielts", "speaking", "speaking-partner", me, "Tìm bạn luyện nói")
        channel("ielts", "mods", "ban-quan-tri", me, "Kênh riêng cho quản trị nhóm", private=True, members=(me, nam))
        c_gt = channel("giaitich", "chung", "chung", nam)
        channel("giaitich", "dethi", "de-thi-cu", nam, "Đề thi các năm trước")
        c_react = channel("react", "chung", "chung", trang)
        channel("doan", "chung", "chung", me)

        # ---- messages ----
        def messages(conv_id, rows):
            for minutes_ago, sender, content in rows:
                ts = ago(minutes=minutes_ago)
                cur.execute(
                    "insert into messages (conversation_id, sender_id, content, created_at, updated_at) values (%s,%s,%s,%s,%s)",
                    (conv_id, sender, content, ts, ts),
                )

        messages(c_ielts, [
            (26 * 60, nam, "Chào cả nhóm! Tối nay 8h mình mở phòng luyện Speaking nhé 🎤"),
            (25 * 60, trang, "Ok, mình sẽ vào. Có ai có bộ đề Part 2 quý này không?"),
            (24 * 60, me, "Mình vừa up bộ đề lên mục Tài liệu rồi đó, mọi người tải về nha."),
            (90, nam, "Nhắc lại: deadline nộp Writing Task 2 là thứ 6 này."),
            (30, trang, "Mình nộp rồi nha, nhờ mọi người chữa giúp 🙏"),
        ])
        messages(c_gt, [
            (300, nam, "Tuần này chữa đề giữa kỳ 2024, mọi người làm trước câu 1–3 nhé."),
            (240, me, "Câu 3 tích phân đường mình ra 2π, có ai ra giống không?"),
            (200, nam, "Đúng rồi đó, nhớ đổi sang tọa độ cực cho nhanh."),
        ])
        messages(c_react, [
            (600, trang, "Project tuần này: làm todo app với useReducer + localStorage."),
            (500, me, "Có cần dùng TypeScript luôn không chị?"),
            (480, trang, "Có nhé, tập quen với type từ đầu."),
        ])

        # ---- study rooms + their conversations ----
        rooms = [
            ("ielts", "speaking", "Luyện Speaking buổi tối", nam, "Part 2 + Part 3, mỗi người 2 đề."),
            ("ielts", "writing", "Chữa Writing Task 2", me, "Mang bài viết tuần này lên chữa chung."),
            ("giaitich", "giuaky", "Chữa đề giữa kỳ 2024", nam, "Tích phân bội và tích phân đường."),
            ("react", "hooks", "React Hooks nâng cao", trang, None),
        ]
        for group_key, key, name, host, desc in rooms:
            room_id = sid(f"room:{group_key}:{key}")
            cur.execute(
                "insert into study_rooms (id, group_id, name, description, host_id, max_participants) values (%s,%s,%s,%s,%s,10)",
                (room_id, sid(f"group:{group_key}"), name, desc, host),
            )
            cur.execute(
                "insert into conversations (id, type, room_id, created_by) values (%s,'room',%s,%s)",
                (sid(f"conv:room:{group_key}:{key}"), room_id, host),
            )

        # ---- group notes ----
        for group_key, author, title, content in [
            ("ielts", me, "Lịch học tuần này", "T2–T6: 20h–21h30 luyện Speaking/Writing. CN: thi thử Reading."),
            ("ielts", nam, "Tips Speaking Part 2", "Dành 1 phút note theo khung: Who – What – When – Why – How you feel."),
            ("giaitich", nam, "Công thức cần nhớ", "Green, Stokes, Gauss–Ostrogradsky. Chú ý điều kiện áp dụng."),
        ]:
            cur.execute(
                "insert into group_notes (group_id, author_id, title, content) values (%s,%s,%s,%s)",
                (sid(f"group:{group_key}"), author, title, content),
            )

        # ---- group task flow boards (new MVP feature) ----
        def board(group_key, rows):
            for key, title, assignee, done, parent, due_in, notes in rows:
                cur.execute(
                    """insert into group_tasks (id, group_id, parent_id, title, assignee, due_date, done, notes, created_by)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (
                        sid(f"gtask:{group_key}:{key}"), sid(f"group:{group_key}"),
                        sid(f"gtask:{group_key}:{parent}") if parent else None,
                        title, assignee, today + timedelta(days=due_in) if due_in is not None else None,
                        done, notes, me,
                    ),
                )

        board("ielts", [
            ("goal", "Mục tiêu IELTS 7.0 trước tháng 3", "Cả nhóm", False, None, 120, ["Listening/Reading ≥ 7.5", "Writing/Speaking ≥ 6.5"]),
            ("listening", "Luyện Listening Cambridge 15–18", "Thu Trang", False, "goal", 30, ["Mỗi ngày 1 test"]),
            ("writing", "Writing Task 2 mỗi tuần", "Minh Anh", False, "goal", 7, ["Nộp trước tối thứ 6"]),
            ("speaking", "Speaking cặp đôi", "Hoàng Nam", False, "goal", 14, []),
            ("writing-review", "Chữa bài Writing tuần 1", "Hoàng Nam", False, "writing", 3, []),
            ("vocab", "Tổng hợp từ vựng chủ đề Environment", "Thu Trang", True, None, None, []),
        ])
        board("react", [
            ("basics", "Nắm vững React cơ bản", "Cả nhóm", False, None, 21, ["JSX, props, state"]),
            ("hooks", "useState / useEffect / useReducer", "Minh Anh", False, "basics", 7, []),
            ("todo", "Project: Todo app", "Hoàng Nam", False, "hooks", 10, ["TypeScript bắt buộc"]),
            ("setup", "Cài Node + Vite", "Cả nhóm", True, None, None, []),
        ])

        # ---- personal tasks (Aim + room task panel) ----
        for user_id, title, due_in, priority, done in [
            (me, "Làm 1 đề Reading Cambridge 17", 0, 2, False),
            (me, "Viết Writing Task 2 – Environment", 0, 3, False),
            (me, "Ôn chương 3 Giải tích 2", 1, 2, False),
            (me, "Nghe podcast IELTS 30 phút", 0, 1, True),
            (nam, "Soạn lời giải đề giữa kỳ", 0, 3, False),
            (nam, "Chuẩn bị đề Speaking Part 3", 2, 2, False),
            (trang, "Review PR todo app của nhóm", 0, 2, False),
        ]:
            cur.execute(
                "insert into tasks (user_id, title, due_date, priority, completed_at) values (%s,%s,%s,%s,%s)",
                (user_id, title, today + timedelta(days=due_in), priority, now if done else None),
            )

        # ---- roadmaps (Aim) ----
        for user_id, key, title, goal, due_in, phases in [
            (me, "ielts", "Lộ trình IELTS 7.0", "Đạt IELTS 7.0 trước tháng 3", 120,
             [("Nền tảng ngữ pháp", 100), ("Từ vựng theo chủ đề", 60), ("Luyện đề 4 kỹ năng", 20), ("Thi thử", 0)]),
            (me, "giaitich", "Qua môn Giải tích 2", "Đạt A môn Giải tích 2", 60,
             [("Tích phân bội", 80), ("Tích phân đường – mặt", 30), ("Chuỗi", 0)]),
            (trang, "react", "Trở thành React developer", "Làm được project React + TS hoàn chỉnh", 90,
             [("React cơ bản", 100), ("Hooks nâng cao", 50), ("State management", 0), ("Testing", 0)]),
        ]:
            rid = sid(f"roadmap:{key}:{user_id}")
            cur.execute(
                "insert into roadmaps (id, user_id, title, goal, due_date) values (%s,%s,%s,%s,%s)",
                (rid, user_id, title, goal, today + timedelta(days=due_in)),
            )
            for position, (name, progress) in enumerate(phases):
                cur.execute(
                    "insert into roadmap_phases (roadmap_id, name, position, progress) values (%s,%s,%s,%s)",
                    (rid, name, position, progress),
                )
    conn.commit()


def main() -> int:
    env = load_env()
    if not env.get("SUPABASE_SECRET_KEY"):
        print("SUPABASE_SECRET_KEY is missing in backend/.env", file=sys.stderr)
        return 1
    print("Ensuring demo auth users...")
    uid = ensure_auth_users(env)
    dsn = env["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
    print("Seeding demo data...")
    with psycopg.connect(dsn) as conn:
        seed_data(conn, uid)
    print("\nDone. Demo accounts (password for all: %s):" % DEMO_PASSWORD)
    for _key, email, _u, name, _o, _b in DEMO_ACCOUNTS:
        print(f"  {name:<10} {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
