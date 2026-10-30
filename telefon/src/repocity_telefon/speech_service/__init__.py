"""Local speech service: faster-whisper for speech to text, Piper for text to speech.

Context: runs as its own container on the RepoCity server, next to the agent. | Input: WAV audio
and German text over HTTP. | Output: transcripts and WAV audio.
"""
