"""Start of the speech service: load both engines, then serve HTTP.

Context: entry point of the `speech` container; models are downloaded into the model volume on
the first start and reused afterwards. | Input: SpeechSettings from the environment. | Output: a
running HTTP service on the configured address.

Usage:
    telefon-speech
"""

import logging
from collections.abc import Callable
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from ..errors import ConfigurationError
from ..settings import SpeechSettings, load
from .app import Synthesizer, Transcriber, create_app
from .engines import PiperSynthesizer, WhisperTranscriber

WhisperLoader = Callable[..., Transcriber]
VoiceLoader = Callable[[str, Path], Synthesizer]


def create_service(
    settings: SpeechSettings,
    *,
    load_whisper: WhisperLoader = WhisperTranscriber.load,
    load_voice: VoiceLoader = PiperSynthesizer.load,
) -> FastAPI:
    """Load the engines named in the settings and wrap them in the HTTP interface.

    Args:
        settings: Model names, device and model directory.
        load_whisper: Loader of the speech to text engine, replaced in tests.
        load_voice: Loader of the voice, replaced in tests.

    Returns:
        The ready application.
    """
    transcriber = load_whisper(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
        download_root=settings.speech_model_dir / "whisper",
    )
    synthesizer = load_voice(settings.piper_voice, settings.speech_model_dir / "piper")
    return create_app(transcriber, synthesizer)


def main() -> None:
    """Read the settings, load the models and serve until stopped."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        settings = load(SpeechSettings)
    except ConfigurationError as error:
        raise SystemExit(f"telefon-speech: {error}") from error
    uvicorn.run(create_service(settings), host=settings.speech_host, port=settings.speech_port)


if __name__ == "__main__":
    main()
