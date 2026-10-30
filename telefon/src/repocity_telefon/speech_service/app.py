"""HTTP interface of the speech service.

Context: the agent calls it once per caller utterance and once per spoken sentence. | Input:
WAV audio to transcribe, German text to speak. | Output: JSON transcripts, WAV audio, health.
"""

import asyncio
from typing import Annotated, Protocol

import numpy as np
import numpy.typing as npt
from fastapi import FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator

from .audio import WHISPER_SAMPLE_RATE, InvalidAudioError, read_whisper_wav

MAX_UTTERANCE_SECONDS = 60
MAX_TEXT_CHARS = 1000
_MAX_UPLOAD_BYTES = WHISPER_SAMPLE_RATE * 2 * MAX_UTTERANCE_SECONDS + 1024


class Transcriber(Protocol):
    """Speech to text engine."""

    model_name: str

    def transcribe(self, audio: npt.NDArray[np.float32], language: str) -> str:
        """Return the text spoken in 16 kHz float samples."""
        ...


class Synthesizer(Protocol):
    """Text to speech engine."""

    voice_name: str
    sample_rate: int

    def synthesize(self, text: str) -> bytes:
        """Return the text spoken as a WAV file."""
        ...


class SpeakRequest(BaseModel):
    """Text to speak."""

    text: str = Field(max_length=MAX_TEXT_CHARS)

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text must not be blank")
        return value.strip()


class Transcript(BaseModel):
    """Recognised text."""

    text: str


def create_app(transcriber: Transcriber, synthesizer: Synthesizer) -> FastAPI:
    """Build the service around loaded engines.

    Args:
        transcriber: Speech to text engine.
        synthesizer: Text to speech engine.

    Returns:
        The FastAPI application.
    """
    app = FastAPI(title="RepoCity speech service")
    transcribe_lock, speak_lock = asyncio.Lock(), asyncio.Lock()

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "status": "ok",
            "whisper_model": transcriber.model_name,
            "voice": synthesizer.voice_name,
            "sample_rate": synthesizer.sample_rate,
        }

    @app.post("/transcribe")
    async def transcribe(
        request: Request, language: Annotated[str, Query(pattern="^[a-z]{2}$")] = "de"
    ) -> Transcript:
        audio = _decode(await request.body())
        async with transcribe_lock:
            text = await asyncio.to_thread(transcriber.transcribe, audio, language)
        return Transcript(text=text)

    @app.post("/synthesize")
    async def synthesize(body: SpeakRequest) -> Response:
        async with speak_lock:
            wav = await asyncio.to_thread(synthesizer.synthesize, body.text)
        return Response(content=wav, media_type="audio/wav")

    return app


def _decode(body: bytes) -> npt.NDArray[np.float32]:
    if len(body) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="utterance longer than 60 seconds")
    try:
        return read_whisper_wav(body)
    except InvalidAudioError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
