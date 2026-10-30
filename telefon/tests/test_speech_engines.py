"""Tests of the faster-whisper and Piper engines."""

import io
import os
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

from repocity_telefon.speech_service.engines import (
    PiperSynthesizer,
    WhisperTranscriber,
    voice_files,
)


@dataclass
class Segment:
    text: str


class FakeWhisperModel:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def transcribe(self, audio: object, **options: object) -> tuple[list[Segment], object]:
        self.calls.append(options)
        return [Segment(" Guten Tag, "), Segment("hier spricht Erika. ")], None


def test_transcriber_joins_segments_and_fixes_language() -> None:
    model = FakeWhisperModel()
    transcriber = WhisperTranscriber(model, model_name="small")
    text = transcriber.transcribe(np.zeros(16000, dtype=np.float32), "de")
    assert text == "Guten Tag, hier spricht Erika."
    assert model.calls[0]["language"] == "de"


class FakeConfig:
    sample_rate = 16000


class FakeVoice:
    config = FakeConfig()

    def synthesize_wav(self, text: str, wav_file: wave.Wave_write) -> None:
        wav_file.setframerate(16000)
        wav_file.setsampwidth(2)
        wav_file.setnchannels(1)
        wav_file.writeframes(b"\x00\x00" * 160)


def test_synthesizer_returns_complete_wav() -> None:
    synthesizer = PiperSynthesizer(FakeVoice(), voice_name="de_DE-ramona-low")
    with wave.open(io.BytesIO(synthesizer.synthesize("Hallo."))) as audio:
        assert audio.getnframes() == 160
    assert synthesizer.sample_rate == 16000


def test_voice_is_downloaded_only_when_missing(tmp_path: Path) -> None:
    downloads: list[str] = []

    def download(voice: str, directory: Path) -> None:
        downloads.append(voice)
        for path in voice_files(voice, directory):
            path.write_bytes(b"model")

    model, config = voice_files("de_DE-ramona-low", tmp_path)
    assert (model.name, config.name) == ("de_DE-ramona-low.onnx", "de_DE-ramona-low.onnx.json")
    PiperSynthesizer.ensure_voice("de_DE-ramona-low", tmp_path, download)
    PiperSynthesizer.ensure_voice("de_DE-ramona-low", tmp_path, download)
    assert downloads == ["de_DE-ramona-low"]


@pytest.mark.skipif(
    os.environ.get("TELEFON_SPEECH_SMOKE") != "1",
    reason="downloads the Piper voice and the Whisper small model; set TELEFON_SPEECH_SMOKE=1",
)
def test_piper_speech_is_understood_by_whisper(tmp_path: Path) -> None:
    from repocity_telefon.speech_service.audio import read_whisper_wav

    synthesizer = PiperSynthesizer.load("de_DE-ramona-low", tmp_path)
    transcriber = WhisperTranscriber.load("small", device="cpu", compute_type="int8")
    wav = synthesizer.synthesize("Bitte rufen Sie mich morgen zurück, meine Nummer haben Sie.")
    text = transcriber.transcribe(read_whisper_wav(wav), "de")
    assert "rufen Sie mich morgen zurück" in text
