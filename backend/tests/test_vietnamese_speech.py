import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from google.genai import types

from app.meetings.services import vietnamese_speech_service as speech


def test_gemini_live_config_enables_vietnamese_and_manual_smart_mode():
    config = speech.live_config()

    assert config.input_audio_transcription.mode == "SMART"
    assert config.input_audio_transcription.language_codes == ["vi-VN"]
    assert "StudyTogether" in config.input_audio_transcription.custom_vocabulary
    assert config.realtime_input_config.automatic_activity_detection.disabled is True


async def test_two_utterances_use_separate_live_sessions_and_commit_only_finals(monkeypatch):
    sent = []
    voiced_frame = b"\x10\x00" * 320
    silence = bytes(640)
    finished = asyncio.Event()

    class Session:
        def __init__(self):
            self.audio_received = asyncio.Event()
            self.ended = asyncio.Event()
            self.calls = []
            sent.append(self.calls)

        async def send_realtime_input(self, **kwargs):
            self.calls.append(kwargs)
            if "audio" in kwargs:
                self.audio_received.set()
            if "activity_end" in kwargs:
                self.ended.set()

        async def receive(self):
            await self.audio_received.wait()
            yield types.LiveServerMessage(server_content=types.LiveServerContent(
                interim_input_transcription=types.Transcription(text="Nộp thứ Ba"),
            ))
            await self.ended.wait()
            yield types.LiveServerMessage(server_content=types.LiveServerContent(
                input_transcription=types.Transcription(text="Nộp thứ Tư.", finished=True),
                turn_complete=True,
            ))

    @asynccontextmanager
    async def connect(model, config):
        assert model == "gemini-3.5-transcribe-live"
        assert config.input_audio_transcription.mode == "SMART"
        yield Session()

    class AsyncClient:
        live = SimpleNamespace(connect=connect)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            finished.set()

    async def audio():
        for _ in range(2):
            for frame in [silence] * 5 + [voiced_frame] * 12 + [silence] * 50:
                yield frame

    monkeypatch.setattr(speech.genai, "Client", lambda **_kwargs: SimpleNamespace(aio=AsyncClient()))
    monkeypatch.setattr(speech.webrtcvad, "Vad", lambda _level: SimpleNamespace(
        is_speech=lambda frame, sample_rate: sample_rate == 16_000 and frame == voiced_frame,
    ))
    captions = AsyncMock()
    await speech.transcribe_vietnamese(audio(), asyncio.Event(), captions)

    assert finished.is_set()
    assert len(sent) == 2
    for calls in sent:
        assert isinstance(calls[0]["activity_start"], types.ActivityStart)
        assert isinstance(calls[-1]["activity_end"], types.ActivityEnd)
        assert calls[1]["audio"].mime_type == "audio/pcm;rate=16000"
    final_lines = [entry.args for entry in captions.await_args_list if entry.args[-1]]
    assert len(final_lines) == 2
    assert len({line_id for line_id, *_ in final_lines}) == 2
    assert {text for _, _, text, _ in final_lines} == {"Nộp thứ Tư."}


async def test_disconnect_clears_the_draft_without_saving_it():
    utterance = speech.Utterance(datetime.now(timezone.utc))
    utterance.audio.put_nowait(bytes(640))
    utterance.audio.put_nowait(None)

    class DisconnectedSession:
        async def send_realtime_input(self, **_kwargs):
            pass

        async def receive(self):
            yield types.LiveServerMessage(server_content=types.LiveServerContent(
                interim_input_transcription=types.Transcription(text="Từ đang đoán"),
            ))
            raise ConnectionError("offline")

    @asynccontextmanager
    async def connect(**_kwargs):
        yield DisconnectedSession()

    client = SimpleNamespace(aio=SimpleNamespace(live=SimpleNamespace(connect=connect)))
    captions = AsyncMock()
    with pytest.raises(ConnectionError):
        await speech._transcribe_utterance(client, speech.live_config(), utterance, captions)
    assert [call.args[2:] for call in captions.await_args_list] == [("Từ đang đoán", False), ("", False)]
