"""Gemini Live Vietnamese transcription with server-side utterance boundaries."""

import asyncio
import unicodedata
import uuid
from collections import deque
from collections.abc import AsyncIterable, Awaitable, Callable
from datetime import datetime, timedelta, timezone

import webrtcvad
from google import genai
from google.auth.exceptions import DefaultCredentialsError
from google.genai import errors, types

from app.core.config import settings

SAMPLE_RATE = 16_000
FRAME_MS = 20
_FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1000 * 2
_MODEL = "gemini-3.5-transcribe-live"
CaptionSink = Callable[[uuid.UUID, datetime, str, bool], Awaitable[None]]


class SpeechServiceError(Exception):
    def __init__(self, retryable: bool):
        self.retryable = retryable


def live_config() -> types.LiveConnectConfig:
    terms = [term.strip() for term in settings.live_captions_terms.split(",") if term.strip()]
    return types.LiveConnectConfig(
        response_modalities=["TEXT"],
        input_audio_transcription=types.AudioTranscriptionConfig(
            mode="SMART", language_codes=["vi-VN"], custom_vocabulary=terms[:100],
        ),
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True),
        ),
    )


class Utterance:
    def __init__(self, started_at: datetime):
        self.id = uuid.uuid4()
        self.started_at = started_at
        self.audio: asyncio.Queue[bytes | None] = asyncio.Queue()
        self.frames: list[bytes] = []
        self.ended = asyncio.Event()

    def append(self, frame: bytes) -> None:
        self.frames.append(frame)
        self.audio.put_nowait(frame)

    def finish(self) -> None:
        self.audio.put_nowait(None)
        self.ended.set()

    def replay(self) -> None:
        self.audio = asyncio.Queue()
        for frame in self.frames:
            self.audio.put_nowait(frame)
        self.audio.put_nowait(None)


async def _detect_utterances(audio: AsyncIterable[bytes], start: Callable[[Utterance], None]) -> None:
    vad = webrtcvad.Vad(2)
    pre_roll: deque[bytes] = deque(maxlen=260 // FRAME_MS)
    utterance = None
    pending = bytearray()
    quiet_frames = voiced_frames = turn_frames = 0
    try:
        async for chunk in audio:
            pending.extend(chunk)
            while len(pending) >= _FRAME_BYTES:
                frame = bytes(pending[:_FRAME_BYTES])
                del pending[:_FRAME_BYTES]
                has_voice = vad.is_speech(frame, SAMPLE_RATE)

                if utterance is None:
                    pre_roll.append(frame)
                    voiced_frames = voiced_frames + 1 if has_voice else 0
                    if voiced_frames < 3:
                        continue
                    buffer_duration = len(pre_roll) * FRAME_MS
                    started_at = datetime.now(timezone.utc)
                    utterance = Utterance(started_at - timedelta(milliseconds=buffer_duration))
                    for previous in pre_roll:
                        utterance.append(previous)
                    turn_frames = len(pre_roll)
                    quiet_frames = 0
                    pre_roll.clear()
                    start(utterance)
                    continue

                utterance.append(frame)
                quiet_frames = 0 if has_voice else quiet_frames + 1
                turn_frames += 1
                # Allow a natural pause for a self-correction, with a ceiling for long monologues.
                if quiet_frames >= 900 // FRAME_MS or turn_frames >= 24_000 // FRAME_MS:
                    utterance.finish()
                    utterance = None
                    voiced_frames = 0
    finally:
        if utterance is not None:
            utterance.finish()


async def _send_utterance(session, utterance: Utterance, speech_ended: asyncio.Event) -> None:
    await session.send_realtime_input(activity_start=types.ActivityStart())
    chunks = []
    while (frame := await utterance.audio.get()) is not None:
        chunks.append(frame)
        if len(chunks) == 5:
            await session.send_realtime_input(
                audio=types.Blob(data=b"".join(chunks), mime_type="audio/pcm;rate=16000"),
            )
            chunks.clear()
    if chunks:
        await session.send_realtime_input(
            audio=types.Blob(data=b"".join(chunks), mime_type="audio/pcm;rate=16000"),
        )
    await session.send_realtime_input(activity_end=types.ActivityEnd())
    speech_ended.set()


async def _transcribe_utterance(client, config, utterance: Utterance, emit: CaptionSink) -> None:
    draft = ""

    # SMART retains and can edit earlier text within a Live session. A fresh session per
    # utterance keeps other utterances out of the editable buffer.
    try:
        async with asyncio.timeout(36), client.aio.live.connect(model=_MODEL, config=config) as session:
            speech_ended = asyncio.Event()

            async def receive_text() -> bool:
                nonlocal draft
                while True:
                    async for message in session.receive():
                        content = message.server_content
                        if not content:
                            continue
                        final = content.input_transcription
                        if final is not None and final.finished is not False:
                            text = unicodedata.normalize("NFC", (final.text or "").strip())
                            await emit(utterance.id, utterance.started_at, text, True)
                            draft = ""
                            return True
                        interim = content.interim_input_transcription or final
                        if interim is not None and interim.text is not None:
                            text = unicodedata.normalize("NFC", interim.text.strip())
                            if text != draft:
                                draft = text
                                await emit(utterance.id, utterance.started_at, text, False)
                    if speech_ended.is_set():
                        return False

            sender = asyncio.create_task(_send_utterance(session, utterance, speech_ended))
            receiver = asyncio.create_task(receive_text())
            try:
                complete, _ = await asyncio.wait((sender, receiver), return_when=asyncio.FIRST_COMPLETED)
                if sender in complete:
                    sender.result()
                    await asyncio.wait_for(receiver, timeout=6)
                else:
                    receiver.result()
            finally:
                for task in (sender, receiver):
                    task.cancel()
                await asyncio.gather(sender, receiver, return_exceptions=True)
    finally:
        if draft:
            await emit(utterance.id, utterance.started_at, "", False)


async def _transcribe_with_retry(client, config, utterance: Utterance, emit: CaptionSink) -> None:
    for attempt in range(2):
        try:
            await _transcribe_utterance(client, config, utterance, emit)
            return
        except errors.APIError as error:
            if error.code in (400, 401, 403, 404, 1008):
                raise SpeechServiceError(retryable=False) from error
            if attempt:
                raise
        except (TimeoutError, OSError):
            if attempt:
                raise
        await utterance.ended.wait()
        await asyncio.sleep(0.5)
        utterance.replay()


async def transcribe_vietnamese(
    audio: AsyncIterable[bytes],
    stop: asyncio.Event,
    emit: CaptionSink,
) -> None:
    try:
        client = genai.Client(
            enterprise=True, project=settings.gemini_live_project, location=settings.gemini_live_location,
        )
        config = live_config()
        async with client.aio:
            async with asyncio.TaskGroup() as tasks:
                slots = asyncio.Semaphore(3)

                async def transcribe(utterance: Utterance) -> None:
                    async with slots:
                        await _transcribe_with_retry(client, config, utterance, emit)

                def start(utterance: Utterance) -> None:
                    tasks.create_task(transcribe(utterance))

                producer = tasks.create_task(_detect_utterances(audio, start))
                stopping = tasks.create_task(stop.wait())
                completed, _ = await asyncio.wait((producer, stopping), return_when=asyncio.FIRST_COMPLETED)
                if producer in completed:
                    stopping.cancel()
                else:
                    producer.cancel()
    except* (DefaultCredentialsError, SpeechServiceError) as error:
        raise SpeechServiceError(retryable=False) from error
