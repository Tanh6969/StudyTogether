"""Send a signed LiveKit `participant_left` webhook to a local backend (dev only).

Standard library only -- runs with any Python 3.10+, no venv/pip needed:

    py scripts/send_livekit_webhook.py <room_id> <user_id>
    py scripts/send_livekit_webhook.py <room_id> <user_id> --reason DUPLICATE_IDENTITY
    py scripts/send_livekit_webhook.py <room_id> <user_id> --bad-signature

Signs with LIVEKIT_API_KEY / LIVEKIT_API_SECRET read from backend/.env, the same way
LiveKit Cloud does (HS256 JWT, iss = API key, `sha256` claim = base64 sha256 of body),
so /livekit/webhook can be tested without a public tunnel.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
REASONS = [
    "UNKNOWN_REASON", "CLIENT_INITIATED", "DUPLICATE_IDENTITY", "SERVER_SHUTDOWN",
    "PARTICIPANT_REMOVED", "ROOM_DELETED", "STATE_MISMATCH", "JOIN_FAILURE", "MIGRATION",
    "SIGNAL_CLOSE", "ROOM_CLOSED", "USER_UNAVAILABLE", "USER_REJECTED", "SIP_TRUNK_FAILURE",
    "CONNECTION_TIMEOUT", "MEDIA_FAILURE",
]


def read_env(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.strip().partition("=")
            if sep and key.strip() == name:
                return value.strip().strip('"').strip("'")
    raise SystemExit(f"{name} not found in environment or {ENV_FILE}")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sign_jwt(claims: dict, secret: str) -> str:
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps(claims).encode())
    signature = hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64url(signature)}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("room_id", type=uuid.UUID)
    parser.add_argument("user_id", type=uuid.UUID)
    parser.add_argument("--reason", default="CONNECTION_TIMEOUT", choices=REASONS)
    parser.add_argument("--joined-minutes-ago", type=float, default=1.0,
                        help="When the departed LiveKit session started (default 1 minute ago)")
    parser.add_argument("--url", default="http://localhost:8000/livekit/webhook")
    parser.add_argument("--bad-signature", action="store_true", help="Sign with a wrong secret (expect 401)")
    args = parser.parse_args()

    now = time.time()
    body = json.dumps({
        "event": "participant_left",
        "id": f"EV_local_{uuid.uuid4().hex[:8]}",
        "createdAt": str(int(now)),
        "room": {"name": f"study-room-{args.room_id}"},
        "participant": {
            "identity": str(args.user_id),
            "disconnectReason": args.reason,
            "joinedAtMs": str(int((now - args.joined_minutes_ago * 60) * 1000)),
        },
    })
    api_key = read_env("LIVEKIT_API_KEY")
    secret = "wrong-secret-" + "x" * 32 if args.bad_signature else read_env("LIVEKIT_API_SECRET")
    token = sign_jwt({
        "iss": api_key,
        "nbf": int(now) - 5,
        "exp": int(now) + 300,
        "sha256": base64.b64encode(hashlib.sha256(body.encode()).digest()).decode(),
    }, secret)

    request = urllib.request.Request(args.url, data=body.encode(), method="POST", headers={
        "Authorization": token, "Content-Type": "application/webhook+json",
    })
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            print(response.status, response.read().decode())
    except urllib.error.HTTPError as error:
        print(error.code, error.read().decode())
    except urllib.error.URLError as error:
        raise SystemExit(f"Cannot reach {args.url}: {error.reason} -- is the backend running?")


if __name__ == "__main__":
    main()
