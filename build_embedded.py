#!/usr/bin/env python3
"""
Build script for Session Replayer.
Inlines shared JS modules and embeds card images into a single deployable HTML file.
"""

import os
import sys
import base64
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_DIR = os.path.join(SCRIPT_DIR, "shared")
SOURCE_HTML = os.path.join(SCRIPT_DIR, "session_replayer_web.html")
OUTPUT_HTML = os.path.join(SCRIPT_DIR, "index.html")

# Shared JS files to inline (order matters — dependencies first)
SHARED_FILES = [
    "constants.js",
    "card_utils.js",
    "table_engine.js",
    "holdem_validator.js",
    "tabular_parser.js",
    "shorthand_learner.js",
    "session_storage.js",
    "llm_adapter.js",
    "parse_prompt.js",
    "hand_evaluator.js",
    "equity_engine.js",
    "equity_calculator.js",
    "pokerstars_exporter.js",
]

# Card image directories to search (relative to script dir, or absolute)
CARD_DIRS = [
    os.path.join(SCRIPT_DIR, "cards"),
    os.path.join(SCRIPT_DIR, "png-card-1.3"),
    os.path.join(SCRIPT_DIR, "PNG-cards-1.3"),
    # Also check RTP Drillz directory for card images
    os.path.expanduser("~/RTP Drillz Shareable/PNG-cards-1.3"),
    os.path.expanduser("~/RTP Drillz Shareable/png-card-1.3"),
    os.path.expanduser("~/RTP Drillz Shareable/cards"),
]


def find_card_images():
    """Find PNG card images and return dict of filename -> base64 data URI."""
    cards = {}
    for card_dir in CARD_DIRS:
        if not os.path.isdir(card_dir):
            continue
        for fname in os.listdir(card_dir):
            if not fname.lower().endswith(".png"):
                continue
            fpath = os.path.join(card_dir, fname)
            if not os.path.isfile(fpath):
                continue
            with open(fpath, "rb") as f:
                data = base64.b64encode(f.read()).decode("ascii")
            cards[fname] = f"data:image/png;base64,{data}"
    return cards


def read_shared_js():
    """Read and concatenate shared JS files."""
    parts = []
    for fname in SHARED_FILES:
        fpath = os.path.join(SHARED_DIR, fname)
        if not os.path.isfile(fpath):
            print(f"WARNING: shared file not found: {fpath}")
            continue
        with open(fpath, "r", encoding="utf-8") as f:
            parts.append(f"// ---- {fname} ----\n{f.read()}")
    return "\n\n".join(parts)


def build():
    """Build the embedded HTML file."""
    print(f"Building Session Replayer...")

    # Read source HTML
    with open(SOURCE_HTML, "r", encoding="utf-8") as f:
        html = f.read()

    # Find card images — prefer pre-extracted embedded_cards.js from RTP Drillz
    embedded_cards_file = os.path.join(SCRIPT_DIR, "embedded_cards.js")
    if os.path.isfile(embedded_cards_file):
        with open(embedded_cards_file, "r", encoding="utf-8") as f:
            card_script = f"<script>\n{f.read()}\n</script>"
        print(f"  Using pre-extracted card images from embedded_cards.js")
    else:
        cards = find_card_images()
        print(f"  Found {len(cards)} card images from PNG directories")
        card_entries = []
        for fname, data_uri in sorted(cards.items()):
            safe_key = fname.replace("\\", "\\\\").replace('"', '\\"')
            card_entries.append(f'  "{safe_key}": "{data_uri}"')
        card_script = (
            '<script>\nwindow.__RTP_EMBEDDED_CARDS__ = {\n'
            + ",\n".join(card_entries)
            + "\n};\n</script>"
        )

    # Read shared JS
    shared_js = read_shared_js()
    shared_script = f"<script>\n{shared_js}\n</script>"

    # Inline JSZip if present
    jszip_file = os.path.join(SCRIPT_DIR, "jszip.min.js")
    if os.path.isfile(jszip_file):
        with open(jszip_file, "r", encoding="utf-8") as f:
            jszip_js = f.read()
        html = html.replace(
            '<script src="jszip.min.js"></script>',
            f"<script>\n{jszip_js}\n</script>"
        )
        print(f"  Inlined JSZip ({len(jszip_js):,} bytes)")

    # Replace dev-mode script tags with inlined JS
    start_marker = "<!-- SHARED_ENGINE_START"
    end_marker = "<!-- SHARED_ENGINE_END -->"
    if start_marker in html and end_marker in html:
        start_idx = html.index(start_marker)
        end_idx = html.index(end_marker) + len(end_marker)
        html = html[:start_idx] + f"{card_script}\n{shared_script}" + html[end_idx:]
    else:
        # Legacy fallback
        marker = "<!-- SHARED_ENGINE -->"
        if marker in html:
            html = html.replace(marker, f"{card_script}\n{shared_script}")
        else:
            last_script_idx = html.rfind("<script>")
            if last_script_idx >= 0:
                html = html[:last_script_idx] + f"{card_script}\n{shared_script}\n" + html[last_script_idx:]

    # Write output
    with open(OUTPUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"  Output: {OUTPUT_HTML}")
    print(f"  Size: {os.path.getsize(OUTPUT_HTML):,} bytes")
    print("Done!")


if __name__ == "__main__":
    build()
