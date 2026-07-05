"""Checks whether a package actually exists in its language's registry.

The lightest existence endpoint per registry (measured: npm ~65ms, PyPI
~200ms-1.4s and up to ~6s on a 404, crates ~300ms). A module-level
``httpx.Client`` keeps connections warm; a short TTL cache absorbs repeated
lookups (and shields us from PyPI's slow 404 path); a hard timeout means a
sluggish registry can never stall an editor keystroke.

A definite answer is ``True``/``False``. ``None`` means "could not tell"
(timeout or network error) — callers must not persist it or draw a red
squiggle from it.
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 4.0
_POSITIVE_TTL_SECONDS = 24 * 60 * 60  # existence rarely flips; cache a day
_NEGATIVE_TTL_SECONDS = 5 * 60  # a not-yet-published name may appear soon


@dataclass(frozen=True)
class _Registry:
    method: str
    url: Callable[[str], str]


def _crates_index_url(name: str) -> str:
    # crates.io sparse index shards names by length; Cargo itself uses this path.
    lowered = name.lower()
    if len(lowered) == 1:
        prefix = f"1/{lowered}"
    elif len(lowered) == 2:
        prefix = f"2/{lowered}"
    elif len(lowered) == 3:
        prefix = f"3/{lowered[0]}/{lowered}"
    else:
        prefix = f"{lowered[:2]}/{lowered[2:4]}/{lowered}"
    return f"https://index.crates.io/{prefix}"


_REGISTRIES: dict[str, _Registry] = {
    "python": _Registry(
        method="HEAD",
        url=lambda name: f"https://pypi.org/pypi/{quote(name, safe='')}/json",
    ),
    "javascript": _Registry(
        method="HEAD",
        # scoped names (@scope/pkg): keep '@', encode the slash as %2f per npm.
        url=lambda name: f"https://registry.npmjs.org/{quote(name, safe='@')}",
    ),
    "rust": _Registry(method="GET", url=_crates_index_url),
}

_USER_AGENT = "hannibal-rce-deps/1.0 (+package-existence-check)"

_client: httpx.Client | None = None
_cache: dict[tuple[str, str], tuple[bool, float]] = {}


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(
            timeout=_TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT},
        )
    return _client


def _cached(key: tuple[str, str]) -> bool | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    value, expires_at = hit
    if time.monotonic() >= expires_at:
        _cache.pop(key, None)
        return None
    return value


def _store(key: tuple[str, str], value: bool) -> None:
    ttl = _POSITIVE_TTL_SECONDS if value else _NEGATIVE_TTL_SECONDS
    _cache[key] = (value, time.monotonic() + ttl)


def exists(name: str, language: str) -> bool | None:
    """Whether ``name`` is a real package in ``language``'s registry.

    Returns ``None`` on an unsupported language or an unreachable registry.
    """
    registry = _REGISTRIES.get(language)
    if registry is None:
        logger.warning("no registry configured for language | language=%s", language)
        return None

    key = (language, name)
    cached = _cached(key)
    if cached is not None:
        return cached

    try:
        response = _get_client().request(registry.method, registry.url(name))
    except httpx.HTTPError:
        logger.warning(
            "registry lookup failed | language=%s name=%r",
            language,
            name,
            exc_info=True,
        )
        return None

    if response.status_code in (200, 404):
        result = response.status_code == 200
        _store(key, result)
        return result

    logger.warning(
        "unexpected registry status | language=%s name=%r status=%d",
        language,
        name,
        response.status_code,
    )
    return None


def _reset_for_tests() -> None:
    """Clear the module-level cache/client so tests start clean."""
    global _client
    _cache.clear()
    if _client is not None:
        _client.close()
        _client = None
