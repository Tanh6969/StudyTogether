"""One LiveKit microphone subscriber per active study room."""

import asyncio
import datetime
import logging
import uuid
from collections.abc import AsyncIterator

from livekit import rtc
from livekit.api import AccessToken, VideoGrants

from app.core.config import settings
from app.meetings.services import meeting_capture_store
from app.meetings.services.livekit_service import study_room_livekit_name
from app.meetings.services.vietnamese_speech_service import (
    FRAME_MS,
    SAMPLE_RATE,
    SpeechServiceError,
    transcribe_vietnamese,
)

logger = logging.getLogger(__name__)
_MICROPHONE = rtc.TrackSource.SOURCE_MICROPHONE
_CaptionEvent = dict[str, str | bool]
_Queue = asyncio.Queue[_CaptionEvent]


class _CaptionRoom:
    def __init__(self, room_id: uuid.UUID):
        self.room_id = room_id
        self.rtc_room = rtc.Room()
        self.waiting = asyncio.Event()
        self.changed = asyncio.Event()
        self.finished = False
        self.connected = False
        self.failed = False
        self.livekit_sid: str | None = None
        self.capture_id: uuid.UUID | None = None
        self.viewers: dict[_Queue, tuple[str, str]] = {}
        self.microphones: dict[str, tuple[asyncio.Event, asyncio.Task]] = {}
        self.history: list[_CaptionEvent] = []
        self.task = asyncio.create_task(self._run())

    def close(self) -> None:
        self.finished = True
        self.changed.set()

    def can_view(self, identity: str, participant_sid: str) -> bool:
        participant = self.rtc_room.remote_participants.get(identity)
        return self.connected and participant is not None and participant.sid == participant_sid

    def _close_viewer(self, queue: _Queue, event_type: str) -> None:
        self.viewers.pop(queue, None)
        while not queue.empty():
            queue.get_nowait()
        queue.put_nowait({"type": event_type})

    def _broadcast(self, event: _CaptionEvent) -> None:
        if not self.connected:
            return
        for queue, (identity, participant_sid) in tuple(self.viewers.items()):
            if not self.can_view(identity, participant_sid):
                self._close_viewer(queue, "closed")
            elif queue.full():
                self._close_viewer(queue, "unavailable")
            else:
                queue.put_nowait(event)

    def _participants(self) -> dict[uuid.UUID, rtc.RemoteParticipant]:
        participants = {}
        for participant in self.rtc_room.remote_participants.values():
            try:
                participants[uuid.UUID(participant.identity)] = participant
            except ValueError:
                # Egress and the other bots never represent study-room users.
                continue
        return participants

    def _sync_microphones(self, participants: dict[uuid.UUID, rtc.RemoteParticipant]) -> None:
        active = {}
        if self.connected and self.capture_id is not None and not self.finished:
            for participant in participants.values():
                for pub in participant.track_publications.values():
                    if pub.source == _MICROPHONE and not pub.muted:
                        active[pub.sid] = pub, participant

        for sid, (stop, _) in self.microphones.items():
            if sid not in active:
                stop.set()

        for sid, (publication, participant) in active.items():
            if publication.track is None:
                if not publication.subscribed:
                    publication.set_subscribed(True)
            elif sid not in self.microphones:
                stop = asyncio.Event()
                task = asyncio.create_task(self._transcribe(publication.track, participant, stop))
                self.microphones[sid] = (stop, task)
                task.add_done_callback(lambda done, track_sid=sid: self._microphone_done(track_sid, done))

    def _microphone_done(self, sid: str, task: asyncio.Task) -> None:
        self.microphones.pop(sid, None)
        if not task.cancelled() and task.exception() is not None:
            self.failed = True
            self.close()
        self.changed.set()

    async def _transcribe(self, track, speaker: rtc.RemoteParticipant, stop: asyncio.Event) -> None:
        capture_id = self.capture_id
        speaker_name = speaker.name or "Thành viên"

        async def emit(caption_id, spoken_at, text, final):
            if final and text:
                await meeting_capture_store.save_line(capture_id, caption_id, spoken_at, speaker_name, text)
            event = {
                "type": "caption",
                "capture_id": str(capture_id),
                "id": str(caption_id),
                "spoken_at": spoken_at.isoformat(),
                "speaker_id": speaker.identity,
                "speaker_name": speaker_name,
                "text": text,
                "final": final,
            }
            if final and text:
                self.history.append(event)
                del self.history[:-120]
            self._broadcast(event)

        delay = 1
        while not stop.is_set():
            audio = rtc.AudioStream.from_track(
                track=track, sample_rate=SAMPLE_RATE, num_channels=1, frame_size_ms=FRAME_MS, capacity=100
            )

            async def frames() -> AsyncIterator[bytes]:
                async for event in audio:
                    yield event.frame.data.tobytes()

            try:
                await transcribe_vietnamese(frames(), stop, emit)
                if not stop.is_set():
                    raise SpeechServiceError(retryable=True)
            except Exception as error:
                logger.warning("Meeting speech stream interrupted (%s)", type(error).__name__)
                if isinstance(error, SpeechServiceError) and not error.retryable:
                    self.failed = True
                    self.close()
                    return
                self._broadcast({"type": "reconnecting", "speaker_id": speaker.identity})
            finally:
                await audio.aclose()

            if not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=delay)
                except TimeoutError:
                    delay = min(delay * 2, 10)

    async def _run(self) -> None:
        room = self.rtc_room

        def changed(*_args) -> None:
            self.changed.set()

        def reconnecting() -> None:
            self._broadcast({"type": "reconnecting"})
            self.connected = False
            changed()

        def reconnected() -> None:
            self.connected = True
            changed()
            self._broadcast({"type": "ready", "capture_id": str(self.capture_id or "")})

        def disconnected(_reason) -> None:
            self.connected = False
            self.close()

        for event in (
            "track_published", "track_unpublished", "track_subscribed", "track_unsubscribed",
            "track_muted", "track_unmuted", "participant_connected", "participant_disconnected",
        ):
            room.on(event, changed)
        room.on("reconnecting", reconnecting)
        room.on("reconnected", reconnected)
        room.on("disconnected", disconnected)

        ended = False
        try:
            room_name = study_room_livekit_name(self.room_id)
            token = (
                AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
                .with_identity(f"captions-{uuid.uuid4().hex}")
                .with_kind("agent")
                .with_ttl(datetime.timedelta(seconds=60))
                .with_grants(VideoGrants(
                    room=room_name, room_join=True, hidden=True,
                    can_subscribe=True, can_publish=False, can_publish_data=False,
                ))
                .to_jwt()
            )
            await room.connect(
                settings.livekit_url, token, rtc.RoomOptions(auto_subscribe=False, connect_timeout=8)
            )
            self.livekit_sid = await asyncio.wait_for(room.sid, timeout=4)
            self.connected = not self.finished
            registered: set[uuid.UUID] = set()
            while not self.finished:
                self.changed.clear()
                if self.connected and await room.sid != self.livekit_sid:
                    ended = True
                    self.close()
                    break
                participants = self._participants() if self.connected else {}
                new_users = participants.keys() - registered
                if new_users:
                    self.capture_id = await meeting_capture_store.observe(self.room_id, self.livekit_sid, new_users)
                    registered.update(new_users)
                self.waiting.set()
                for queue, (identity, participant_sid) in tuple(self.viewers.items()):
                    if self.connected and not self.can_view(identity, participant_sid):
                        self._close_viewer(queue, "closed")
                self._sync_microphones(participants)
                try:
                    idle_timeout = 8 if self.connected and not participants else None
                    await asyncio.wait_for(self.changed.wait(), timeout=idle_timeout)
                except TimeoutError:
                    ended = True
                    self.close()
        except Exception as error:
            self.failed = True
            logger.warning("Could not capture LiveKit audio (%s)", type(error).__name__)
        finally:
            self.close()
            self.waiting.set()
            for stop, _ in self.microphones.values():
                stop.set()
            audio_tasks = [task for _, task in self.microphones.values()]
            try:
                await asyncio.wait_for(asyncio.gather(*audio_tasks, return_exceptions=True), timeout=9)
                if ended and self.livekit_sid:
                    await meeting_capture_store.finish(self.room_id, self.livekit_sid)
            finally:
                self.connected = False
                for queue in tuple(self.viewers):
                    self._close_viewer(queue, "unavailable" if self.failed else "closed")
                await room.disconnect()


