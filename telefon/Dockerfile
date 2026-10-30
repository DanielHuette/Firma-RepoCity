# Images of the phone assistant: `agent` answers calls, `speech` runs faster-whisper and Piper.
# Built by docker-compose.yml; both run as an unprivileged user.

FROM python:3.12-slim-bookworm AS base
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN useradd --create-home --uid 10001 telefon

FROM base AS agent
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --extra agent --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --extra agent
USER telefon
CMD ["telefon-agent", "start"]

FROM base AS speech
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --extra speech --extra gpu --no-install-project
COPY src ./src
RUN uv sync --locked --no-dev --extra speech --extra gpu
# CTranslate2 finds cuBLAS and cuDNN of the pip wheels only through the library path.
ENV LD_LIBRARY_PATH=/app/.venv/lib/python3.12/site-packages/nvidia/cublas/lib:/app/.venv/lib/python3.12/site-packages/nvidia/cudnn/lib \
    HF_HOME=/models/huggingface
RUN mkdir -p /models && chown telefon /models
USER telefon
CMD ["telefon-speech"]
