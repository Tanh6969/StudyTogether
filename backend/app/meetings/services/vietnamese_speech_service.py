"""Streaming Vietnamese speech recognition. The provider only receives mic PCM."""

import asyncio
import json
import unicodedata
import uuid
from collections.abc import AsyncIterable, Callable

from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from app.core.config import settings

SAMPLE_RATE = 16_000
_SONIOX_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
_END_MARKERS = frozenset({"<end>", "<fin>"})


class SpeechServiceError(Exception):
    def __init__(self, retryable: bool):
        self.retryable = retryable


def _is_retryable(code: int) -> bool:
    return code in {408, 429} or code >= 500


class SpeechSegments:
    """Keep provider-final tokens while replacing the draft for the current utterance."""

    def __init__(self, emit: Callable[[str, str, bool], None]):
        self._emit = emit
        self._id = uuid.uuid4().hex
        self._stable_text = ""
        self._draft = ""

    def consume(self, tokens: list[dict]) -> None:
        draft_parts = []
        for token in tokens:
            text = token["text"]
            if text in _END_MARKERS:
                self.finish()
                draft_parts.clear()
            elif token["is_final"]:
                # Bound the size of a caption even during a long uninterrupted turn.
                if len(self._stable_text) >= 450 and text[:1].isspace():
                    self.finish()
                self._stable_text += text
            else:
                draft_parts.append(text)

        draft = unicodedata.normalize("NFC", (self._stable_text + "".join(draft_parts)).strip())
        if draft != self._draft:
            self._draft = draft
            self._emit(self._id, draft, False)

    def finish(self) -> None:
        text = unicodedata.normalize("NFC", self._stable_text.strip())
        if text or self._draft:
            self._emit(self._id, text, bool(text))
        self._id = uuid.uuid4().hex
        self._stable_text = self._draft = ""


async def transcribe_vietnamese(
    audio: AsyncIterable[bytes],
    stop: asyncio.Event,
    emit: Callable[[str, str, bool], None],
) -> None:
    segments = SpeechSegments(emit)
    terms = [term.strip() for term in settings.live_captions_terms.split(",") if term.strip()]
    config = {
        "model": settings.soniox_stt_model,
        "audio_format": "pcm_s16le",
        "sample_rate": SAMPLE_RATE,
        "num_channels": 1,
        "language_hints": ["vi"],
        "language_hints_strict": True,
        "enable_endpoint_detection": True,
    }
    if terms:
        config["context"] = {"terms": terms}

    try:
        async with connect(
            _SONIOX_URL,
            additional_headers={"Authorization": f"Bearer {settings.soniox_api_key}"},
            open_timeout=7,
            close_timeout=2,
            compression=None,
        ) as socket:
            await socket.send(json.dumps(config))

            async def send_audio() -> None:
                async for frame in audio:
                    if stop.is_set():
                        break
                    await asyncio.wait_for(socket.send(frame), timeout=3)

            async def receive_text() -> None:
                async for packet in socket:
                    result = json.loads(packet)
                    if "error_code" in result:
                        raise SpeechServiceError(_is_retryable(result["error_code"]))
                    if "tokens" in result:
                        segments.consume(result["tokens"])
                    if result.get("finished"):
                        return
                raise SpeechServiceError(retryable=True)

            sender = asyncio.create_task(send_audio())
            receiver = asyncio.create_task(receive_text())
            stopping = asyncio.create_task(stop.wait())
            tasks = (sender, receiver, stopping)
            try:
                done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                if receiver in done:
                    receiver.result()
                    return
                if sender in done:
                    sender.result()
                else:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
                await asyncio.wait_for(socket.send(b""), timeout=2)
                await asyncio.wait_for(receiver, timeout=2)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    except InvalidStatus as error:
        raise SpeechServiceError(_is_retryable(error.response.status_code)) from error
    finally:
        # A disconnect can leave a draft on screen. Keep only provider-final text.
        segments.finish()
