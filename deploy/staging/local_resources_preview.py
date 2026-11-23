"""Isolated preview-only blob adapter. No prod Storage credentials or writes."""
import base64
import hashlib
import hmac
import json
import mimetypes
import secrets
import time
from pathlib import Path
from fastapi import HTTPException, Request
from fastapi.responses import Response

from app.resources.routers import resource_router

_BLOB_ROOT = Path("/srv/mcppro/workspaces/studytogether-session-env/reactive-resource-blobs")
_BLOB_ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
_SECRET = secrets.token_bytes(32)
_MAX_UPLOAD = 20 * 1024 * 1024

def _blob_path(path: str) -> Path:
    # Only files in a group/user/object tree can be stored.
    parts = path.split("/")
    if len(parts) != 5 or parts[0] != "groups" or any(
        p in ("", ".", "..") or "/" in p or chr(92) in p for p in parts
    ):
        raise HTTPException(status_code=400, detail="Invalid resource path")
    out = (_BLOB_ROOT / path).resolve()
    if not out.is_relative_to(_BLOB_ROOT.resolve()):
        raise HTTPException(status_code=400, detail="Invalid resource path")
    return out

def _sign(action: str, path: str, expire_in: int, name: str = "") -> str:
    packet = {"a": action, "p": path, "e": int(time.time()) + expire_in, "n": name}
    payload = base64.urlsafe_b64encode(json.dumps(packet, separators=(",", ":")).encode()).decode().rstrip("=")
    digest = hmac.new(_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return payload + "." + digest

def _verify(token: str, action: str) -> tuple[Path, str]:
    try:
        payload, sig = token.rsplit(".", 1)
        expected = hmac.new(_SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise ValueError("signature")
        packet = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if packet["a"] != action or not (time.time() < int(packet["e"]) <= time.time() + 3600):
            raise ValueError("action or expiry")
        return _blob_path(packet["p"]), packet.get("n", "")
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        raise HTTPException(status_code=403, detail="Expired or invalid preview resource link")

async def local_upload_url(path: str) -> dict[str, str]:
    token = _sign("upload", path, 900)
    return {"path": path, "upload_url": "/api/__preview/blobs/upload/" + token, "token": token}

async def local_download_url(path: str, expires_in: int, download_filename: str | None = None) -> dict[str, object]:
    token = _sign("download", path, min(3600, expires_in), download_filename or "")
    return {"url": "/api/__preview/blobs/download/" + token, "expires_in": min(3600, expires_in)}

async def local_exists(path: str) -> bool:
    return _blob_path(path).is_file()

async def local_delete(path: str) -> None:
    _blob_path(path).unlink(missing_ok=True)

resource_router.storage_service.create_signed_upload_url = local_upload_url
resource_router.storage_service.create_signed_download_url = local_download_url
resource_router.storage_service.object_exists = local_exists
resource_router.storage_service.delete_object = local_delete

def attach_preview_blob_routes(app):
    @app.put("/__preview/blobs/upload/{token}")
    async def preview_resource_upload(token: str, request: Request):
        path, _ = _verify(token, "upload")
        if path.exists():
            raise HTTPException(status_code=409, detail="Object already exists")
        size = 0
        body = bytearray()
        async for chunk in request.stream():
            size += len(chunk)
            if size > _MAX_UPLOAD:
                raise HTTPException(status_code=413, detail="Preview file exceeds maximum size")
            body.extend(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty resource")
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open("xb") as target:
            target.write(body)
        return Response(status_code=201)

    @app.get("/__preview/blobs/download/{token}")
    async def preview_resource_download(token: str):
        path, name = _verify(token, "download")
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Preview resource not found")
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        headers = {"Cache-Control": "no-store"}
        if name:
            from urllib.parse import quote
            headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote(name)
        return Response(content=path.read_bytes(), media_type=media_type, headers=headers)
