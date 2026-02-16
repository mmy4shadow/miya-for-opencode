from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from path_layout import whisper_dir


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _emit_progress(step: int, total: int, message: str) -> None:
    payload = {
        "event": "progress",
        "step": int(step),
        "total": int(total),
        "message": str(message),
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _resolve_model_ref(args: argparse.Namespace) -> str:
    model_dir_raw = (args.model_dir or _env("MIYA_ASR_MODEL_DIR", "")).strip()
    if model_dir_raw:
        candidate = Path(model_dir_raw).expanduser().resolve()
        if candidate.exists():
            return str(candidate)

    default_dir = whisper_dir()
    if default_dir.exists():
        return str(default_dir)

    model_id = (args.model_id or _env("MIYA_ASR_MODEL_ID", "openai/whisper-small")).strip()
    if model_id:
        return model_id
    raise RuntimeError("asr_model_not_configured")


def _resolve_device(args: argparse.Namespace) -> tuple[str, int]:
    import torch

    requested = (args.device or _env("MIYA_ASR_DEVICE", "auto")).strip().lower()
    if requested in ("cuda", "gpu"):
        return ("cuda", 0 if torch.cuda.is_available() else -1)
    if requested == "cpu":
        return ("cpu", -1)
    if torch.cuda.is_available():
        return ("cuda", 0)
    return ("cpu", -1)


def _safe_text(value: Any) -> str:
    text = str(value or "").strip()
    return " ".join(text.split())


def _infer_language(raw: Any, fallback: str) -> str:
    value = _safe_text(raw).lower()
    if value:
        return value[:32]
    return fallback[:32]


def run(args: argparse.Namespace) -> dict[str, Any]:
    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists() or not input_path.is_file():
        raise RuntimeError(f"audio_input_missing:{input_path}")

    _emit_progress(1, 4, "loading_dependencies")
    import torch
    from transformers import pipeline

    model_ref = _resolve_model_ref(args)
    device_name, device_index = _resolve_device(args)
    torch_dtype = torch.float16 if device_name == "cuda" and device_index >= 0 else torch.float32

    _emit_progress(2, 4, "loading_model")
    asr = pipeline(
        task="automatic-speech-recognition",
        model=model_ref,
        device=device_index,
        torch_dtype=torch_dtype,
    )

    language_hint = _safe_text(args.language or _env("MIYA_ASR_LANGUAGE", ""))
    call_kwargs: dict[str, Any] = {}
    if language_hint:
        call_kwargs["generate_kwargs"] = {"language": language_hint}

    _emit_progress(3, 4, "transcribing_audio")
    result = asr(str(input_path), **call_kwargs)
    text = _safe_text(result.get("text") if isinstance(result, dict) else "")
    if not text:
        raise RuntimeError("asr_empty_transcript")

    language = _infer_language(
        result.get("language") if isinstance(result, dict) else None,
        language_hint or "unknown",
    )

    confidence = 0.76 if text else 0.0
    _emit_progress(4, 4, "completed")
    return {
        "ok": True,
        "text": text,
        "language": language,
        "confidence": float(confidence),
        "model": str(model_ref),
        "tier": "embedding",
        "degraded": device_name != "cuda",
        "message": "asr_ok",
        "meta": {
            "device": device_name,
            "device_index": int(device_index),
            "input_path": str(input_path),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Miya local ASR inference entrypoint")
    parser.add_argument("--input", default=_env("MIYA_ASR_INPUT_PATH", ""))
    parser.add_argument("--language", default=_env("MIYA_ASR_LANGUAGE", ""))
    parser.add_argument("--model-dir", default=_env("MIYA_ASR_MODEL_DIR", ""))
    parser.add_argument("--model-id", default=_env("MIYA_ASR_MODEL_ID", ""))
    parser.add_argument("--device", default=_env("MIYA_ASR_DEVICE", "auto"))
    args = parser.parse_args()

    if not args.input:
        print(json.dumps({"ok": False, "message": "audio_input_required"}, ensure_ascii=False))
        return 2

    try:
        payload = run(args)
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as error:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "message": f"asr_failed:{str(error)}",
                },
                ensure_ascii=False,
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
