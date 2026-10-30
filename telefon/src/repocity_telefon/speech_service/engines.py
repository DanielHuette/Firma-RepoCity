"""Speech engines: faster-whisper for speech to text, Piper for text to speech.

Context: both run inside the speech service; models are fetched from Hugging Face on first start
and kept in the data volume. | Input: model and voice names. | Output: loaded engines.
"""

import io
import logging
import wave
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import numpy.typing as npt
from piper import PiperVoice
from piper.download_voices import download_voice

logger = logging.getLogger(__name__)

VoiceDownloader = Callable[[str, Path], None]


class _Segment(Protocol):
    text: str


class _WhisperModel(Protocol):
    def transcribe(self, audio: Any, **options: Any) -> tuple[Iterable[_Segment], Any]: ...


class _Voice(Protocol):
    @property
    def config(self) -> Any: ...

    def synthesize_wav(self, text: str, wav_file: wave.Wave_write) -> Any: ...


class WhisperTranscriber:
    """faster-whisper model that turns German speech into text."""

    def __init__(self, model: _WhisperModel, *, model_name: str) -> None:
        """Wrap a loaded model.

        Args:
            model: faster_whisper.WhisperModel or an object with the same transcribe method.
            model_name: Name reported by the health endpoint.
        """
        self._model = model
        self.model_name = model_name

    @classmethod
    def load(
        cls, model_name: str, *, device: str, compute_type: str, download_root: Path | None = None
    ) -> "WhisperTranscriber":
        """Load a model by name, downloading it on first use.

        Args:
            model_name: For example `large-v3-turbo` on a graphics card or `small` on CPU.
            device: `cuda`, `cpu` or `auto`.
            compute_type: CTranslate2 compute type, for example `float16` or `int8`.
            download_root: Directory that keeps downloaded models.
        """
        from faster_whisper import WhisperModel

        root = str(download_root) if download_root else None
        model = WhisperModel(
            model_name, device=device, compute_type=compute_type, download_root=root
        )
        logger.info("Whisper model %s loaded on %s", model_name, device)
        return cls(model, model_name=model_name)

    def transcribe(self, audio: npt.NDArray[np.float32], language: str) -> str:
        """Return the text of one utterance.

        Args:
            audio: 16 kHz float samples.
            language: Two-letter language code; fixed, so short replies are not misdetected.

        Returns:
            Recognised text without surrounding blanks.
        """
        segments, _ = self._model.transcribe(
            audio, language=language, beam_size=5, condition_on_previous_text=False
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


def voice_files(voice_name: str, directory: Path) -> tuple[Path, Path]:
    """Return the model and config paths of a Piper voice inside a directory."""
    return directory / f"{voice_name}.onnx", directory / f"{voice_name}.onnx.json"


class PiperSynthesizer:
    """Piper voice that turns German text into speech."""

    def __init__(self, voice: _Voice, *, voice_name: str) -> None:
        """Wrap a loaded voice.

        Args:
            voice: piper.PiperVoice or an object with the same synthesize_wav method.
            voice_name: Name reported by the health endpoint.
        """
        self._voice = voice
        self.voice_name = voice_name
        self.sample_rate: int = int(voice.config.sample_rate)

    @staticmethod
    def ensure_voice(
        voice_name: str, directory: Path, download: VoiceDownloader = download_voice
    ) -> Path:
        """Download a voice unless model and config are already present.

        Returns:
            Path of the voice model.
        """
        model, config = voice_files(voice_name, directory)
        if not (model.exists() and config.exists()):
            directory.mkdir(parents=True, exist_ok=True)
            logger.info("Downloading Piper voice %s", voice_name)
            download(voice_name, directory)
        return model

    @classmethod
    def load(cls, voice_name: str, directory: Path) -> "PiperSynthesizer":
        """Load a voice by name, downloading it on first use."""
        model = cls.ensure_voice(voice_name, directory)
        return cls(PiperVoice.load(model), voice_name=voice_name)

    def synthesize(self, text: str) -> bytes:
        """Speak text into a complete WAV file."""
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as writer:
            self._voice.synthesize_wav(text, writer)
        return buffer.getvalue()
