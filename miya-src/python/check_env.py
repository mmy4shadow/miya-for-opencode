#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any
from path_layout import flux_klein_dir, flux_schnell_dir, qwen3vl_dir, sovits_dir


def _to_mb(v: int) -> float:
    return round(v / 1024 / 1024, 2)


def _probe_torch() -> dict[str, Any]:
    out: dict[str, Any] = {"installed": False}
    try:
        import torch  # type: ignore

        out["installed"] = True
        out["version"] = getattr(torch, "__version__", "unknown")
        out["cuda_available"] = bool(torch.cuda.is_available())
        if out["cuda_available"]:
            idx = torch.cuda.current_device()
            free_b, total_b = torch.cuda.mem_get_info()
            out["device_index"] = idx
            out["device_name"] = torch.cuda.get_device_name(idx)
            out["vram_total_mb"] = _to_mb(total_b)
            out["vram_free_mb"] = _to_mb(free_b)
            out["vram_used_mb"] = round(out["vram_total_mb"] - out["vram_free_mb"], 2)
    except Exception as exc:
        out["error"] = str(exc)
    return out


def _probe_paths() -> dict[str, Any]:
    flux_path = Path(os.getenv("MIYA_FLUX_MODEL_DIR", str(flux_schnell_dir())))
    flux2_path = Path(
        os.getenv(
            "MIYA_FLUX2_MODEL_DIR",
            str(flux_klein_dir()),
        )
    )
    sovits_path = Path(
        os.getenv(
            "MIYA_SOVITS_MODEL_DIR",
            str(sovits_dir()),
        )
    )
    vision_path = Path(
        os.getenv(
            "MIYA_QWEN3VL_MODEL_DIR",
            str(qwen3vl_dir()),
        )
    )
    return {
        "flux1_exists": flux_path.exists(),
        "flux1_path": str(flux_path),
        "flux2_exists": flux2_path.exists(),
        "flux2_path": str(flux2_path),
        "sovits_exists": sovits_path.exists(),
        "sovits_path": str(sovits_path),
        "qwen3vl_exists": vision_path.exists(),
        "qwen3vl_path": str(vision_path),
    }


def _probe_bins() -> dict[str, Any]:
    return {
        "python": shutil.which("python"),
        "ffmpeg": shutil.which("ffmpeg"),
        "git": shutil.which("git"),
        "nvidia_smi": shutil.which("nvidia-smi"),
    }


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Miya runtime environment check")
    p.add_argument("--min-vram-mb", type=int, default=int(os.getenv("MIYA_MIN_VRAM_MB", "4096")))
    p.add_argument("--strict", action="store_true", help="exit non-zero if critical checks fail")
    return p


def main() -> int:
    args = build_parser().parse_args()
    torch_info = _probe_torch()
    paths_info = _probe_paths()
    bins_info = _probe_bins()

    issues: list[str] = []
    if not torch_info.get("installed"):
        issues.append("torch_not_installed")
    if not torch_info.get("cuda_available"):
        issues.append("cuda_not_available")
    else:
        free_mb = float(torch_info.get("vram_free_mb", 0))
        if free_mb < args.min_vram_mb:
            issues.append(f"insufficient_vram_free:{free_mb}<{args.min_vram_mb}")
    if not paths_info["flux1_exists"]:
        issues.append("flux1_model_missing")
    if not paths_info["sovits_exists"]:
        issues.append("sovits_model_missing")
    if not bins_info.get("ffmpeg"):
        issues.append("ffmpeg_missing")

    result = {
        "ok": len(issues) == 0,
        "issues": issues,
        "torch": torch_info,
        "paths": paths_info,
        "binaries": bins_info,
        "min_vram_mb": args.min_vram_mb,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.strict and issues:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
