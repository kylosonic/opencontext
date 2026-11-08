"""OpenContext media processing worker."""

from importlib.metadata import PackageNotFoundError, version


def package_version() -> str:
    """Return the installed package version without a second release literal."""
    try:
        return version("opencontext-video")
    except PackageNotFoundError:
        return "0.0.0+unknown"


__version__ = package_version()
