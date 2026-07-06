"""Tests for the install queue (SUB4).

Dep-set hashing stability, cache-hit bypass, in-flight dedupe, single-writer
locking, and clean-cache failure semantics. The installer itself is always
mocked — no Docker.
"""

import asyncio
import dataclasses

import pytest

from rce_service.deps import DEPS_PROVIDERS
from rce_service.exceptions import DependencyInstallError
from rce_service.install_queue import InstallQueue, dep_set_hash
from rce_service.installer import INSTALLED_MARKER_DIR


def _provider(tmp_path):
    """The real python provider, pointed at a throwaway cache directory."""
    return dataclasses.replace(DEPS_PROVIDERS["python"], cache_path=str(tmp_path))


def _mark_installed(tmp_path, package: str) -> None:
    marker_dir = tmp_path / INSTALLED_MARKER_DIR
    marker_dir.mkdir(exist_ok=True)
    (marker_dir / package).touch()


# ── dep-set hashing ───────────────────────────────────────────────────────────


class TestDepSetHash:
    def test_is_order_insensitive(self):
        assert dep_set_hash(["numpy", "pandas"]) == dep_set_hash(["pandas", "numpy"])

    def test_is_duplicate_insensitive(self):
        assert dep_set_hash(["numpy", "numpy"]) == dep_set_hash(["numpy"])

    def test_differs_for_different_sets(self):
        assert dep_set_hash(["numpy"]) != dep_set_hash(["pandas"])

    def test_is_stable_across_processes(self):
        assert dep_set_hash(["numpy", "pandas"]) == (
            "97a7dc4ac5aa1f858d456434391e8788664e2ab4d7cb50165c2a7ba43704aa7b"
        )


# ── cache resolution ──────────────────────────────────────────────────────────


class TestCacheHit:
    async def test_marker_hit_bypasses_the_queue_entirely(self, tmp_path, mocker):
        install = mocker.patch("rce_service.install_queue.install_packages")
        provider = _provider(tmp_path)
        _mark_installed(tmp_path, "numpy")

        await InstallQueue().ensure(provider, ["numpy"])

        install.assert_not_called()

    async def test_successful_install_is_remembered_in_process(self, tmp_path, mocker):
        install = mocker.patch("rce_service.install_queue.install_packages")
        provider = _provider(tmp_path)
        queue = InstallQueue()

        await queue.ensure(provider, ["numpy"])
        await queue.ensure(provider, ["numpy"])

        install.assert_called_once()

    async def test_only_missing_packages_are_installed(self, tmp_path, mocker):
        install = mocker.patch("rce_service.install_queue.install_packages")
        provider = _provider(tmp_path)
        _mark_installed(tmp_path, "numpy")

        await InstallQueue().ensure(provider, ["numpy", "pandas"])

        install.assert_called_once_with(provider, ["pandas"])

    async def test_package_cached_between_scan_and_admission_is_skipped(
        self, tmp_path, mocker
    ):
        """A dep missing at scan time but cached by the time we hold the
        admission lock (its install job finished while we queued) is not
        re-installed."""
        install = mocker.patch("rce_service.install_queue.install_packages")
        provider = _provider(tmp_path)
        queue = InstallQueue()
        mocker.patch.object(queue, "_is_cached", side_effect=[False, True])

        await queue.ensure(provider, ["numpy"])

        install.assert_not_called()


# ── in-flight dedupe + locking ────────────────────────────────────────────────


class TestConcurrency:
    async def test_concurrent_identical_misses_run_one_install(self, tmp_path, mocker):
        loop = asyncio.get_running_loop()
        started = asyncio.Event()
        release = asyncio.Event()
        calls = []

        def slow_install(provider, packages):
            calls.append(packages)
            loop.call_soon_threadsafe(started.set)
            asyncio.run_coroutine_threadsafe(release.wait(), loop).result(timeout=5)

        mocker.patch(
            "rce_service.install_queue.install_packages",
            side_effect=slow_install,
        )
        provider = _provider(tmp_path)
        queue = InstallQueue()

        waiters = [
            asyncio.ensure_future(queue.ensure(provider, ["numpy"])) for _ in range(30)
        ]
        await started.wait()
        release.set()
        await asyncio.gather(*waiters)

        assert calls == [["numpy"]]

    async def test_volume_has_a_single_writer_at_a_time(self, tmp_path, mocker):
        active = 0
        peak = 0

        def tracking_install(provider, packages):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            active -= 1

        mocker.patch(
            "rce_service.install_queue.install_packages",
            side_effect=tracking_install,
        )
        provider = _provider(tmp_path)
        queue = InstallQueue()

        await asyncio.gather(
            queue.ensure(provider, ["numpy"]),
            queue.ensure(provider, ["pandas"]),
            queue.ensure(provider, ["requests"]),
        )

        assert peak == 1


# ── failure semantics ─────────────────────────────────────────────────────────


class TestFailure:
    async def test_failed_install_propagates_and_leaves_cache_clean(
        self, tmp_path, mocker
    ):
        install = mocker.patch(
            "rce_service.install_queue.install_packages",
            side_effect=DependencyInstallError(["numpy"], "python", "boom"),
        )
        provider = _provider(tmp_path)
        queue = InstallQueue()

        with pytest.raises(DependencyInstallError):
            await queue.ensure(provider, ["numpy"])

        assert not (tmp_path / INSTALLED_MARKER_DIR).exists()
        install.side_effect = None
        await queue.ensure(provider, ["numpy"])  # retry works: job was forgotten
        assert install.call_count == 2
