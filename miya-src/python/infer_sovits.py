#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya SoVITS inference wrapper")
    p.add_argument("--text", default=_env("MIYA_SOVITS_TEXT", ""))
    p.add_argument("--voice", default=_env("MIYA_SOVITS_VOICE", "default"))
    p.add_argument("--output-path", default=_env("MIYA_SOVITS_OUTPUT_PATH"))
    p.add_argument("--format", default=_env("MIYA_SOVITS_FORMAT", "wav"), choices=["wav", "mp3", "ogg"])
    p.add_argument("--mode", default=_env("MIYA_SOVITS_MODE", "tts"), choices=["tts", "vc"])
    p.add_argument("--input-audio")
    p.add_argument("--dry-run", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()
    if not args.output_path:
        print("output_path_required", file=sys.stderr)
        return 2
    engine = Path(__file__).resolve().parent / "tts_engine.py"
    cmd = [
        sys.executable,
        str(engine),
        "--mode",
        args.mode,
        "--voice",
        args.voice,
        "--output-path",
        args.output_path,
        "--format",
        args.format,
    ]
    if args.text:
        cmd.extend(["--text", args.text])
    if args.input_audio:
        cmd.extend(["--input-audio", args.input_audio])
    if args.dry_run:
        cmd.append("--dry-run")
    proc = subprocess.run(cmd, check=False)
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
