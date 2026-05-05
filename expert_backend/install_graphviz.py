"""Best-effort cross-platform installer for the Graphviz ``dot`` binary.

Co-Study4Grid renders the overflow graph through ``pydot`` /
``networkx.drawing.nx_pydot``, which shells out to Graphviz's ``dot``
executable. ``dot`` is a system-level binary and cannot be shipped as a
pure-Python wheel, so we provide this helper which is invoked from
``setup.py`` after a regular ``pip install``.

The script is intentionally best-effort: if it can't find a supported
package manager or the install fails (no sudo, locked package DB, etc.)
it prints a clear, actionable message rather than aborting the whole
``pip install``. Users can also run it manually:

    python -m scripts.install_graphviz
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys

MANUAL_HINT = """\
Could not auto-install Graphviz. Please install it manually so the
``dot`` binary is on PATH:

  Linux (Debian/Ubuntu):  sudo apt-get install graphviz
  Linux (RHEL/Fedora):    sudo dnf install graphviz   (or yum)
  Linux (Arch):           sudo pacman -S graphviz
  Linux (Alpine):         sudo apk add graphviz
  macOS (Homebrew):       brew install graphviz
  macOS (MacPorts):       sudo port install graphviz
  Windows (Chocolatey):   choco install graphviz
  Windows (winget):       winget install Graphviz.Graphviz
  Windows (Scoop):        scoop install graphviz

After installation, verify with:  dot -V
"""


def _run(cmd: list[str]) -> int:
    print("+ " + " ".join(cmd), flush=True)
    try:
        return subprocess.call(cmd)
    except FileNotFoundError:
        return 127


def _maybe_sudo(cmd: list[str]) -> list[str]:
    if os.name == "nt":
        return cmd
    if os.geteuid() == 0:  # type: ignore[attr-defined]
        return cmd
    if shutil.which("sudo"):
        return ["sudo", "-n", *cmd]
    return cmd


def _install_linux() -> bool:
    candidates = [
        ("apt-get", ["apt-get", "install", "-y", "graphviz"]),
        ("dnf", ["dnf", "install", "-y", "graphviz"]),
        ("yum", ["yum", "install", "-y", "graphviz"]),
        ("pacman", ["pacman", "-S", "--noconfirm", "graphviz"]),
        ("apk", ["apk", "add", "--no-cache", "graphviz"]),
        ("zypper", ["zypper", "install", "-y", "graphviz"]),
    ]
    for tool, cmd in candidates:
        if shutil.which(tool):
            if _run(_maybe_sudo(cmd)) == 0:
                return True
    return False


def _install_macos() -> bool:
    if shutil.which("brew"):
        if _run(["brew", "install", "graphviz"]) == 0:
            return True
    if shutil.which("port"):
        if _run(_maybe_sudo(["port", "install", "graphviz"])) == 0:
            return True
    return False


def _install_windows() -> bool:
    candidates = [
        ("choco", ["choco", "install", "graphviz", "-y", "--no-progress"]),
        ("winget", ["winget", "install", "--id", "Graphviz.Graphviz",
                    "-e", "--accept-source-agreements",
                    "--accept-package-agreements"]),
        ("scoop", ["scoop", "install", "graphviz"]),
    ]
    for tool, cmd in candidates:
        if shutil.which(tool):
            if _run(cmd) == 0:
                return True
    return False


def ensure_dot() -> bool:
    """Ensure ``dot`` is on PATH; return True if it is (after install)."""
    if shutil.which("dot"):
        print("Graphviz 'dot' already installed; skipping.", flush=True)
        return True

    system = platform.system()
    print(f"Graphviz 'dot' not found on PATH; attempting install on {system}...",
          flush=True)

    ok = False
    if system == "Linux":
        ok = _install_linux()
    elif system == "Darwin":
        ok = _install_macos()
    elif system == "Windows":
        ok = _install_windows()
    else:
        print(f"Unsupported platform: {system}", flush=True)

    # Re-check PATH (some installers update PATH only in new shells).
    if shutil.which("dot"):
        return True

    if not ok:
        print(MANUAL_HINT, file=sys.stderr, flush=True)
    else:
        # The package manager succeeded but PATH may not be refreshed
        # in this shell. Don't fail loudly.
        print(
            "Graphviz install command completed but 'dot' is not yet on PATH "
            "in this shell. Open a new terminal and run `dot -V` to verify.",
            flush=True,
        )
    return False


if __name__ == "__main__":
    sys.exit(0 if ensure_dot() else 1)
