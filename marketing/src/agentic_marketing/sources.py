"""Getting the plain text of a source.

Context: A check is only as good as the text it reads. Web pages, PDF files and files in
the workspace each need a different reader, and all three have to fail loudly rather
than return an empty string that would make every figure look missing. | Input: a
Source. | Output: plain text.
"""

from __future__ import annotations

import re
from pathlib import Path

import httpx
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from agentic_marketing.config import Settings
from agentic_marketing.errors import SourceError
from agentic_marketing.models import Source, SourceKind

MIN_USEFUL_CHARS = 40
DEFAULT_USER_AGENT = "agentic-marketing/0.1 (+https://github.com/DanielHuette/agentic-marketing)"
_TAG = re.compile(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", re.IGNORECASE | re.DOTALL)
_ENTITY = {"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'"}
RETRYABLE = (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError)


def strip_markup(html: str) -> str:
    """Reduce an HTML page to the text a reader would see."""
    text = _TAG.sub(" ", html)
    for entity, char in _ENTITY.items():
        text = text.replace(entity, char)
    return text


def pdf_to_text(data: bytes) -> str:
    """Extract the text layer of a PDF file.

    Args:
        data: The raw file.

    Returns:
        The concatenated text of every page.

    Raises:
        SourceError: If the file is not a readable PDF or carries no text layer.
    """
    import io

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except (PdfReadError, ValueError, OSError) as error:
        raise SourceError(f"cannot read the PDF: {error}") from error
    text = "\n".join(pages)
    if len(text.strip()) < MIN_USEFUL_CHARS:
        raise SourceError("the PDF carries no text layer; it would need optical recognition")
    return text


@retry(
    retry=retry_if_exception_type(RETRYABLE),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, max=8),
    reraise=True,
)
def _fetch(url: str, settings: Settings) -> httpx.Response:
    """Fetch a URL, retrying only what is worth retrying."""
    agent = DEFAULT_USER_AGENT
    if settings.contact:
        agent = f"{agent[:-1]}; {settings.contact})"
    headers = {"User-Agent": agent}
    with httpx.Client(timeout=settings.fetch_timeout, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
    response.raise_for_status()
    return response


def fetch_text(url: str, settings: Settings) -> str:
    """Get the text behind a URL, whether it serves a page or a PDF file.

    Args:
        url: Absolute address.
        settings: Timeout and contact address.

    Returns:
        The source as plain text.

    Raises:
        SourceError: If the address cannot be reached or holds no extractable text.
    """
    try:
        response = _fetch(url, settings)
    except httpx.HTTPStatusError as error:
        raise SourceError(f"{url} answered {error.response.status_code}") from error
    except httpx.HTTPError as error:
        raise SourceError(f"{url} cannot be reached: {error}") from error
    content_type = response.headers.get("content-type", "")
    if "pdf" in content_type.lower() or url.lower().endswith(".pdf"):
        return pdf_to_text(response.content)
    return strip_markup(response.text)


def read_local(path: Path) -> str:
    """Read a source that lives in the workspace.

    Args:
        path: Absolute path to the file.

    Returns:
        The file as plain text.

    Raises:
        SourceError: If the file is missing or its type is not readable as text.
    """
    if not path.is_file():
        raise SourceError(f"{path} does not exist")
    if path.suffix.lower() == ".pdf":
        return pdf_to_text(path.read_bytes())
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as error:
        raise SourceError(f"{path} cannot be read as text: {error}") from error


def extract_text(source: Source, root: Path, settings: Settings) -> str:
    """Get the plain text of a source, whatever kind it is.

    Args:
        source: The source to read.
        root: Workspace root, for a local path.
        settings: Timeout and contact address.

    Returns:
        The source as plain text.

    Raises:
        SourceError: If the source cannot be reached or holds no extractable text.
    """
    if source.kind is SourceKind.INTERNAL:
        raise SourceError("an internal source carries no text to check against")
    if source.kind is SourceKind.LOCAL:
        if source.path is None:
            raise SourceError("a local source without a path cannot be read")
        return read_local(root / source.path)
    if source.url is None:
        raise SourceError("a web source without a url cannot be read")
    return fetch_text(source.url, settings)
