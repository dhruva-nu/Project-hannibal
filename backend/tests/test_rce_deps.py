"""Tests for the per-language dependency providers (SUB1).

Real-parser import detection (Python ``ast``, JavaScript tree-sitter), stdlib
filtering, import→package mapping, allowlist enforcement, and RUNTIME wiring.
No Docker, no network — pure logic.
"""

import pytest

from app.exception.rce_exception import UnpermittedDependency
from app.services.rce.config import RUNTIME
from app.services.rce.deps import DEPS_PROVIDERS, DepsProvider
from app.services.rce.deps.javascript import _specifier_to_package
from app.services.rce.deps.python import PythonImportDetector

_PY = DEPS_PROVIDERS["python"]
_JS = DEPS_PROVIDERS["javascript"]
_PY_DETECT = PythonImportDetector().detect
_JS_DETECT = _JS.detector.detect


# ── Python detection (ast) ────────────────────────────────────────────────────


class TestPythonImportDetector:
    def test_plain_import(self):
        assert _PY_DETECT("import numpy") == ["numpy"]

    def test_import_with_alias(self):
        assert _PY_DETECT("import numpy as np") == ["numpy"]

    def test_from_import(self):
        assert _PY_DETECT("from pandas import DataFrame") == ["pandas"]

    def test_dotted_import_uses_top_level(self):
        assert _PY_DETECT("import os.path") == ["os"]

    def test_dotted_from_import_uses_top_level(self):
        assert _PY_DETECT("from numpy.linalg import inv") == ["numpy"]

    def test_multiple_names_on_one_import(self):
        assert _PY_DETECT("import os, sys, numpy") == ["os", "sys", "numpy"]

    def test_relative_import_is_ignored(self):
        assert _PY_DETECT("from . import helpers") == []

    def test_relative_from_module_is_ignored(self):
        assert _PY_DETECT("from .utils import thing") == []

    def test_syntax_error_yields_no_dependencies(self):
        # Unparseable code cannot run; it reaches the sandbox as a SyntaxError.
        assert _PY_DETECT("import numpy\ndef broken(:\n    pass") == []

    def test_no_imports_returns_empty(self):
        assert _PY_DETECT("x = 1\nprint(x)") == []

    def test_import_inside_function_is_detected(self):
        assert _PY_DETECT("def f():\n    import numpy\n    return 1") == ["numpy"]


# ── JavaScript detection (tree-sitter) ────────────────────────────────────────


class TestJavaScriptImportDetector:
    def test_require(self):
        assert _JS_DETECT("const a = require('axios')") == ["axios"]

    def test_es_import_from(self):
        assert _JS_DETECT("import axios from 'axios'") == ["axios"]

    def test_named_import_from(self):
        assert _JS_DETECT("import { get } from 'axios'") == ["axios"]

    def test_side_effect_import(self):
        assert _JS_DETECT("import 'lodash'") == ["lodash"]

    def test_dynamic_import(self):
        assert _JS_DETECT("await import('axios')") == ["axios"]

    def test_export_from(self):
        assert _JS_DETECT("export { x } from 'lodash'") == ["lodash"]

    def test_scoped_package(self):
        assert _JS_DETECT("import x from '@scope/pkg'") == ["@scope/pkg"]

    def test_scoped_package_with_subpath(self):
        assert _JS_DETECT("require('@scope/pkg/sub')") == ["@scope/pkg"]

    def test_subpath_reduces_to_package(self):
        assert _JS_DETECT("import fp from 'lodash/fp'") == ["lodash"]

    def test_relative_import_is_ignored(self):
        assert _JS_DETECT("import x from './local'") == []

    def test_absolute_path_is_ignored(self):
        assert _JS_DETECT("require('/etc/passwd')") == []

    def test_ordinary_call_is_not_mistaken_for_import(self):
        assert _JS_DETECT("console.log('hi'); foo('bar')") == []

    def test_no_imports_returns_empty(self):
        assert _JS_DETECT("const x = 1;") == []

    def test_malformed_code_does_not_raise(self):
        # tree-sitter is error-tolerant: valid imports still surface.
        assert _JS_DETECT("import axios from 'axios'; const = ;") == ["axios"]


class TestSpecifierToPackage:
    def test_node_prefix_stripped(self):
        assert _specifier_to_package("node:fs") == "fs"

    def test_relative_returns_none(self):
        assert _specifier_to_package("./foo") is None

    def test_absolute_returns_none(self):
        assert _specifier_to_package("/foo") is None

    def test_scoped_keeps_two_segments(self):
        assert _specifier_to_package("@scope/pkg/sub") == "@scope/pkg"


# ── provider.dependencies (filtering + mapping + dedupe) ──────────────────────


class TestProviderDependencies:
    def test_python_filters_stdlib(self):
        code = "import os\nimport sys\nimport json\nimport numpy"
        assert _PY.dependencies(code) == ["numpy"]

    def test_python_stdlib_only_is_empty(self):
        assert _PY.dependencies("import os\nimport json") == []

    def test_python_dedupes_repeated_package(self):
        code = "import numpy\nimport numpy as np\nfrom numpy import array"
        assert _PY.dependencies(code) == ["numpy"]

    def test_python_applies_import_to_package_mapping(self):
        assert _PY.dependencies("import cv2") == ["opencv-python"]

    def test_python_maps_pil(self):
        assert _PY.dependencies("from PIL import Image") == ["Pillow"]

    def test_javascript_filters_node_builtins(self):
        code = "const fs = require('fs')\nconst a = require('axios')"
        assert _JS.dependencies(code) == ["axios"]

    def test_javascript_strips_node_prefix_builtin(self):
        assert _JS.dependencies("import fs from 'node:fs'") == []

    def test_javascript_dedupes(self):
        code = "import axios from 'axios'\nconst a = require('axios')"
        assert _JS.dependencies(code) == ["axios"]


# ── provider.resolve (allowlist enforcement) ──────────────────────────────────


class TestProviderResolve:
    def test_allowlisted_packages_pass(self):
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
