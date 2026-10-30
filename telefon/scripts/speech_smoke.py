"""Speak a German sentence with Piper and transcribe it back with faster-whisper, offline.

Context: checks both speech engines on a machine without the rest of the server, for example
after a model change. | Input: voice and Whisper model names. | Output: a WAV file and the
recognised text on standard output.

Usage:
    uv run python scripts/speech_smoke.py --voice de_DE-ramona-low --whisper-model small \
        --model-dir models --out smoke.wav
"""

import argparse
from pathlib import Path

from repocity_telefon.speech_service.audio import read_whisper_wav
from repocity_telefon.speech_service.engines import PiperSynthesizer, WhisperTranscriber

SENTENCE = "Bitte rufen Sie mich morgen zurück, meine Nummer haben Sie."


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--voice", required=True, help="Piper voice, e.g. de_DE-ramona-low")
    parser.add_argument("--whisper-model", required=True, help="e.g. small or large-v3-turbo")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True, help="WAV file to write")
    parser.add_argument("--text", default=SENTENCE)
    return parser.parse_args()


def main() -> None:
    """Synthesise, save, transcribe and print."""
    args = _arguments()
    synthesizer = PiperSynthesizer.load(args.voice, args.model_dir / "piper")
    transcriber = WhisperTranscriber.load(
        args.whisper_model,
        device=args.device,
        compute_type=args.compute_type,
        download_root=args.model_dir / "whisper",
    )
    wav = synthesizer.synthesize(args.text)
    args.out.write_bytes(wav)
    print(f"Spoken:      {args.text}")
    print(f"Recognised:  {transcriber.transcribe(read_whisper_wav(wav), 'de')}")


if __name__ == "__main__":
    main()
