#!/usr/bin/env python3
import argparse
import csv
import json
import os
import signal
import sys
import threading
import time
import wave
from pathlib import Path
from typing import Optional
from path_layout import sovits_dir


STOP_EVENT = threading.Event()


def _emit(payload: dict):
    try:
        print(json.dumps(payload), flush=True)
    except BrokenPipeError:
        STOP_EVENT.set()
        raise SystemExit(86)


def _on_signal(signum, _frame):
    STOP_EVENT.set()
    _emit({"event": "signal", "signal": int(signum), "message": "interrupt_requested"})


signal.signal(signal.SIGINT, _on_signal)
signal.signal(signal.SIGTERM, _on_signal)


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


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def _env_float(name: str, default: float) -> float:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except Exception:
        return default


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
            _emit(
                {
                    "event": "gpu",
                    "total_mb": round(total_mb, 2),
                    "used_mb": round(total_mb - free_mb, 2),
                    "free_mb": round(free_mb, 2),
                }
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
            str(sovits_dir()),
        ),
    )
    p.add_argument("--output-path", default=_env("MIYA_TRAIN_ARTIFACT_PATH"))
    p.add_argument("--checkpoint-path", default=_env("MIYA_TRAIN_CHECKPOINT_PATH"))
    p.add_argument("--job-id", default=_env("MIYA_TRAIN_JOB_ID", "manual_sovits_train"))
    p.add_argument("--tier", default=_env("MIYA_TRAIN_TIER", "lora"), choices=["lora", "embedding", "reference"])
    p.add_argument("--steps", type=int, default=_env_int("MIYA_TRAIN_STEPS", 120))
    p.add_argument(
        "--resume-step", type=int, default=_env_int("MIYA_TRAIN_RESUME_STEP", 0)
    )
    p.add_argument("--batch-size", type=int, default=_env_int("MIYA_BATCH_SIZE", 2))
    p.add_argument("--sample-rate", type=int, default=_env_int("MIYA_SAMPLE_RATE", 32000))
    p.add_argument("--learning-rate", type=float, default=_env_float("MIYA_LR", 5e-5))
    p.add_argument(
        "--checkpoint-interval",
        type=int,
        default=_env_int("MIYA_CHECKPOINT_INTERVAL", 100),
    )
    p.add_argument(
        "--gpu-log-interval", type=float, default=_env_float("MIYA_GPU_LOG_INTERVAL", 5.0)
    )
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


def _load_audio_tensor(audio_path: str, target_sr: int):
    try:
        import torch  # type: ignore
    except Exception as exc:
        raise RuntimeError(f"torch_required:{exc}") from exc

    path = Path(audio_path)
    if not path.exists():
        raise RuntimeError(f"audio_not_found:{path}")

    try:
        import torchaudio  # type: ignore

        waveform, sample_rate = torchaudio.load(str(path))
        if waveform.ndim == 2 and waveform.shape[0] > 1:
            waveform = waveform.mean(dim=0, keepdim=True)
        if sample_rate != target_sr:
            waveform = torchaudio.functional.resample(waveform, sample_rate, target_sr)
        return waveform.squeeze(0).float()
    except Exception:
        if path.suffix.lower() != ".wav":
            raise RuntimeError(f"torchaudio_missing_for_non_wav:{path.suffix.lower()}")
        with wave.open(str(path), "rb") as wf:
            channels = wf.getnchannels()
            sample_rate = wf.getframerate()
            sample_width = wf.getsampwidth()
            frames = wf.readframes(wf.getnframes())
        if sample_width != 2:
            raise RuntimeError(f"unsupported_sample_width:{sample_width}")
        pcm = torch.frombuffer(frames, dtype=torch.int16).clone().float() / 32768.0
        if channels > 1:
            pcm = pcm.reshape(-1, channels).mean(dim=1)
        if sample_rate != target_sr:
            ratio = float(target_sr) / float(sample_rate)
            idx = torch.arange(int(pcm.shape[0] * ratio), dtype=torch.float32)
            idx = torch.clamp((idx / ratio).round().long(), 0, pcm.shape[0] - 1)
            pcm = pcm[idx]
        return pcm


