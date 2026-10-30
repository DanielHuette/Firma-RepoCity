"""Tests of the speech to text and text to speech plugins that use the local speech service."""

import io
import json
import wave

import httpx
import numpy as np
import pytest
from livekit import rtc
from livekit.agents import APIConnectionError, APIStatusError, APITimeoutError
from livekit.agents.types import APIConnectOptions

from repocity_telefon.errors import SpeechServiceError
from repocity_telefon.speech_plugins import LocalSTT, LocalTTS, SpeechClient
from repocity_telefon.speech_service.audio import pcm16_wav

NO_RETRY = APIConnectOptions(max_retry=0, retry_interval=0, timeout=5)
HEALTH = {
    "status": "ok",
    "whisper_model": "small",
    "voice": "de_DE-ramona-low",
    "sample_rate": 16000,
}


def tone(sample_rate: int, seconds: float, channels: int = 1) -> rtc.AudioFrame:
    samples = int(sample_rate * seconds)
    wave_form = (np.sin(np.arange(samples) / 8) * 8000).astype(np.int16)
    interleaved = np.repeat(wave_form, channels)
    return rtc.AudioFrame(interleaved.tobytes(), sample_rate, channels, samples)


def client_for(handler: httpx.MockTransport) -> SpeechClient:
    return SpeechClient("http://speech.test", timeout_seconds=5, transport=handler)


def wav_info(data: bytes) -> tuple[int, int, int]:
    with wave.open(io.BytesIO(data)) as reader:
        return reader.getframerate(), reader.getnchannels(), reader.getnframes()


async def test_health_is_read_and_validated() -> None:
    client = client_for(httpx.MockTransport(lambda _r: httpx.Response(200, json=HEALTH)))
    health = await client.health()
    assert (health.voice, health.sample_rate) == ("de_DE-ramona-low", 16000)


async def test_unreachable_service_is_a_speech_service_error() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(SpeechServiceError, match="not reachable"):
        await client_for(httpx.MockTransport(refuse)).health()


async def test_stt_sends_16_khz_mono_wav_and_returns_german_text() -> None:
    received: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        received.append(request)
        return httpx.Response(200, json={"text": "Ich möchte einen Rückruf."})

    stt = LocalSTT(client_for(httpx.MockTransport(answer)), language="de")
    event = await stt.recognize([tone(48000, 0.5, channels=2)], conn_options=NO_RETRY)
    assert event.alternatives[0].text == "Ich möchte einen Rückruf."
    assert event.alternatives[0].language == "de"
    (request,) = received
    assert request.url.path == "/transcribe"
    assert request.url.params["language"] == "de"
    rate, channels, frames = wav_info(request.content)
    assert (rate, channels) == (16000, 1)
    assert abs(frames - 8000) < 400


async def test_stt_maps_timeouts() -> None:
    def slow(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    stt = LocalSTT(client_for(httpx.MockTransport(slow)), language="de")
    with pytest.raises(APITimeoutError):
        await stt.recognize([tone(16000, 0.1)], conn_options=NO_RETRY)


async def test_tts_streams_the_samples_of_the_returned_wav() -> None:
    samples = (np.arange(1600) % 100).astype(np.int16)
    sent: list[object] = []

    def speak(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        body = pcm16_wav(samples.tobytes(), sample_rate=16000)
        return httpx.Response(200, content=body, headers={"Content-Type": "audio/wav"})

    tts = LocalTTS(client_for(httpx.MockTransport(speak)), sample_rate=16000)
    stream = tts.synthesize("Guten Tag.", conn_options=NO_RETRY)
    frame = await stream.collect()
    assert sent == [{"text": "Guten Tag."}]
    assert frame.sample_rate == 16000
    spoken = np.frombuffer(frame.data, dtype=np.int16)
    assert spoken[: len(samples)].tolist() == samples.tolist()
    assert not spoken[len(samples) :].any()


async def test_tts_rejects_a_voice_with_another_sample_rate() -> None:
    def speak(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=pcm16_wav(b"\0\0" * 10, sample_rate=22050))

    tts = LocalTTS(client_for(httpx.MockTransport(speak)), sample_rate=16000)
    with pytest.raises(APIStatusError, match="22050"):
        await tts.synthesize("Hallo.", conn_options=NO_RETRY).collect()


async def test_tts_maps_connection_errors() -> None:
    def refuse(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    tts = LocalTTS(client_for(httpx.MockTransport(refuse)), sample_rate=16000)
    with pytest.raises(APIConnectionError):
        await tts.synthesize("Hallo.", conn_options=NO_RETRY).collect()
