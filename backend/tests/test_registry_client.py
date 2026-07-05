"""Tests for the registry existence client (httpx + TTL cache)."""

import httpx
import pytest

from app.services.rce.deps import registry_client


@pytest.fixture(autouse=True)
def reset_client():
    registry_client._reset_for_tests()
    yield
    registry_client._reset_for_tests()


def _mock_request(mocker, *, status_code=None, error=None):
    def handler(method, url, **kwargs):
        if error is not None:
            raise error
        return httpx.Response(status_code, request=httpx.Request(method, url))

    mocker.patch.object(registry_client._get_client(), "request", side_effect=handler)


class TestExists:
    def test_present_returns_true(self, mocker):
        _mock_request(mocker, status_code=200)
        assert registry_client.exists("requests", "python") is True

    def test_absent_returns_false(self, mocker):
        _mock_request(mocker, status_code=404)
        assert registry_client.exists("nope123", "python") is False

    def test_unsupported_language_returns_none(self, mocker):
        assert registry_client.exists("x", "cobol") is None

    def test_network_error_returns_none(self, mocker):
        _mock_request(mocker, error=httpx.ConnectError("boom"))
        assert registry_client.exists("flaky", "python") is None

    def test_unexpected_status_returns_none(self, mocker):
        _mock_request(mocker, status_code=500)
        assert registry_client.exists("weird", "python") is None

    def test_positive_result_is_cached(self, mocker):
        _mock_request(mocker, status_code=200)
        registry_client.exists("requests", "python")
        registry_client.exists("requests", "python")
        assert registry_client._get_client().request.call_count == 1

    def test_none_result_is_not_cached(self, mocker):
        _mock_request(mocker, error=httpx.ConnectError("boom"))
        registry_client.exists("flaky", "python")
        registry_client.exists("flaky", "python")
        assert registry_client._get_client().request.call_count == 2

    def test_expired_cache_entry_triggers_a_fresh_lookup(self, mocker):
        _mock_request(mocker, status_code=200)
        clock = mocker.patch.object(registry_client.time, "monotonic")
        clock.return_value = 1000.0
        registry_client.exists("requests", "python")  # cached at t=1000

        clock.return_value = 1000.0 + registry_client._POSITIVE_TTL_SECONDS + 1
        registry_client.exists("requests", "python")  # entry expired -> re-fetch

        assert registry_client._get_client().request.call_count == 2


class TestCratesUrl:
    def test_shards_by_name_length(self):
        assert registry_client._crates_index_url("a").endswith("/1/a")
        assert registry_client._crates_index_url("ab").endswith("/2/ab")
        assert registry_client._crates_index_url("abc").endswith("/3/a/abc")
        assert registry_client._crates_index_url("serde").endswith("/se/rd/serde")
