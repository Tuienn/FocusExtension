#!/usr/bin/env python3
"""Build deterministic browser extension ZIPs using only the Python stdlib."""

from __future__ import annotations

import argparse
import json
import re
import stat
import zipfile
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent
ARCHIVES = ("chrome", "edge", "firefox")
# Explicit package allowlist: development docs, tests, and build tooling stay out.
RUNTIME_FILES = (
    "background.js",
    "content.js",
    "core.js",
    "dashboard.html",
    "dashboard.js",
    "gate.css",
    "manifest.json",
    "popup.html",
    "popup.js",
    "styles.css",
    "assets/LICENSE.txt",
    "assets/icon16.png",
    "assets/icon32.png",
    "assets/icon48.png",
    "assets/icon128.png",
    "assets/pixel.woff",
)
VERSION_RE = re.compile(r"\A\d+(?:\.\d+){0,3}\Z")
ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def select_package_files(root: Path = ROOT) -> tuple[str, ...]:
    """Return package paths in stable order and fail if any runtime file is absent."""
    missing = [name for name in RUNTIME_FILES if not (root / name).is_file()]
    if missing:
        raise ValueError("Required package files are missing: " + ", ".join(missing))
    return RUNTIME_FILES


def read_manifest(root: Path = ROOT) -> dict:
    try:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read manifest.json: {exc}") from exc
    version = manifest.get("version")
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        raise ValueError("manifest.json must contain a valid dotted version string")
    if manifest.get("manifest_version") != 3:
        raise ValueError("manifest.json must use manifest_version 3")
    return manifest


def package_manifest(manifest: dict, browser: str) -> dict:
    """Return the browser-specific manifest without mutating the source object."""
    result = json.loads(json.dumps(manifest))
    if browser == "firefox":
        result["background"] = {"scripts": ["background.js"], "type": "module"}
        result.pop("minimum_chrome_version", None)
        result["browser_specific_settings"] = {
            "gecko": {
                "id": "focus-guard@focusguard.local",
                "strict_min_version": "140.0",
                "data_collection_permissions": {"required": ["none"]},
            }
        }
    elif browser not in ("chrome", "edge"):
        raise ValueError(f"Unsupported browser: {browser}")
    return result


def build(root: Path = ROOT, output_dir: Path | None = None) -> list[Path]:
    files = select_package_files(root)
    manifest = read_manifest(root)
    destination = output_dir if output_dir is not None else root / "output"
    destination.mkdir(parents=True, exist_ok=True)
    results = []
    for browser in ARCHIVES:
        archive = destination / f"focus-guard-{browser}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
            for name in files:
                data = (root / name).read_bytes()
                if name == "manifest.json":
                    data = (json.dumps(package_manifest(manifest, browser), indent=2, ensure_ascii=False) + "\n").encode("utf-8")
                info = zipfile.ZipInfo(name, date_time=ZIP_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.flag_bits = 0
                zipped.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        results.append(archive)
    return results


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, help="destination for the three archives (default: <repo>/output)")
    args = parser.parse_args(argv)
    try:
        for path in build(output_dir=args.output_dir):
            print(path)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
