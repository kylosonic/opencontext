"""Keep pytest temporary files inside the workspace.

Some restricted Windows environments block writes or renames under the
system temp directory. All tests already use temporary paths, so pointing
pytest and ``tempfile`` at a gitignored workspace directory is portable.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_TMP_ROOT = _REPO_ROOT / ".tmp" / "pytest"
_TMP_ROOT.mkdir(parents=True, exist_ok=True)

tempfile.tempdir = str(_TMP_ROOT)
os.environ["TMPDIR"] = str(_TMP_ROOT)
os.environ["TEMP"] = str(_TMP_ROOT)
os.environ["TMP"] = str(_TMP_ROOT)
