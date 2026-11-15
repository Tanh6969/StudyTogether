"""Turns a pasted YouTube / SoundCloud / Spotify link into queue-item metadata.

Only the public oEmbed endpoints are used (no API keys), so the result has title, author and
thumbnail but usually no duration -- the frontend player fills that in once the track loads.
Resolution happens server-side so the browser never hits those hosts cross-origin and so one
24h cache serves every room. Nothing here identifies the user: the request carries only the URL.
"""

import re
import time
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from app.activities.dto.activity_dto import ResolvedTrack


class TrackResolveError(Exception):
    """Human-readable (Vietnamese) reason the link could not be queued; surfaced as HTTP 422."""


_CACHE_TTL_SECONDS = 24 * 3600
_cache: dict[str, tuple[float, ResolvedTrack]] = {}

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_SPOTIFY_PATH = re.compile(r"^/(?:intl-[a-z]{2}/)?(track|episode)/([A-Za-z0-9]{22})")


def _parse_timestamp(value: str | None) -> int:
    """YouTube's `t=` accepts `90`, `90s`, `1m30s`, `1h2m3s`."""
    if not value:
        return 0
    if value.isdigit():
        return int(value) * 1000
    total = 0
    for amount, unit in re.findall(r"(\d+)([hms])", value):
        total += int(amount) * {"h": 3600, "m": 60, "s": 1}[unit]
    return total * 1000


def _identify(url: str) -> tuple[str, str, str, int]:
    """-> (provider, provider_id, canonical_url, start_ms). Raises TrackResolveError."""
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if host.startswith("www.") or host.startswith("m."):
        host = host.split(".", 1)[1]
    query = parse_qs(parsed.query)

    if host in {"youtube.com", "music.youtube.com", "youtube-nocookie.com"}:
        video_id = None
        if parsed.path == "/watch":
            video_id = (query.get("v") or [None])[0]
        else:
            match = re.match(r"^/(?:embed|shorts|live|v)/([A-Za-z0-9_-]{11})", parsed.path)
            if match:
                video_id = match.group(1)
        if not video_id or not _YT_ID.match(video_id):
            raise TrackResolveError("Không nhận ra video YouTube trong link này.")
        return "youtube", video_id, f"https://www.youtube.com/watch?v={video_id}", _parse_timestamp((query.get("t") or [None])[0])

    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
        if not _YT_ID.match(video_id):
            raise TrackResolveError("Không nhận ra video YouTube trong link này.")
        return "youtube", video_id, f"https://www.youtube.com/watch?v={video_id}", _parse_timestamp((query.get("t") or [None])[0])

    if host in {"soundcloud.com", "on.soundcloud.com"}:
        parts = [p for p in parsed.path.split("/") if p]
        if host == "soundcloud.com" and (len(parts) < 2 or parts[0] in {"discover", "search", "you", "stream"}):
            raise TrackResolveError("Hãy dán link của một bài trên SoundCloud (dạng soundcloud.com/nghe-si/ten-bai).")
        canonical = f"https://{host}/{'/'.join(parts)}"
        return "soundcloud", canonical, canonical, 0

    if host in {"open.spotify.com", "spotify.com", "play.spotify.com"}:
        match = _SPOTIFY_PATH.match(parsed.path)
        if not match:
            raise TrackResolveError("Chỉ hỗ trợ link bài hát (track) hoặc tập podcast trên Spotify.")
        kind, spotify_id = match.groups()
        return "spotify", f"spotify:{kind}:{spotify_id}", f"https://open.spotify.com/{kind}/{spotify_id}", 0

    raise TrackResolveError("Chỉ hỗ trợ link YouTube, SoundCloud hoặc Spotify.")


_OEMBED = {
    "youtube": "https://www.youtube.com/oembed",
    "soundcloud": "https://soundcloud.com/oembed",
    "spotify": "https://open.spotify.com/oembed",
}


async def resolve_track(raw_url: str) -> ResolvedTrack:
    provider, provider_id, canonical, start_ms = _identify(raw_url)
    cache_key = f"{provider}:{provider_id}"
    hit = _cache.get(cache_key)
    if hit and hit[0] > time.monotonic():
        return hit[1].model_copy(update={"start_ms": start_ms})

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, headers={"User-Agent": "StudyTogether-MusicResolver/1.0"}) as client:
            response = await client.get(_OEMBED[provider], params={"url": canonical, "format": "json"})
    except httpx.HTTPError as exc:
        raise TrackResolveError("Không lấy được thông tin bài hát, thử lại sau.") from exc

    if response.status_code in (401, 403):
        raise TrackResolveError("Bài này không cho phép phát ngoài trang gốc.")
    if response.status_code == 404:
        raise TrackResolveError("Không tìm thấy bài này, link có thể đã hỏng hoặc bị ẩn.")
    if response.status_code >= 400:
        raise TrackResolveError("Không lấy được thông tin bài hát, thử lại sau.")

    try:
        data = response.json()
    except ValueError as exc:
        raise TrackResolveError("Không lấy được thông tin bài hát, thử lại sau.") from exc

    title = str(data.get("title") or "").strip()
    author = data.get("author_name")
    thumbnail = data.get("thumbnail_url")
    if provider == "youtube":
        # oEmbed omits title/thumbnail for some videos (e.g. live streams); the thumbnail URL
        # is predictable from the id and the player reports the real title once it loads.
        thumbnail = thumbnail or f"https://i.ytimg.com/vi/{provider_id}/hqdefault.jpg"
        title = title or "Video YouTube"
    title = title or canonical
    # SoundCloud's oEmbed only exposes the track's canonical URL inside its iframe HTML; the
    # Widget API needs that URL, so we keep the canonical page URL as the provider id.
    if provider == "soundcloud":
        html = str(data.get("html") or "")
        match = re.search(r"url=([^&\"']+)", html)
        if match:
            provider_id = unquote(match.group(1))
    track = ResolvedTrack(
        provider=provider,
        provider_id=provider_id,
        url=canonical,
        title=title[:300],
        author=str(author)[:200] if author else None,
        thumbnail_url=str(thumbnail) if thumbnail else None,
        duration_ms=None,
        start_ms=start_ms,
    )
    _cache[cache_key] = (time.monotonic() + _CACHE_TTL_SECONDS, track)
    return track
