"""Apply one or more SQL migration files from backend/db/migrations to DATABASE_URL.

Usage (from backend/):
    .venv/Scripts/python.exe scripts/apply_migration.py 007 008
    .venv/Scripts/python.exe scripts/apply_migration.py db/migrations/007_room_activities.sql

Each file is sent as a single script (they wrap themselves in begin/commit and are idempotent).
Reads DATABASE_URL from backend/.env; works through either Supavisor pooler port.
"""

import sys
from pathlib import Path

import psycopg

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "db" / "migrations"


def database_url() -> str:
    for line in (BACKEND / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().replace("postgresql+psycopg://", "postgresql://")
    raise SystemExit("DATABASE_URL not found in backend/.env")


def resolve(arg: str) -> Path:
    path = Path(arg)
    if path.exists():
        return path
    matches = sorted(MIGRATIONS.glob(f"{arg}_*.sql"))
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one migration matching {arg!r}, found {[m.name for m in matches]}")
    return matches[0]


def main(args: list[str]) -> None:
    if not args:
        raise SystemExit(__doc__)
    files = [resolve(a) for a in args]
    with psycopg.connect(database_url(), connect_timeout=20, prepare_threshold=None, autocommit=True) as conn:
        for file in files:
            sql = file.read_text(encoding="utf-8")
            print(f"applying {file.name} ...", end=" ", flush=True)
            conn.execute(sql)
            print("ok")


if __name__ == "__main__":
    main(sys.argv[1:])
