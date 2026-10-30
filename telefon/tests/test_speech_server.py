"""Tests of the start of the speech service from its settings."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from repocity_telefon.settings import SpeechSettings
from repocity_telefon.speech_service.server import create_service

from .test_speech_service import FakeSynthesizer, FakeTranscriber


@pytest.fixture
def settings(tmp_path: Path) -> SpeechSettings:
    return SpeechSettings(
        whisper_model="small",
        whisper_device="cpu",
        whisper_compute_type="int8",
        piper_voice="de_DE-ramona-low",
        speech_model_dir=tmp_path,
    )


def test_engines_are_loaded_as_configured(settings: SpeechSettings, tmp_path: Path) -> None:
    calls: list[tuple[object, ...]] = []

    def load_whisper(
        name: str, *, device: str, compute_type: str, download_root: Path | None
    ) -> FakeTranscriber:
        calls.append(("whisper", name, device, compute_type, download_root))
        return FakeTranscriber()

    def load_voice(name: str, directory: Path) -> FakeSynthesizer:
        calls.append(("piper", name, directory))
        return FakeSynthesizer()

    app = create_service(settings, load_whisper=load_whisper, load_voice=load_voice)
    assert calls == [
        ("whisper", "small", "cpu", "int8", tmp_path / "whisper"),
        ("piper", "de_DE-ramona-low", tmp_path / "piper"),
    ]
    assert TestClient(app).get("/health").json()["voice"] == "de_DE-ramona-low"
