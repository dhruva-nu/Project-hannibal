"""Tests for PackageSearchService (index search + registry verify)."""

from datetime import UTC, datetime

import pytest

from app.models.rce_package_model import RcePackage
from app.services.rce.package_search_service import PackageSearchService


def _package(name: str, exists: bool = True, in_cache: bool = False) -> RcePackage:
    return RcePackage(
        language="python",
        name=name,
        exists=exists,
        in_cache=in_cache,
        checked_at=datetime.now(UTC),
    )


class TestSearch:
    def test_returns_names_from_repo(self, mocker):
        repo = mocker.MagicMock()
        repo.search_prefix.return_value = [_package("requests"), _package("regex")]
        service = PackageSearchService(repo, existence_checker=mocker.MagicMock())

        assert service.search("python", "re") == ["requests", "regex"]
        repo.search_prefix.assert_called_once_with("python", "re")

    def test_blank_query_short_circuits(self, mocker):
        repo = mocker.MagicMock()
        service = PackageSearchService(repo, existence_checker=mocker.MagicMock())

        assert service.search("python", "   ") == []
        repo.search_prefix.assert_not_called()

    def test_unsupported_language_raises(self, mocker):
        service = PackageSearchService(
            mocker.MagicMock(), existence_checker=mocker.MagicMock()
        )
        with pytest.raises(ValueError):
            service.search("cobol", "re")


class TestVerify:
    def test_cache_hit_skips_registry(self, mocker):
        repo = mocker.MagicMock()
        repo.get.return_value = _package("requests", exists=True, in_cache=True)
        checker = mocker.MagicMock()
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "requests")

        assert (result.exists, result.in_cache) == (True, True)
        checker.assert_not_called()
        repo.upsert.assert_not_called()

    def test_miss_hits_registry_and_upserts(self, mocker):
        repo = mocker.MagicMock()
        repo.get.return_value = None
        checker = mocker.MagicMock(return_value=True)
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "httpx")

        assert result.exists is True
        checker.assert_called_once_with("httpx", "python")
        repo.upsert.assert_called_once_with("python", "httpx", exists=True)

    def test_miss_nonexistent_upserts_false(self, mocker):
        repo = mocker.MagicMock()
        repo.get.return_value = None
        checker = mocker.MagicMock(return_value=False)
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "nope123")

        assert result.exists is False
        repo.upsert.assert_called_once_with("python", "nope123", exists=False)

    def test_registry_unreachable_does_not_persist(self, mocker):
        repo = mocker.MagicMock()
        repo.get.return_value = None
        checker = mocker.MagicMock(return_value=None)
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "flaky")

        assert result.exists is None
        assert result.in_cache is False
        repo.upsert.assert_not_called()

    def test_stdlib_is_always_available(self, mocker):
        repo = mocker.MagicMock()
        checker = mocker.MagicMock()
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "os")

        assert (result.exists, result.in_cache) == (True, True)
        checker.assert_not_called()
        repo.get.assert_not_called()

    def test_import_name_mapped_to_distribution(self, mocker):
        repo = mocker.MagicMock()
        repo.get.return_value = None
        checker = mocker.MagicMock(return_value=True)
        service = PackageSearchService(repo, existence_checker=checker)

        result = service.verify("python", "cv2")

        assert result.name == "cv2"  # response echoes what the editor asked
        checker.assert_called_once_with("opencv-python", "python")
        repo.upsert.assert_called_once_with("python", "opencv-python", exists=True)

    def test_blank_name_raises(self, mocker):
        service = PackageSearchService(
            mocker.MagicMock(), existence_checker=mocker.MagicMock()
        )
        with pytest.raises(ValueError):
            service.verify("python", "  ")
