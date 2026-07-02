"""Tests for the per-language dependency providers (SUB1).

Import detection, stdlib filtering, import→package mapping, allowlist
enforcement, and the RUNTIME wiring. No Docker, no network — pure logic.
"""

import pytest

from app.exception.rce_exception import UnpermittedDependency
from app.services.rce.config import RUNTIME
from app.services.rce.deps import (
    DEPS_PROVIDERS,
    DepsProvider,
    _detect_javascript,
    _detect_python,
    _js_package_name,
)

_PY = DEPS_PROVIDERS["python"]
_JS = DEPS_PROVIDERS["javascript"]


# ── Python detection ─────────────────────────────────────────────────────────


class TestDetectPython:
    def test_plain_import(self):
        assert _detect_python("import numpy") == ["numpy"]

    def test_import_with_alias(self):
        assert _detect_python("import numpy as np") == ["numpy"]

    def test_from_import(self):
        assert _detect_python("from pandas import DataFrame") == ["pandas"]

    def test_dotted_import_uses_top_level(self):
        assert _detect_python("import os.path") == ["os"]

    def test_dotted_from_import_uses_top_level(self):
        assert _detect_python("from numpy.linalg import inv") == ["numpy"]

    def test_multiple_names_on_one_import(self):
        assert _detect_python("import os, sys, numpy") == ["os", "sys", "numpy"]

    def test_relative_import_is_ignored(self):
        assert _detect_python("from . import helpers") == []

    def test_relative_from_module_is_ignored(self):
        assert _detect_python("from .utils import thing") == []

    def test_syntax_error_falls_back_to_regex(self):
        code = "import numpy\ndef broken(:\n    pass"
        assert _detect_python(code) == ["numpy"]

    def test_no_imports_returns_empty(self):
        assert _detect_python("x = 1\nprint(x)") == []


# ── JavaScript detection ─────────────────────────────────────────────────────


class TestDetectJavascript:
    def test_require(self):
        assert _detect_javascript("const a = require('axios')") == ["axios"]

    def test_es_import_from(self):
        assert _detect_javascript("import axios from 'axios'") == ["axios"]

    def test_named_import_from(self):
        assert _detect_javascript("import { get } from 'axios'") == ["axios"]

    def test_side_effect_import(self):
        assert _detect_javascript("import 'lodash'") == ["lodash"]

    def test_dynamic_import(self):
        assert _detect_javascript("await import('axios')") == ["axios"]

    def test_scoped_package(self):
        assert _detect_javascript("import x from '@scope/pkg'") == ["@scope/pkg"]

    def test_scoped_package_with_subpath(self):
        out = _detect_javascript("require('@scope/pkg/sub')")
        assert out == ["@scope/pkg"]

    def test_subpath_reduces_to_package(self):
        assert _detect_javascript("import fp from 'lodash/fp'") == ["lodash"]

    def test_relative_import_is_ignored(self):
        assert _detect_javascript("import x from './local'") == []

    def test_absolute_path_is_ignored(self):
        assert _detect_javascript("require('/etc/passwd')") == []

    def test_no_imports_returns_empty(self):
        assert _detect_javascript("const x = 1;") == []


class TestJsPackageName:
    def test_node_prefix_stripped(self):
        assert _js_package_name("node:fs") == "fs"

    def test_relative_returns_none(self):
        assert _js_package_name("./foo") is None

    def test_absolute_returns_none(self):
        assert _js_package_name("/foo") is None


# ── provider.detect (filtering + mapping + dedupe) ────────────────────────────


class TestProviderDetect:
    def test_python_filters_stdlib(self):
        code = "import os\nimport sys\nimport json\nimport numpy"
        assert _PY.detect(code) == ["numpy"]

    def test_python_stdlib_only_is_empty(self):
        assert _PY.detect("import os\nimport json") == []

    def test_python_dedupes_repeated_package(self):
        code = "import numpy\nimport numpy as np\nfrom numpy import array"
        assert _PY.detect(code) == ["numpy"]

    def test_python_applies_import_to_package_mapping(self):
        assert _PY.detect("import cv2") == ["opencv-python"]

    def test_python_maps_pil(self):
        assert _PY.detect("from PIL import Image") == ["Pillow"]

    def test_javascript_filters_node_builtins(self):
        code = "const fs = require('fs')\nconst a = require('axios')"
        assert _JS.detect(code) == ["axios"]

    def test_javascript_strips_node_prefix_builtin(self):
        assert _JS.detect("import fs from 'node:fs'") == []

    def test_javascript_dedupes(self):
        code = "import axios from 'axios'\nconst a = require('axios')"
        assert _JS.detect(code) == ["axios"]


# ── provider.resolve (allowlist enforcement) ──────────────────────────────────


class TestProviderResolve:
    def test_allowlisted_package_passes(self):
        assert _PY.resolve("import numpy\nimport pandas") == ["numpy", "pandas"]

    def test_stdlib_only_resolves_empty(self):
        assert _PY.resolve("import os\nprint('hi')") == []

    def test_unlisted_package_raises(self):
        with pytest.raises(UnpermittedDependency) as exc:
            _PY.resolve("import tensorflow")
        assert exc.value.package == "tensorflow"
        assert exc.value.language == "python"

    def test_raises_on_first_unlisted_package(self):
        with pytest.raises(UnpermittedDependency) as exc:
            _PY.resolve("import numpy\nimport evilpkg")
        assert exc.value.package == "evilpkg"

    def test_javascript_allowlisted_passes(self):
        assert _JS.resolve("const a = require('axios')") == ["axios"]

    def test_javascript_unlisted_raises(self):
        with pytest.raises(UnpermittedDependency) as exc:
            _JS.resolve("import leftpad from 'leftpad'")
        assert exc.value.package == "leftpad"
        assert exc.value.language == "javascript"


# ── exception ─────────────────────────────────────────────────────────────────


class TestUnpermittedDependency:
    def test_stores_attributes(self):
        exc = UnpermittedDependency("tensorflow", "python")
        assert exc.package == "tensorflow"
        assert exc.language == "python"

    def test_str_names_package_and_language(self):
        exc = UnpermittedDependency("tensorflow", "python")
        assert "tensorflow" in str(exc)
        assert "python" in str(exc)


# ── RUNTIME wiring ────────────────────────────────────────────────────────────


class TestRuntimeWiring:
    @pytest.mark.parametrize("language", ["python", "javascript"])
    def test_runtime_exposes_deps_provider(self, language):
        provider = RUNTIME[language]["deps"]
        assert isinstance(provider, DepsProvider)
        assert provider.language == language

    @pytest.mark.parametrize("language", ["python", "javascript"])
    def test_provider_has_cache_volume_and_runtime_env(self, language):
        provider = RUNTIME[language]["deps"]
        assert provider.cache_volume
        assert provider.runtime_env

    def test_python_runtime_env_is_pythonpath(self):
        assert "PYTHONPATH" in RUNTIME["python"]["deps"].runtime_env

    def test_javascript_runtime_env_is_node_path(self):
        assert "NODE_PATH" in RUNTIME["javascript"]["deps"].runtime_env
