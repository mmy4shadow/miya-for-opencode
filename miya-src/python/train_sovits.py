#!/usr/bin/env python3
import argparse
import csv
import json
import os
import signal
import sys
import threading
import time
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


def _gpu_monitor(interval_s: float):
    try:
        import torch  # type: ignore
    except Exception:
        torch = None
    while not STOP_EVENT.is_set():
        if torch and torch.cuda.is_available():
            free_b, total_b = torch.cuda.mem_get_info()
            free_mb = free_b / 1024 / 1024
            total_mb = total_b / 1024 / 1024
            print(
                json.dumps(
                    {
                        "event": "gpu",
                        "total_mb": round(total_mb, 2),
                        "used_mb": round(total_mb - free_mb, 2),
                        "free_mb": round(free_mb, 2),
                    }
                ),
                flush=True,
            )
        STOP_EVENT.wait(interval_s)


def _read_manifest(manifest: Path) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    with manifest.open("r", encoding="utf-8") as f:
        sample = f.read(4096)
        f.seek(0)
        if "," in sample:
            reader = csv.DictReader(f)
            for row in reader:
                audio = (row.get("audio") or row.get("audio_path") or "").strip()
                text = (row.get("text") or row.get("transcript") or "").strip()
                if audio and text:
                    rows.append((audio, text))
        else:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                if "|" in line:
                    audio, text = line.split("|", 1)
                    audio = audio.strip()
                    text = text.strip()
                    if audio and text:
                        rows.append((audio, text))
    return rows


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya GPT-SoVITS training entrypoint")
    p.add_argument("--dataset-manifest", help="csv/txt manifest (audio,text)")
    p.add_argument("--audio-dir", help="fallback audio directory")
    p.add_argument("--text", help="single text for --audio-file training")
    p.add_argument("--audio-file", default=_env("MIYA_SOVITS_TRAIN_SAMPLE_PATH"))
    p.add_argument(
        "--model-dir",
        default=_env(
            "MIYA_SOVITS_MODEL_DIR",
            r"G:\pythonG\py\yun\.opencode\miya\model\sheng yin\GPT-SoVITS-v2pro-20250604",
        ),
    )
    p.add_argument("--output-path", default=_env("MIYA_TRAIN_ARTIFACT_PATH"))
    p.add_argument("--checkpoint-path", default=_env("MIYA_TRAIN_CHECKPOINT_PATH"))
    p.add_argument("--job-id", default=_env("MIYA_TRAIN_JOB_ID", "manual_sovits_train"))
    p.add_argument("--tier", default=_env("MIYA_TRAIN_TIER", "lora"), choices=["lora", "embedding", "reference"])
    p.add_argument("--steps", type=int, default=int(_env("MIYA_TRAIN_STEPS", "120")))
    p.add_argument("--resume-step", type=int, default=int(_env("MIYA_TRAIN_RESUME_STEP", "0")))
    p.add_argument("--batch-size", type=int, default=int(_env("MIYA_BATCH_SIZE", "2")))
    p.add_argument("--sample-rate", type=int, default=int(_env("MIYA_SAMPLE_RATE", "32000")))
    p.add_argument("--learning-rate", type=float, default=float(_env("MIYA_LR", "5e-5")))
    p.add_argument("--checkpoint-interval", type=int, default=int(_env("MIYA_CHECKPOINT_INTERVAL", "100")))
    p.add_argument("--gpu-log-interval", type=float, default=float(_env("MIYA_GPU_LOG_INTERVAL", "5")))
    p.add_argument("--dry-run", action="store_true")
    return p


def _materialize_rows(args: argparse.Namespace) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    if args.dataset_manifest:
        rows.extend(_read_manifest(Path(args.dataset_manifest)))
    elif args.audio_file and args.text:
        rows.append((args.audio_file, args.text))
    elif args.audio_file:
        rows.append((args.audio_file, "默认训练文本"))
    elif args.audio_dir:
        audio_dir = Path(args.audio_dir)
        for p in audio_dir.glob("**/*"):
            if p.suffix.lower() in {".wav", ".mp3", ".flac", ".m4a", ".ogg"}:
                rows.append((str(p), "默认训练文本"))
    return rows


def _write_checkpoint(checkpoint_path: Path, args: argparse.Namespace, step: int):
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_path.write_text(
        json.dumps(
            {
                "jobID": args.job_id,
                "tier": args.tier,
                "step": step,
                "totalSteps": args.steps,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _write_artifact(output_path: Path, payload: dict):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    args = build_parser().parse_args()
    if not args.output_path:
        print(json.dumps({"event": "error", "message": "output_path_required"}), flush=True)
        return 2

    rows = _materialize_rows(args)
    if not rows:
        print(json.dumps({"event": "error", "message": "no_training_samples"}), flush=True)
        return 2

    output_path = Path(args.output_path)
    checkpoint_path = Path(args.checkpoint_path) if args.checkpoint_path else None

    monitor = threading.Thread(target=_gpu_monitor, args=(max(1.0, args.gpu_log_interval),), daemon=True)
    monitor.start()

    print(
        json.dumps(
            {
                "event": "start",
                "job_id": args.job_id,
                "tier": args.tier,
                "samples": len(rows),
                "model_dir": args.model_dir,
                "steps": args.steps,
            }
        ),
        flush=True,
    )

    if args.dry_run:
        _write_artifact(
            output_path,
            {"status": "dry_run", "jobID": args.job_id, "tier": args.tier, "samples": len(rows)},
        )
        print(json.dumps({"event": "done", "status": "dry_run"}), flush=True)
        STOP_EVENT.set()
        return 0

    # 占位训练循环：保持参数协议、进度、恢复点与中断行为一致。
    start = max(0, min(args.steps, args.resume_step))
    for step in range(start + 1, args.steps + 1):
        if STOP_EVENT.is_set():
            if checkpoint_path:
                _write_checkpoint(checkpoint_path, args, step)
            print(json.dumps({"event": "canceled", "step": step}), flush=True)
            return 130
        if step % 10 == 0 or step == args.steps:
            print(json.dumps({"event": "progress", "step": step, "total": args.steps}), flush=True)
        if checkpoint_path and (step % max(1, args.checkpoint_interval) == 0 or step == args.steps):
            _write_checkpoint(checkpoint_path, args, step)
        time.sleep(0.03)

    _write_artifact(
        output_path,
        {
            "status": "ok",
            "model": "gpt-sovits-v2pro",
            "jobID": args.job_id,
            "tier": args.tier,
            "sampleRate": args.sample_rate,
            "samples": len(rows),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )
    print(json.dumps({"event": "done", "status": "ok", "output_path": str(output_path)}), flush=True)
    STOP_EVENT.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
