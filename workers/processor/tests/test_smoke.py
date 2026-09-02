"""Smoke tests for the oc_worker package."""

import oc_worker


def test_version() -> None:
    """The package exposes the expected version string."""
    assert oc_worker.__version__ == "0.1.0"
