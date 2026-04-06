#!/usr/bin/env python3
"""
Resize a master PNG/SVG (via Pillow; SVG needs cairo or convert to PNG first)
into DonkeyCode manifest sizes: 16, 32, 48, 128.

Usage:
  pip install pillow
  python3 DonkeyCode/scripts/build-icons.py [path/to/master.png]

Default master path: DonkeyCode/icons/source.png
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Install Pillow: pip install pillow", file=sys.stderr)
    sys.exit(1)

SIZES = (16, 32, 48, 128)


def default_master_path() -> str:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, "icons", "source.png")


def build_icons(src: str, out_dir: str) -> None:
    img = Image.open(src)
    if img.mode not in ("RGBA", "RGB"):
        img = img.convert("RGBA")
    elif img.mode == "RGB":
        img = img.convert("RGBA")

    os.makedirs(out_dir, exist_ok=True)
    for size in SIZES:
        fitted = ImageOps.fit(
            img,
            (size, size),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
        out_path = os.path.join(out_dir, f"icon{size}.png")
        fitted.save(out_path, "PNG")
        print("Wrote", out_path)


def main() -> int:
    p = argparse.ArgumentParser(description="Build DonkeyCode extension icons from one image.")
    p.add_argument(
        "master",
        nargs="?",
        default=default_master_path(),
        help="Master image (PNG recommended; square or any aspect ratio)",
    )
    args = p.parse_args()

    if not os.path.isfile(args.master):
        print(
            "Master image not found:\n  "
            + os.path.abspath(args.master)
            + "\n\nSave your artwork as that path, or pass the file path as the first argument.",
            file=sys.stderr,
        )
        return 1

    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    build_icons(args.master, out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
