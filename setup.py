"""setup.py shim — metadata lives in ``pyproject.toml``.

This file exists solely to register a post-install hook that attempts to
install Graphviz's ``dot`` binary, which is required at runtime by the
overflow-graph rendering pipeline (pydot → dot). The binary cannot be
shipped as a Python wheel, so we shell out to the platform's package
manager. See ``expert_backend/install_graphviz.py`` for the per-OS logic.

Note: modern pip builds a wheel before installing, so the ``install``
``cmdclass`` only runs reliably for legacy / editable installs
(``pip install -e .``). For wheel-based flows users (and CI) should
run the bundled console script ``costudy4grid-install-graphviz`` —
this remains the cross-platform entry point.
"""
from __future__ import annotations

import os
import sys

from setuptools import setup
from setuptools.command.develop import develop
from setuptools.command.install import install


def _post_install() -> None:
    if os.environ.get("COSTUDY4GRID_SKIP_GRAPHVIZ_INSTALL"):
        return
    try:
        sys.path.insert(0, os.path.dirname(__file__))
        from expert_backend import install_graphviz  # type: ignore
        install_graphviz.ensure_dot()
    except Exception as exc:  # noqa: BLE001 — best-effort, never block install
        print(f"[co-study4grid] graphviz post-install skipped: {exc}",
              file=sys.stderr)


class _PostInstall(install):
    def run(self) -> None:
        install.run(self)
        _post_install()


class _PostDevelop(develop):
    def run(self) -> None:
        develop.run(self)
        _post_install()


setup(
    cmdclass={
        "install": _PostInstall,
        "develop": _PostDevelop,
    },
)