class LiveCaptionService:
    def __init__(self):
        self.rooms: dict[uuid.UUID, _CaptionRoom] = {}

    def ensure_room(self, room_id: uuid.UUID) -> _CaptionRoom:
        caption_room = self.rooms.get(room_id)
        if caption_room is None:
            caption_room = self.rooms[room_id] = _CaptionRoom(room_id)
            caption_room.task.add_done_callback(lambda task: self._room_done(caption_room, task))
        return caption_room

    def _room_done(self, caption_room: _CaptionRoom, task: asyncio.Task) -> None:
        if self.rooms.get(caption_room.room_id) is caption_room:
            del self.rooms[caption_room.room_id]
        if not task.cancelled() and task.exception() is not None:
            logger.warning("Could not close meeting capture (%s)", type(task.exception()).__name__)

    def finish_room(self, room_id: uuid.UUID, livekit_sid: str) -> None:
        caption_room = self.rooms.get(room_id)
        if caption_room is not None and caption_room.livekit_sid == livekit_sid:
            caption_room.close()

    async def aclose(self) -> None:
        rooms = list(self.rooms.values())
        for room in rooms:
            room.close()
        await asyncio.gather(*(room.task for room in rooms), return_exceptions=True)

    async def events(
        self, room_id: uuid.UUID, identity: str, participant_sid: str
    ) -> AsyncIterator[_CaptionEvent]:
        caption_room = self.ensure_room(room_id)
        queue: _Queue = asyncio.Queue(maxsize=128)
        try:
            await caption_room.waiting.wait()
            if caption_room.failed:
                yield {"type": "unavailable"}
                return
            if caption_room.finished or not caption_room.can_view(identity, participant_sid):
                yield {"type": "closed"}
                return

            caption_room.viewers[queue] = (identity, participant_sid)
            history = tuple(caption_room.history)
            yield {"type": "ready", "capture_id": str(caption_room.capture_id or "")}
            for line in history:
                yield line
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=10)
                except TimeoutError:
                    yield {"type": "heartbeat"}
                    continue
                yield event
                if event["type"] in {"closed", "unavailable"}:
                    return
        finally:
            # The recorder belongs to the meeting. Viewers only subscribe to its events.
            caption_room.viewers.pop(queue, None)


live_caption_service = LiveCaptionService()
