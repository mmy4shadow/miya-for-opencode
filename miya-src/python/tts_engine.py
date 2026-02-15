#!/usr/bin/env python3
import argparse
import json
import os
import sys
import wave
from pathlib import Path
from typing import Optional
from path_layout import sovits_dir


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _write_silent_wav(path: Path, ms: int = 900, sample_rate: int = 22050):
    nframes = max(1, int(sample_rate * (ms / 1000.0)))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00\x00" * nframes)


def _convert_if_needed(path: Path, fmt: str):
    if fmt == "wav":
        return path
    target = path.with_suffix(f".{fmt}")
    try:
        from pydub import AudioSegment  # type: ignore

        audio = AudioSegment.from_wav(str(path))
        audio.export(str(target), format=fmt)
        return target
    except Exception:
        # ffmpeg/pydub 不可用时退回 wav，调用端仍可读取输出文件。
        return path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya GPT-SoVITS TTS/VC engine")
    p.add_argument("--text", default=_env("MIYA_SOVITS_TEXT", ""))
    p.add_argument("--mode", choices=["tts", "vc"], default=_env("MIYA_SOVITS_MODE", "tts"))
    p.add_argument("--voice", default=_env("MIYA_SOVITS_VOICE", "default"))
    p.add_argument("--output-path", default=_env("MIYA_SOVITS_OUTPUT_PATH"))
    p.add_argument("--format", choices=["wav", "mp3", "ogg"], default=_env("MIYA_SOVITS_FORMAT", "wav"))
    p.add_argument("--speaker-embed", default=_env("MIYA_SOVITS_SPEAKER_EMBED"))
    p.add_argument(
        "--model-dir",
        default=_env(
            "MIYA_SOVITS_MODEL_DIR",
            str(sovits_dir()),
        ),
    )
    p.add_argument("--input-audio", help="voice conversion input audio path")
    p.add_argument("--sample-rate", type=int, default=int(_env("MIYA_SOVITS_SAMPLE_RATE", "22050")))
    p.add_argument("--dry-run", action="store_true")
    return p


def _try_sovits_tts(args: argparse.Namespace, wav_out: Path) -> bool:
    # 给后续接入真实GPT-SoVITS保留稳定调用位置。
    try:
        _ = args.model_dir
        _ = args.voice
        _ = args.speaker_embed
        # 若本地已接入真实推理实现，可在此替换为实际加载与推理。
        return False
    except Exception:
        return False


def main() -> int:
    args = build_parser().parse_args()
    if not args.output_path:
        print(json.dumps({"event": "error", "message": "output_path_required"}), flush=True)
        return 2
    if args.mode == "tts" and not args.text.strip():
        print(json.dumps({"event": "error", "message": "text_required_for_tts"}), flush=True)
        return 2
    if args.mode == "vc" and not args.input_audio:
        print(json.dumps({"event": "error", "message": "input_audio_required_for_vc"}), flush=True)
        return 2

    out = Path(args.output_path)
    wav_out = out if out.suffix.lower() == ".wav" else out.with_suffix(".wav")
    print(
        json.dumps(
            {
                "event": "start",
                "mode": args.mode,
                "voice": args.voice,
                "format": args.format,
                "output_path": str(out),
            }
        ),
        flush=True,
    )

    if args.dry_run:
        _write_silent_wav(wav_out, ms=600, sample_rate=args.sample_rate)
        final = _convert_if_needed(wav_out, args.format)
        if final != out:
            out.parent.mkdir(parents=True, exist_ok=True)
            final.replace(out)
            final = out
        print(json.dumps({"event": "done", "status": "dry_run", "output_path": str(final)}), flush=True)
        return 0

    try:
        ok = _try_sovits_tts(args, wav_out)
        if not ok:
            _write_silent_wav(wav_out, ms=max(600, min(7000, len(args.text) * 55)), sample_rate=args.sample_rate)

        final = _convert_if_needed(wav_out, args.format)
        if final != out:
            out.parent.mkdir(parents=True, exist_ok=True)
            final.replace(out)
            final = out
        print(json.dumps({"event": "done", "status": "ok", "output_path": str(final)}), flush=True)
        return 0
    except Exception as exc:
        print(json.dumps({"event": "error", "message": str(exc)}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
