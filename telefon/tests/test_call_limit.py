"""Tests of the hard maximum call length."""

import asyncio

import pytest

from repocity_telefon.call_limit import CallLimit


async def test_limit_runs_farewell_after_maximum_length() -> None:
    expired = asyncio.Event()

    async def farewell() -> None:
        expired.set()

    limit = CallLimit(max_seconds=0.01, on_expire=farewell)
    limit.start()
    await asyncio.wait_for(expired.wait(), timeout=1)
    assert limit.expired


async def test_cancelled_limit_never_fires() -> None:
    fired: list[bool] = []

    async def farewell() -> None:
        fired.append(True)

    limit = CallLimit(max_seconds=0.02, on_expire=farewell)
    limit.start()
    limit.cancel()
    await asyncio.sleep(0.05)
    assert fired == []
    assert not limit.expired


def test_limit_rejects_non_positive_length() -> None:
    async def farewell() -> None:
        return None

    with pytest.raises(ValueError, match="positive"):
        CallLimit(max_seconds=0, on_expire=farewell)


async def test_starting_twice_is_refused() -> None:
    async def farewell() -> None:
        return None

    limit = CallLimit(max_seconds=10, on_expire=farewell)
    limit.start()
    with pytest.raises(RuntimeError, match="already"):
        limit.start()
    limit.cancel()
