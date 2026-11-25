"""Plugin discovery, validation, and lifecycle hook runner for oc_worker."""

from __future__ import annotations

import importlib
import importlib.metadata
import logging
import re
from collections.abc import Iterable, Sequence
from typing import Any, Protocol, runtime_checkable

log = logging.getLogger("oc_worker.plugins")

PLUGIN_SPEC_RE = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*$"
)


@runtime_checkable
class WorkerPlugin(Protocol):
    """Contract implemented by OpenContext worker plugins."""

    name: str

    def on_frames_extracted(
        self,
        frames: list[dict[str, Any]],
        meta: dict[str, Any],
    ) -> list[dict[str, Any]] | None:
        ...

    def on_context_built(
        self,
        payload: dict[str, Any],
        markdown: str,
    ) -> tuple[dict[str, Any], str] | None:
        ...


def parse_plugin_specs(raw: str | Iterable[str] | None) -> list[str]:
    """Parse comma/whitespace-separated or iterable plugin specs (`mod.path:attr`)."""
    if not raw:
        return []
    items = [raw] if isinstance(raw, str) else list(raw)
    specs: list[str] = []
    seen: set[str] = set()
    for item in items:
        for part in str(item).replace(",", " ").split():
            cleaned = part.strip()
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                specs.append(cleaned)
    return specs


def _instantiate_plugin(target: Any, source_label: str) -> Any:
    if isinstance(target, type) or (
        callable(target)
        and not hasattr(target, "on_frames_extracted")
        and not hasattr(target, "on_context_built")
    ):
        instance = target()
    else:
        instance = target
    if not hasattr(instance, "name") or not isinstance(instance.name, str):
        instance.name = source_label
    return instance


def load_plugin_from_spec(spec: str) -> Any:
    """Import and instantiate one validated `module.path:attr` plugin spec."""
    if not PLUGIN_SPEC_RE.match(spec):
        raise ValueError(
            f"Invalid plugin spec {spec!r}; expected 'module.path:attribute'"
        )
    module_name, _, attr_name = spec.partition(":")
    module = importlib.import_module(module_name)
    if not hasattr(module, attr_name):
        raise ValueError(
            f"Plugin attribute {attr_name!r} was not found in module {module_name!r}"
        )
    return _instantiate_plugin(getattr(module, attr_name), spec)


def load_plugins(
    specs: Iterable[str] = (),
    *,
    include_entry_points: bool = True,
) -> list[Any]:
    """Load explicit `module:attr` plugins plus installed `opencontext.plugins` entry points."""
    loaded: list[Any] = []
    for spec in parse_plugin_specs(list(specs)):
        loaded.append(load_plugin_from_spec(spec))

    if include_entry_points:
        try:
            eps = importlib.metadata.entry_points(group="opencontext.plugins")
        except Exception:  # noqa: BLE001
            eps = ()
        for ep in eps:
            loaded.append(_instantiate_plugin(ep.load(), ep.name))

    return loaded


def describe_plugins(plugins: Sequence[Any]) -> list[dict[str, Any]]:
    """Summarize loaded plugins and their supported lifecycle hooks."""
    summary: list[dict[str, Any]] = []
    for plugin in plugins:
        hooks: list[str] = []
        if callable(getattr(plugin, "on_frames_extracted", None)):
            hooks.append("on_frames_extracted")
        if callable(getattr(plugin, "on_context_built", None)):
            hooks.append("on_context_built")
        summary.append(
            {
                "name": str(getattr(plugin, "name", type(plugin).__name__)),
                "hooks": hooks,
            }
        )
    return summary


def apply_frame_plugins(
    plugins: Sequence[Any],
    frames: list[dict[str, Any]],
    meta: dict[str, Any],
) -> list[dict[str, Any]]:
    """Run `on_frames_extracted` hooks across loaded plugins."""
    current = list(frames)
    for plugin in plugins:
        hook = getattr(plugin, "on_frames_extracted", None)
        if not callable(hook):
            continue
        result = hook(list(current), dict(meta))
        if result is not None:
            current = list(result)
    return current


def apply_context_plugins(
    plugins: Sequence[Any],
    payload: dict[str, Any],
    markdown: str,
) -> tuple[dict[str, Any], str]:
    """Run `on_context_built` hooks across loaded plugins."""
    current_payload = payload
    current_markdown = markdown
    for plugin in plugins:
        hook = getattr(plugin, "on_context_built", None)
        if not callable(hook):
            continue
        result = hook(current_payload, current_markdown)
        if isinstance(result, tuple) and len(result) == 2:
            current_payload, current_markdown = result
    return current_payload, current_markdown
