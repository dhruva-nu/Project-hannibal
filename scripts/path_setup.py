"""Put the backend package and the scripts dir on ``sys.path``.

Imported for its side effect by repo-root scripts (``seed.py``,
``rollback_related_courses.py``) before any ``app.*`` import, so that
``uv run python scripts/<name>.py`` resolves the backend package without an
installed wheel.
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT / "backend"))
sys.path.insert(0, str(_ROOT / "scripts"))