def _train_speaker_embed(
    args: argparse.Namespace,
    rows: list[tuple[str, str]],
    output_path: Path,
    checkpoint_path: Optional[Path],
) -> int:
    try:
        import torch  # type: ignore
    except Exception as exc:
        _emit({"event": "error", "message": f"torch_required:{exc}"})
        return 1

    features = []
    for audio_path, _ in rows:
        wav = _load_audio_tensor(audio_path, args.sample_rate)
        if wav.numel() < 64:
            continue
        spec = torch.stft(
            wav,
            n_fft=512,
            hop_length=128,
            win_length=512,
            return_complex=True,
        ).abs()
        feature = torch.log1p(spec).mean(dim=1)
        features.append(feature)
    if not features:
        _emit({"event": "error", "message": "no_valid_audio_features"})
        return 1

    target = torch.stack(features)
    feature_dim = int(target.shape[1])
    embed_dim = max(128, min(512, feature_dim))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    target = target.to(device)
    speaker_embed = torch.nn.Parameter(torch.randn(embed_dim, device=device) * 0.02)
    projection = torch.nn.Linear(embed_dim, feature_dim, bias=False, device=device)
    optimizer = torch.optim.Adam([speaker_embed, *projection.parameters()], lr=max(1e-6, args.learning_rate))

    start = max(0, min(args.steps, args.resume_step))
    for step in range(start + 1, args.steps + 1):
        if STOP_EVENT.is_set():
            if checkpoint_path:
                _write_checkpoint(checkpoint_path, args, step)
            _emit({"event": "canceled", "step": step})
            return 130
        idx = (step - 1) % int(target.shape[0])
        predicted = projection(speaker_embed)
        loss = torch.nn.functional.mse_loss(predicted, target[idx])
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        if step % 10 == 0 or step == args.steps:
            _emit(
                {
                    "event": "progress",
                    "step": step,
                    "total": args.steps,
                    "status": "Training voice...",
                    "loss": round(float(loss.detach().cpu().item()), 6),
                }
            )
        if checkpoint_path and (step % max(1, args.checkpoint_interval) == 0 or step == args.steps):
            _write_checkpoint(checkpoint_path, args, step)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "speaker_embed": speaker_embed.detach().cpu(),
            "projection": projection.state_dict(),
            "sample_rate": args.sample_rate,
            "samples": len(rows),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        output_path,
    )
    return 0


def main() -> int:
    args = build_parser().parse_args()
    threading.Thread(target=_stdin_parent_watchdog, daemon=True).start()
    if not args.output_path:
        _emit({"event": "error", "message": "output_path_required"})
        return 2

    rows = _materialize_rows(args)
    if not rows:
        _emit({"event": "error", "message": "no_training_samples"})
        return 2

    output_path = Path(args.output_path)
    checkpoint_path = Path(args.checkpoint_path) if args.checkpoint_path else None

    monitor = threading.Thread(target=_gpu_monitor, args=(max(1.0, args.gpu_log_interval),), daemon=True)
    monitor.start()

    _emit(
        {
            "event": "start",
            "job_id": args.job_id,
            "tier": args.tier,
            "samples": len(rows),
            "model_dir": args.model_dir,
            "steps": args.steps,
        }
    )

    if args.dry_run:
        _write_artifact(
            output_path,
            {"status": "dry_run", "jobID": args.job_id, "tier": args.tier, "samples": len(rows)},
        )
        _emit({"event": "done", "status": "dry_run"})
        STOP_EVENT.set()
        return 0

    train_exit = _train_speaker_embed(args, rows, output_path, checkpoint_path)
    if train_exit != 0:
        STOP_EVENT.set()
        return train_exit

    _emit({"event": "done", "status": "ok", "output_path": str(output_path)})
    STOP_EVENT.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
