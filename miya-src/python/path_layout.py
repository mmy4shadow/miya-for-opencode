from __future__ import annotations

import os
from pathlib import Path


def _normalize_root(path_text: str) -> Path:
    raw = path_text.strip()
    if not raw:
        return default_model_root()
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate
    return (Path.cwd() / candidate).resolve()


def default_data_root() -> Path:
    cwd = Path.cwd()
    if cwd.name.lower() == ".opencode":
        return cwd / "miya"
    return cwd / ".opencode" / "miya"


def default_model_root() -> Path:
    override = os.getenv("MIYA_MODEL_ROOT_DIR", "").strip()
    if override:
        return _normalize_root(override)
    return default_data_root() / "model"


def flux_schnell_dir() -> Path:
    return default_model_root() / "tu pian" / "FLUX.1 schnell"


def qwen3vl_dir() -> Path:
    return default_model_root() / "shi jue" / "Qwen3VL-4B-Instruct-Q4_K_M"


def flux_klein_dir() -> Path:
    return default_model_root() / "tu pian" / "FLUX.2 [klein] 4B（Apache-2.0）"


def sovits_dir() -> Path:
    return default_model_root() / "sheng yin" / "GPT-SoVITS-v2pro-20250604"
