"""Hard upper bound for the length of a call.

Context: a call that runs away (a caller who never stops, a stuck line) must end politely and
free the line. | Input: maximum length and the farewell to run. | Output: the farewell, once.
"""

import asyncio
from collections.abc import Awaitable, Callable


class CallLimit:
    """Runs a farewell when a call reaches its maximum length."""

    def __init__(self, max_seconds: float, on_expire: Callable[[], Awaitable[None]]) -> None:
        """Create the limit.

        Args:
            max_seconds: Maximum call length in seconds.
            on_expire: Coroutine function that says goodbye and hangs up.

        Raises:
            ValueError: If max_seconds is not positive.
        """
        if max_seconds <= 0:
            raise ValueError("max_seconds must be positive")
        self._max_seconds = max_seconds
        self._on_expire = on_expire
        self._task: asyncio.Task[None] | None = None
        self._expired = False

    @property
    def expired(self) -> bool:
        """True once the maximum length was reached."""
        return self._expired

    def start(self) -> None:
        """Start counting; call once when the call is answered."""
        if self._task is not None:
            raise RuntimeError("call limit already started")
        self._task = asyncio.create_task(self._run(), name="call-limit")

    def cancel(self) -> None:
        """Stop counting, for example when the call ended before the limit."""
        if self._task is not None:
            self._task.cancel()

    async def _run(self) -> None:
        await asyncio.sleep(self._max_seconds)
        self._expired = True
        await self._on_expire()
