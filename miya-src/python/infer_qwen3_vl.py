#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

from path_layout import qwen3vl_dir


_PIPELINE_CACHE: dict[str, Any] = {}


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _read_stdin_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _load_image_bytes(payload: dict[str, Any]) -> bytes:
    image_base64 = str(payload.get("imageBase64") or "").strip()
    if image_base64:
        try:
            return base64.b64decode(image_base64, validate=False)
        except Exception as exc:
            raise RuntimeError(f"invalid_image_base64:{exc}") from exc
    image_path = str(payload.get("imagePath") or "").strip()
    if image_path:
        path = Path(image_path)
        if not path.exists():
            raise RuntimeError(f"image_path_not_found:{path}")
        return path.read_bytes()
    raise RuntimeError("image_input_required")


def _run_backend_command(
    command_text: str,
    payload: dict[str, Any],
    timeout_ms: int,
) -> dict[str, Any]:
    proc = subprocess.run(
        command_text,
        shell=True,
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=max(1, timeout_ms) / 1000.0,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"backend_nonzero_exit:{proc.returncode}:{proc.stderr.strip()}")
    try:
        parsed = json.loads(proc.stdout.strip() or "{}")
        if isinstance(parsed, dict):
            return parsed
    except Exception as exc:
        raise RuntimeError(f"backend_invalid_json:{exc}") from exc
    raise RuntimeError("backend_invalid_response")


def _get_pipeline(model_dir: str):
    cache_key = model_dir
    cached = _PIPELINE_CACHE.get(cache_key)
    if cached is not None:
        return cached

    from transformers import pipeline  # type: ignore

    pipe = pipeline(
        task="image-to-text",
        model=model_dir,
        trust_remote_code=True,
        device_map="auto",
    )
    _PIPELINE_CACHE[cache_key] = pipe
    return pipe


def _run_transformers_inference(model_dir: str, image_bytes: bytes, prompt: str, max_new_tokens: int) -> str:
    from PIL import Image  # type: ignore

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    pipe = _get_pipeline(model_dir)
    outputs = pipe(image, prompt=prompt or None, max_new_tokens=max(16, max_new_tokens))
    if isinstance(outputs, list) and outputs:
        first = outputs[0]
        if isinstance(first, dict):
            text = str(first.get("generated_text") or first.get("text") or "").strip()
            if text:
                return text
        return str(first).strip()
    return str(outputs).strip()


def _infer_screen_probe_tags(text: str) -> list[str]:
    lowered = text.lower()
    tags: list[str] = []
    if any(item in lowered for item in ("game", "gaming", "battle", "fps")):
        tags.append("playing_game")
    if any(item in lowered for item in ("video", "movie", "player", "stream")):
        tags.append("watching_video")
    if any(item in lowered for item in ("code", "terminal", "editor", "ide", "debug")):
        tags.append("coding")
    if any(item in lowered for item in ("chat", "message", "wechat", "qq")):
        tags.append("chatting")
    if not tags:
        tags.append("desktop_general")
    return tags[:8]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Miya Qwen3VL local inference wrapper")
    parser.add_argument(
        "--model-dir",
        default=_env("MIYA_QWEN3VL_MODEL_DIR", str(qwen3vl_dir())),
    )
    parser.add_argument("--mode", default=_env("MIYA_VISION_MODE", "vision_ocr"))
    parser.add_argument("--question", default=_env("MIYA_VISION_QUESTION", ""))
    parser.add_argument("--max-new-tokens", type=int, default=int(_env("MIYA_VISION_MAX_NEW_TOKENS", "192")))
    parser.add_argument("--timeout-ms", type=int, default=int(_env("MIYA_VISION_TIMEOUT_MS", "12000")))
    parser.add_argument("--backend-cmd", default=_env("MIYA_QWEN3VL_CMD", ""))
    return parser


def main() -> int:
    args = build_parser().parse_args()
    payload = _read_stdin_payload()
    mode = str(payload.get("mode") or args.mode or "vision_ocr").strip().lower()
    question = str(payload.get("question") or args.question or "").strip()

    try:
        image_bytes = _load_image_bytes(payload)
        if args.backend_cmd:
            backend_payload = {
                **payload,
                "mode": mode,
                "question": question,
                "modelDir": str(args.model_dir),
            }
            result = _run_backend_command(args.backend_cmd, backend_payload, args.timeout_ms)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return 0

        text = _run_transformers_inference(
            str(args.model_dir),
            image_bytes=image_bytes,
            prompt=question,
            max_new_tokens=args.max_new_tokens,
        ).strip()
        if mode == "screen_probe":
            print(
                json.dumps(
                    {
                        "sceneTags": _infer_screen_probe_tags(text),
                        "confidence": 0.62 if text else 0.35,
                        "captureLimitations": [],
                        "appHint": "",
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            return 0

        print(
            json.dumps(
                {
                    "text": text,
                    "summary": text[:400],
                    "boxes": [],
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
