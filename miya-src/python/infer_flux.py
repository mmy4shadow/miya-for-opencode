#!/usr/bin/env python3
import argparse
import json
import os
import sys
import threading
from pathlib import Path
from typing import Optional
from path_layout import flux_schnell_dir


STOP_EVENT = threading.Event()


def _emit(payload: dict):
    try:
        print(json.dumps(payload), flush=True)
    except BrokenPipeError:
        STOP_EVENT.set()
        raise SystemExit(86)


def _stdin_parent_watchdog():
    if os.getenv("MIYA_PARENT_STDIN_MONITOR") != "1":
        return
    while not STOP_EVENT.is_set():
        chunk = sys.stdin.buffer.read(1)
        if chunk == b"":
            STOP_EVENT.set()
            return


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _parse_size(value: str) -> tuple[int, int]:
    parts = value.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise ValueError(f"invalid_size:{value}")
    return int(parts[0]), int(parts[1])


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya FLUX inference wrapper")
    p.add_argument("--prompt", default=_env("MIYA_FLUX_PROMPT"), required=False)
    p.add_argument("--negative-prompt", default=_env("MIYA_FLUX_NEGATIVE_PROMPT", ""))
    p.add_argument(
        "--model-dir",
        default=_env(
            "MIYA_FLUX_MODEL_DIR",
            str(flux_schnell_dir()),
        ),
    )
    p.add_argument("--lora-path", default=_env("MIYA_FLUX_LORA_PATH"))
    p.add_argument("--embeddings-path", default=_env("MIYA_FLUX_EMBED_PATH"))
    p.add_argument("--output-path", default=_env("MIYA_FLUX_OUTPUT_PATH"))
    p.add_argument("--size", default=_env("MIYA_FLUX_SIZE", "1024x1024"))
    p.add_argument("--steps", type=int, default=int(_env("MIYA_FLUX_STEPS", "20")))
    p.add_argument("--guidance-scale", type=float, default=float(_env("MIYA_FLUX_GUIDANCE_SCALE", "3.5")))
    p.add_argument("--seed", type=int, default=int(_env("MIYA_FLUX_SEED", "0")))
    p.add_argument("--tier", default=_env("MIYA_FLUX_TIER", "lora"))
    p.add_argument("--dry-run", action="store_true")
    return p


def _save_blank_png(path: Path):
    png_1x1 = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0bIDATx\xdac\xfc\xff"
        b"\x1f\x00\x03\x03\x02\x00\xef\xac\x8c\xf4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_1x1)


def _run_with_diffusers(args: argparse.Namespace, width: int, height: int, output: Path) -> bool:
    try:
        import torch  # type: ignore
        from diffusers import DiffusionPipeline  # type: ignore
    except Exception as exc:
        print(json.dumps({"event": "warn", "message": f"diffusers_unavailable:{exc}"}), flush=True)
        return False

    pipe = DiffusionPipeline.from_pretrained(
        args.model_dir,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")

    # 动态LoRA装载（存在时启用，不存在则继续基模推理）。
    if args.lora_path and Path(args.lora_path).exists():
        try:
            pipe.load_lora_weights(str(Path(args.lora_path).parent), weight_name=Path(args.lora_path).name)
            print(json.dumps({"event": "lora_loaded", "path": args.lora_path}), flush=True)
        except Exception as exc:
            print(json.dumps({"event": "warn", "message": f"lora_load_failed:{exc}"}), flush=True)

    generator = None
    if args.seed != 0:
        generator = torch.Generator(device="cuda" if torch.cuda.is_available() else "cpu").manual_seed(args.seed)

    image = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt or None,
        num_inference_steps=max(1, args.steps),
        guidance_scale=max(0.0, args.guidance_scale),
        width=width,
        height=height,
        generator=generator,
    ).images[0]

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    return True


def main() -> int:
    args = build_parser().parse_args()
    threading.Thread(target=_stdin_parent_watchdog, daemon=True).start()
    if not args.prompt:
        _emit({"event": "error", "message": "prompt_required"})
        return 2
    if not args.output_path:
        _emit({"event": "error", "message": "output_path_required"})
        return 2

    try:
        width, height = _parse_size(args.size)
    except Exception as exc:
        _emit({"event": "error", "message": str(exc)})
        return 2

    output = Path(args.output_path)
    _emit(
        {
            "event": "start",
            "model_dir": args.model_dir,
            "tier": args.tier,
            "output_path": str(output),
            "size": args.size,
        }
    )

    if args.dry_run:
        _save_blank_png(output)
        _emit({"event": "done", "status": "dry_run", "output_path": str(output)})
        return 0

    try:
        ok = _run_with_diffusers(args, width, height, output)
        if not ok:
            _emit(
                {
                    "event": "error",
                    "message": "flux_backend_not_available:install_diffusers_and_torch",
                }
            )
            return 1
        _emit({"event": "done", "status": "ok", "output_path": str(output)})
        return 0
    except Exception as exc:
        _emit({"event": "error", "message": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
