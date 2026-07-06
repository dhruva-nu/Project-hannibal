"""Tests for the global package cache volumes + mount strategy (SUB2).

Volume lifecycle against a mocked Docker client, and the mount-posture
contract: installer read-write, run read-only. No real Docker daemon.
"""

from unittest.mock import MagicMock

import docker
import pytest

from rce_service.deps import DEPS_PROVIDERS
from rce_service.deps.cache import (
    INSTALLER_UID,
    ensure_cache_volume,
    ensure_cache_writable,
    install_phase_mounts,
    prewarm_packages,
    run_phase_mounts,
)

_PY = DEPS_PROVIDERS["python"]
_JS = DEPS_PROVIDERS["javascript"]


# ── Volume lifecycle ──────────────────────────────────────────────────────────


class TestEnsureCacheVolume:
    def test_creates_volume_when_missing(self):
        client = MagicMock()
        client.volumes.get.side_effect = docker.errors.NotFound("missing")

        ensure_cache_volume(client, _PY)

        client.volumes.create.assert_called_once_with(_PY.cache_volume)

    def test_reuses_existing_volume(self):
        client = MagicMock()

        ensure_cache_volume(client, _PY)

        client.volumes.get.assert_called_once_with(_PY.cache_volume)
        client.volumes.create.assert_not_called()


class TestEnsureCacheWritable:
    def test_chowns_mount_point_to_installer_uid_unprivileged(self):
        client = MagicMock()

        ensure_cache_writable(client, _PY, "python:3.11-alpine")

        kwargs = client.containers.run.call_args.kwargs
        assert kwargs["command"] == [
            "chown",
            f"{INSTALLER_UID}:{INSTALLER_UID}",
            _PY.cache_path,
        ]
        assert kwargs["user"] == "0:0"  # root, but only to chown
        assert kwargs["network_mode"] == "none"
        assert kwargs["cap_drop"] == ["ALL"]
        assert kwargs["cap_add"] == ["CHOWN"]
        assert kwargs["read_only"] is True
        # writes only the cache volume, nothing else
        assert kwargs["volumes"] == install_phase_mounts(_PY)


# ── Mount posture: the security contract ──────────────────────────────────────


class TestMountPosture:
    @pytest.mark.parametrize("provider", [_PY, _JS], ids=["python", "javascript"])
    def test_installer_mounts_cache_read_write(self, provider):
        mounts = install_phase_mounts(provider)
        assert mounts == {
            provider.cache_volume: {"bind": provider.cache_path, "mode": "rw"}
        }

    @pytest.mark.parametrize("provider", [_PY, _JS], ids=["python", "javascript"])
    def test_run_mounts_cache_read_only(self, provider):
        mounts = run_phase_mounts(provider)
        assert mounts == {
            provider.cache_volume: {"bind": provider.cache_path, "mode": "ro"}
        }

    @pytest.mark.parametrize("provider", [_PY, _JS], ids=["python", "javascript"])
    def test_run_phase_never_gets_a_writable_mode(self, provider):
        assert all(spec["mode"] == "ro" for spec in run_phase_mounts(provider).values())


# ── Provider cache wiring ─────────────────────────────────────────────────────


class TestProviderCacheWiring:
    def test_each_language_has_its_own_volume(self):
        volumes = {p.cache_volume for p in DEPS_PROVIDERS.values()}
        assert len(volumes) == len(DEPS_PROVIDERS)

    @pytest.mark.parametrize("provider", [_PY, _JS], ids=["python", "javascript"])
    def test_runtime_env_resolves_inside_the_cache_mount(self, provider):
        for path in provider.runtime_env.values():
            assert path.startswith(provider.cache_path)

    def test_python_resolution_env(self):
        assert _PY.runtime_env == {"PYTHONPATH": "/opt/rce-cache/python"}

    def test_node_resolution_env_points_at_node_modules(self):
        assert _JS.runtime_env == {"NODE_PATH": "/opt/rce-cache/node/node_modules"}


# ── Pre-warm seed list ────────────────────────────────────────────────────────


class TestPrewarmPackages:
    @pytest.mark.parametrize("provider", [_PY, _JS], ids=["python", "javascript"])
    def test_prewarm_list_is_the_sorted_allowlist(self, provider):
        assert prewarm_packages(provider) == sorted(provider.allowlist)
