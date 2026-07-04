"""End-to-end smoke for dependency-aware execution (gated).

Needs a real Docker daemon and network access, so it only runs when
``RCE_SMOKE=1`` is set:

    RCE_SMOKE=1 uv run pytest tests/integration/test_rce_deps_smoke.py -q

It exercises the whole cold path once (installer → cache → offline run) and
the hot path right after.
"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("RCE_SMOKE") != "1",
    reason="needs Docker + network; set RCE_SMOKE=1 to run",
)


async def test_import_numpy_end_to_end():
    from app.services.rce import prepare_dependencies, run_code

    code = "import numpy as np\nprint(int(np.arange(4).sum()))"

    await prepare_dependencies(code, "python")  # cold: install into the cache
    result = run_code(code, "python")  # offline run resolves from the cache

    assert result["exit_code"] == 0, result["stderr"]
    assert result["stdout"].strip() == "6"

    await prepare_dependencies(code, "python")  # hot: must be a pure cache hit
    rerun = run_code(code, "python")
    assert rerun["exit_code"] == 0
