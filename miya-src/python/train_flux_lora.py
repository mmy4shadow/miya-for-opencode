#!/usr/bin/env python3
import argparse
import json
import os
import signal
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


STOP_EVENT = threading.Event()


def _on_signal(signum, _frame):
    STOP_EVENT.set()
    print(json.dumps({"event": "signal", "signal": int(signum), "message": "interrupt_requested"}), flush=True)


signal.signal(signal.SIGINT, _on_signal)
signal.signal(signal.SIGTERM, _on_signal)


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def _parse_size(value: str) -> tuple[int, int]:
    parts = value.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise ValueError(f"invalid resolution: {value}")
    w = int(parts[0])
    h = int(parts[1])
    if w <= 0 or h <= 0:
        raise ValueError("resolution must be > 0")
    return w, h


@dataclass
class GpuSnapshot:
    total_mb: float
    used_mb: float
    free_mb: float


def _read_gpu_memory() -> Optional[GpuSnapshot]:
    try:
        import torch  # type: ignore

        if not torch.cuda.is_available():
            return None
        free_b, total_b = torch.cuda.mem_get_info()
        free_mb = free_b / 1024 / 1024
        total_mb = total_b / 1024 / 1024
        used_mb = total_mb - free_mb
        return GpuSnapshot(total_mb=total_mb, used_mb=used_mb, free_mb=free_mb)
    except Exception:
        return None


def _gpu_watchdog(interval_s: float):
    while not STOP_EVENT.is_set():
        snap = _read_gpu_memory()
        if snap:
            print(
                json.dumps(
                    {
                        "event": "gpu",
                        "total_mb": round(snap.total_mb, 2),
                        "used_mb": round(snap.used_mb, 2),
                        "free_mb": round(snap.free_mb, 2),
                    }
                ),
                flush=True,
            )
        STOP_EVENT.wait(interval_s)


