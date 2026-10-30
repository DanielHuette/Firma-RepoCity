"""Tests of the HTTP interface of the speech service."""

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from repocity_telefon.speech_service.app import create_app
from repocity_telefon.speech_service.audio import (
    WHISPER_SAMPLE_RATE,
    InvalidAudioError,
    pcm16_wav,
    read_whisper_wav,
)


def wav_bytes(samples: np.ndarray, *, rate: int = WHISPER_SAMPLE_RATE, channels: int = 1) -> bytes:
    return pcm16_wav(samples.astype(np.int16).tobytes(), sample_rate=rate, channels=channels)


class FakeTranscriber:
    model_name = "small"

    def __init__(self) -> None:
        self.received: list[np.ndarray] = []

    def transcribe(self, audio: np.ndarray, language: str) -> str:
        self.received.append(audio)
        return f"Hallo ({language})"


class FakeSynthesizer:
    voice_name = "de_DE-ramona-low"
    sample_rate = 16000

    def synthesize(self, text: str) -> bytes:
        return wav_bytes(np.zeros(160, dtype=np.int16), rate=self.sample_rate)


@pytest.fixture
def transcriber() -> FakeTranscriber:
    return FakeTranscriber()


@pytest.fixture
def client(transcriber: FakeTranscriber) -> TestClient:
    return TestClient(create_app(transcriber, FakeSynthesizer()))


def test_read_whisper_wav_scales_to_unit_range() -> None:
    audio = read_whisper_wav(wav_bytes(np.array([0, 16384, -32768])))
    assert audio.dtype == np.float32
    assert audio.tolist() == [0.0, 0.5, -1.0]


def test_read_whisper_wav_rejects_other_sample_rates() -> None:
    with pytest.raises(InvalidAudioError, match="16000"):
        read_whisper_wav(wav_bytes(np.zeros(10), rate=8000))


def test_read_whisper_wav_rejects_stereo() -> None:
    with pytest.raises(InvalidAudioError, match="mono"):
        read_whisper_wav(wav_bytes(np.zeros(10), channels=2))


def test_read_whisper_wav_rejects_garbage() -> None:
    with pytest.raises(InvalidAudioError):
        read_whisper_wav(b"not a wav file")


def test_health_names_models(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "whisper_model": "small",
        "voice": "de_DE-ramona-low",
        "sample_rate": 16000,
    }


def test_transcribe_returns_text(client: TestClient, transcriber: FakeTranscriber) -> None:
    response = client.post(
        "/transcribe",
        params={"language": "de"},
        content=wav_bytes(np.zeros(1600)),
        headers={"Content-Type": "audio/wav"},
    )
    assert response.status_code == 200
    assert response.json() == {"text": "Hallo (de)"}
    assert len(transcriber.received[0]) == 1600


def test_transcribe_rejects_invalid_audio(client: TestClient) -> None:
    response = client.post("/transcribe", content=b"garbage")
    assert response.status_code == 400
    assert "detail" in response.json()


def test_transcribe_rejects_too_long_audio(client: TestClient) -> None:
    response = client.post("/transcribe", content=wav_bytes(np.zeros(WHISPER_SAMPLE_RATE * 61)))
    assert response.status_code == 413


def test_synthesize_returns_wav(client: TestClient) -> None:
    response = client.post("/synthesize", json={"text": "Guten Tag."})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(response.content)) as audio:
        assert audio.getframerate() == 16000


def test_synthesize_rejects_empty_text(client: TestClient) -> None:
    response = client.post("/synthesize", json={"text": "  "})
    assert response.status_code == 422
