"""One-time administrator action: reuse EXISTING StudyTogether resources for preview.

Reads the production env locally; does not print, upload, or rotate secrets.
Does NOT change production services, migrations, Caddy, GitHub, or LiveKit projects.
Must be reviewed and executed by the server's authorized administrator.
"""
from __future__ import annotations

import os
import pwd
import grp
import shutil
import stat
import tempfile
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import dotenv_values

REF = "auieyzwvehuwnbkbaqud"
SOURCE = Path("/opt/studytogether/backend/.env")
DEST = Path("/srv/mcppro/workspaces/studytogether-session-env/preview.env")
PREVIEW_USER = "mcppro"
COPY_KEYS = (
    "DATABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
)

if os.geteuid() != 0:
    raise SystemExit("Requires an authorized administrator (sudo).")
if not SOURCE.is_file() or not DEST.is_file():
    raise SystemExit("Source/preview environment file is unavailable; nothing changed.")

production = dict(dotenv_values(SOURCE))
preview = dict(dotenv_values(DEST))
db_url = production.get("DATABASE_URL") or ""
supabase_url = (production.get("SUPABASE_URL") or "").rstrip("/")
if supabase_url != f"https://{REF}.supabase.co":
    raise SystemExit("Production Supabase project does not match the approved project; unchanged.")
try:
    db = urlsplit(db_url)
    host = (db.hostname or "").lower()
    username = db.username or ""
except ValueError as exc:
    raise SystemExit("Invalid database URL; unchanged.") from exc
if not (host == f"db.{REF}.supabase.co"
        or (host.endswith(".pooler.supabase.com") and REF in username)):
    raise SystemExit("Database host and username do not prove the approved project; unchanged.")
for key in ("DATABASE_URL", "SUPABASE_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
    if not production.get(key):
        raise SystemExit(f"Required production setting {key} missing; unchanged.")
if production["LIVEKIT_URL"].endswith(".invalid") or production["LIVEKIT_API_KEY"] == "previewkey":
    raise SystemExit("Production LiveKit metadata appears to be a placeholder; unchanged.")

# All writes are local; do not introduce prod credentials into the repository.
# Atomic swap, with an owner-only backup for reversal.
for key in COPY_KEYS:
    if production.get(key):
        preview[key] = production[key]
preview.update({
    "PREVIEW_RESOURCE_MODE": "shared-production",
    "PREVIEW_SHARED_PRODUCTION_APPROVED": "yes-real-data-affected",
    "PREVIEW_REAL_LIVEKIT": "enabled",
})
# Preserve other preview-only CORS/URL settings, which must never be copied
# from production. python-dotenv quotes all values safely for shell env loading.
def quote_env(value: str) -> str:
    import shlex
    if any(c in value for c in "\r\n\x00"):
        raise ValueError("Multiline / invalid env value rejected")
    return shlex.quote(value)

contents = "".join(f"{key}={quote_env(value)}\n" for key, value in preview.items() if value is not None)
backup = DEST.with_name("preview.env.before-shared-production")
# Existing preview.env has no secrets unless a previous attempt already wrote them.
if not backup.exists():
    shutil.copyfile(DEST, backup)
    os.chown(backup, pwd.getpwnam(PREVIEW_USER).pw_uid, grp.getgrnam(PREVIEW_USER).gr_gid)
    os.chmod(backup, 0o600)

fd, temporary = tempfile.mkstemp(prefix=".preview-credentials-", dir=DEST.parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(contents)
        handle.flush()
        os.fsync(handle.fileno())
    os.chown(temporary, pwd.getpwnam(PREVIEW_USER).pw_uid, grp.getgrnam(PREVIEW_USER).gr_gid)
    os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
    os.replace(temporary, DEST)
except BaseException:
    if os.path.exists(temporary):
        os.unlink(temporary)
    raise
print("PREVIEW_RESOURCE_MODE=shared-production")
print("DATABASE_TARGET=approved-existing-supabase-project")
print("LIVEKIT_TARGET=existing-project")
print("PRODUCTION_SERVICE_CHANGED=no")
print("SECRET_VALUES_PRINTED=no")
print("NEXT=restart the independent preview API only")