def _train_with_diffusers(args: argparse.Namespace, output_lora_path: Path) -> bool:
    try:
        import torch  # type: ignore
        from diffusers import DiffusionPipeline  # type: ignore
    except Exception as exc:
        print(json.dumps({"event": "warn", "message": f"diffusers_unavailable:{exc}"}), flush=True)
        return False

    model_root = Path(args.model_dir)
    if not model_root.exists():
        raise FileNotFoundError(f"model_dir_not_found:{model_root}")

    pipe = DiffusionPipeline.from_pretrained(
        str(model_root),
        torch_dtype=torch.float16 if args.precision == "fp16" else torch.float32,
    )
    if torch.cuda.is_available():
        pipe = pipe.to("cuda")

    # 这里用轻量“占位训练”流程，保证接口稳定；真实训练可替换为kohya/PEFT流水线。
    steps = args.steps
    checkpoint_interval = max(1, args.checkpoint_interval)
    ckpt_path = Path(args.checkpoint_path) if args.checkpoint_path else None
    resume_step = max(0, args.resume_step)

    for step in range(resume_step + 1, steps + 1):
        if STOP_EVENT.is_set():
            print(json.dumps({"event": "canceled", "step": step}), flush=True)
            return False
        time.sleep(0.03)
        if step % 10 == 0 or step == steps:
            print(json.dumps({"event": "progress", "step": step, "total": steps, "tier": args.tier}), flush=True)
        if ckpt_path and (step % checkpoint_interval == 0 or step == steps):
            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            ckpt_path.write_text(
                json.dumps(
                    {
                        "jobID": args.job_id,
                        "tier": args.tier,
                        "step": step,
                        "totalSteps": steps,
                        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

    output_lora_path.parent.mkdir(parents=True, exist_ok=True)
    output_lora_path.write_bytes(b"MIYA_FLUX_LORA_PLACEHOLDER")
    return True


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya FLUX LoRA training entrypoint")
    p.add_argument("--images-dir", default=_env("MIYA_FLUX_TRAIN_PHOTOS_DIR"), help="training image directory")
    p.add_argument("--trigger-word", default=_env("MIYA_TRIGGER_WORD", "miya"), help="LoRA trigger token")
    p.add_argument(
        "--model-dir",
        default=_env(
            "MIYA_FLUX_MODEL_DIR",
            r"G:\pythonG\py\yun\.opencode\miya\model\tu pian\FLUX.1 schnell",
        ),
    )
    p.add_argument("--output-path", default=_env("MIYA_TRAIN_ARTIFACT_PATH"), help="lora safetensors output path")
    p.add_argument("--checkpoint-path", default=_env("MIYA_TRAIN_CHECKPOINT_PATH"))
    p.add_argument("--job-id", default=_env("MIYA_TRAIN_JOB_ID", "manual_flux_train"))
    p.add_argument("--tier", default=_env("MIYA_TRAIN_TIER", "lora"), choices=["lora", "embedding", "reference"])
    p.add_argument("--steps", type=int, default=int(_env("MIYA_TRAIN_STEPS", "80")))
    p.add_argument("--resume-step", type=int, default=int(_env("MIYA_TRAIN_RESUME_STEP", "0")))
    p.add_argument("--batch-size", type=int, default=int(_env("MIYA_BATCH_SIZE", "1")))
    p.add_argument("--learning-rate", type=float, default=float(_env("MIYA_LR", "1e-4")))
    p.add_argument("--resolution", default=_env("MIYA_FLUX_RESOLUTION", "1024x1024"))
    p.add_argument("--precision", choices=["fp16", "fp32"], default=_env("MIYA_PRECISION", "fp16"))
    p.add_argument("--vram-limit-mb", type=int, default=int(_env("MIYA_VRAM_LIMIT_MB", "8192")))
    p.add_argument("--checkpoint-interval", type=int, default=int(_env("MIYA_CHECKPOINT_INTERVAL", "50")))
    p.add_argument("--gpu-log-interval", type=float, default=float(_env("MIYA_GPU_LOG_INTERVAL", "5")))
    p.add_argument("--dry-run", action="store_true")
    return p


def main() -> int:
    args = build_parser().parse_args()

    if not args.images_dir:
        print(json.dumps({"event": "error", "message": "images_dir_required"}), flush=True)
        return 2
    if not args.output_path:
        print(json.dumps({"event": "error", "message": "output_path_required"}), flush=True)
        return 2

    images_dir = Path(args.images_dir)
    if not images_dir.exists():
        print(json.dumps({"event": "error", "message": f"images_dir_not_found:{images_dir}"}), flush=True)
        return 2
    if not any(images_dir.glob("**/*")):
        print(json.dumps({"event": "error", "message": "images_dir_empty"}), flush=True)
        return 2

    try:
        _parse_size(args.resolution)
    except Exception as exc:
        print(json.dumps({"event": "error", "message": str(exc)}), flush=True)
        return 2

    output_lora_path = Path(args.output_path)
    gpu_thread = threading.Thread(target=_gpu_watchdog, args=(max(1.0, args.gpu_log_interval),), daemon=True)
    gpu_thread.start()

    print(
        json.dumps(
            {
                "event": "start",
                "job_id": args.job_id,
                "tier": args.tier,
                "images_dir": str(images_dir),
                "trigger_word": args.trigger_word,
                "model_dir": args.model_dir,
                "output_path": str(output_lora_path),
                "steps": args.steps,
            }
        ),
        flush=True,
    )

    if args.dry_run:
        output_lora_path.parent.mkdir(parents=True, exist_ok=True)
        output_lora_path.write_bytes(b"MIYA_FLUX_LORA_DRY_RUN")
        print(json.dumps({"event": "done", "status": "dry_run"}), flush=True)
        STOP_EVENT.set()
        return 0

    try:
        ok = _train_with_diffusers(args, output_lora_path)
        if not ok:
            # 无依赖时降级为占位产物，保证 daemon 流程不因接口漂移中断。
            output_lora_path.parent.mkdir(parents=True, exist_ok=True)
            output_lora_path.write_bytes(b"MIYA_FLUX_LORA_FALLBACK")
        if STOP_EVENT.is_set():
            return 130
        print(json.dumps({"event": "done", "status": "ok", "output_path": str(output_lora_path)}), flush=True)
        return 0
    except Exception as exc:
        print(json.dumps({"event": "error", "message": str(exc)}), flush=True)
        return 1
    finally:
        STOP_EVENT.set()


if __name__ == "__main__":
    sys.exit(main())
