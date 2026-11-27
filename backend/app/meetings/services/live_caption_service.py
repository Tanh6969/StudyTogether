"""Share one LiveKit audio subscriber per study room with a caption viewer."""

import asyncio
import datetime
import logging
import uuid
from collections.abc import AsyncIterator

from livekit import rtc
from livekit.api import AccessToken, VideoGrants

from app.core.config import settings
from app.meetings.services.livekit_service import study_room_livekit_name
from app.meetings.services.vietnamese_speech_service import (
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
        self.finished = asyncio.Event()
        self.connected = False
        self.failed = False
        self.listeners = 0
        self.viewers: dict[_Queue, tuple[str, str]] = {}
        self.microphones: dict[str, tuple[asyncio.Event, asyncio.Task]] = {}
        self.task = asyncio.create_task(self._run())

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

    def sync_microphones(self) -> None:
        active = {}
        if self.connected and self.viewers and not self.finished.is_set():
            for participant in self.rtc_room.remote_participants.values():
                try:
                    uuid.UUID(participant.identity)
                except ValueError:
                    continue
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
            self.finished.set()
        self.sync_microphones()

    async def _transcribe(self, track: rtc.Track, speaker: rtc.RemoteParticipant, stop: asyncio.Event) -> None:
        def emit(caption_id: str, text: str, final: bool) -> None:
            self._broadcast({
                "type": "caption",
                "id": caption_id,
                "speaker_id": speaker.identity,
                "speaker_name": speaker.name or "Thành viên",
                "text": text,
                "final": final,
            })

        delay = 1
        while not stop.is_set():
            audio = rtc.AudioStream.from_track(
                track=track, sample_rate=SAMPLE_RATE, num_channels=1, frame_size_ms=100, capacity=15
            )

            async def frames() -> AsyncIterator[bytes]:
                async for event in audio:
                    yield event.frame.data.tobytes()

            try:
                await transcribe_vietnamese(frames(), stop, emit)
                if not stop.is_set():
                    raise SpeechServiceError(retryable=True)
            except Exception as error:
                if stop.is_set():
                    return
                logger.warning("Live captions speech stream interrupted (%s)", type(error).__name__)
                if isinstance(error, SpeechServiceError) and not error.retryable:
                    self.failed = True
                    self.finished.set()
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
        room_name = study_room_livekit_name(self.room_id)

        def sync(*_args) -> None:
            if self.connected:
                for queue, (identity, participant_sid) in tuple(self.viewers.items()):
                    if not self.can_view(identity, participant_sid):
                        self._close_viewer(queue, "closed")
            self.sync_microphones()

        def reconnecting() -> None:
            self._broadcast({"type": "reconnecting"})
            self.connected = False
            self.sync_microphones()

        def reconnected() -> None:
            self.connected = True
            sync()
            self._broadcast({"type": "ready"})

        def disconnected(_reason) -> None:
            self.connected = False
            self.finished.set()

        for event in (
            "track_published", "track_unpublished", "track_subscribed", "track_unsubscribed",
            "track_muted", "track_unmuted", "participant_disconnected",
        ):
            room.on(event, sync)
        room.on("reconnecting", reconnecting)
        room.on("reconnected", reconnected)
        room.on("disconnected", disconnected)

        try:
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
            self.connected = not self.finished.is_set()
            self.waiting.set()
            await self.finished.wait()
        except Exception as error:
            self.failed = True
            logger.warning("Could not open LiveKit audio for captions (%s)", type(error).__name__)
        finally:
            self.connected = False
            self.waiting.set()
            self.finished.set()
            for queue in tuple(self.viewers):
                self._close_viewer(queue, "unavailable" if self.failed else "closed")
            audio_tasks = [task for _, task in self.microphones.values()]
            for task in audio_tasks:
                task.cancel()
            await asyncio.gather(*audio_tasks, return_exceptions=True)
            await room.disconnect()


class LiveCaptionService:
    def __init__(self):
        self.rooms: dict[uuid.UUID, _CaptionRoom] = {}

    async def events(
        self, room_id: uuid.UUID, identity: str, participant_sid: str
    ) -> AsyncIterator[_CaptionEvent]:
        caption_room = self.rooms.get(room_id)
        if caption_room is None or caption_room.finished.is_set():
            caption_room = self.rooms[room_id] = _CaptionRoom(room_id)
        caption_room.listeners += 1
        queue: _Queue = asyncio.Queue(maxsize=128)
        try:
            await caption_room.waiting.wait()
            if caption_room.failed:
                yield {"type": "unavailable"}
                return
            if not caption_room.can_view(identity, participant_sid):
                yield {"type": "closed"}
                return

            caption_room.viewers[queue] = (identity, participant_sid)
            caption_room.sync_microphones()
            yield {"type": "ready"}
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
            caption_room.viewers.pop(queue, None)
            caption_room.listeners -= 1
            if caption_room.listeners == 0:
                if self.rooms.get(room_id) is caption_room:
                    del self.rooms[room_id]
                caption_room.finished.set()
            else:
                caption_room.sync_microphones()


live_caption_service = LiveCaptionService()
