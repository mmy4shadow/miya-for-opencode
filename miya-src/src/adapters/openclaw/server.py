import json
import os
import sys
import traceback
from typing import Any, Dict


def _error(rpc_id: str, code: str, message: str, details: Any = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "id": rpc_id,
        "ok": False,
        "error": {
            "code": code,
            "message": message,
        },
    }
    if details is not None:
        payload["error"]["details"] = details
    return payload


def _ok(rpc_id: str, result: Any) -> Dict[str, Any]:
    return {
        "id": rpc_id,
        "ok": True,
        "result": result,
    }


def _handle(req: Dict[str, Any]) -> Dict[str, Any]:
    rpc_id = str(req.get("id", "unknown"))
    method = str(req.get("method", "")).strip()
    params = req.get("params") if isinstance(req.get("params"), dict) else {}

    if not method:
        return _error(rpc_id, "invalid_method", "method_required")

    if method == "health.ping":
        return _ok(
            rpc_id,
            {
                "adapter": "openclaw",
                "status": "ok",
            },
        )

    if method == "skills.list":
        # Keep adapter process isolated and non-failing when OpenClaw is absent.
        # Dynamic import avoids hard dependency at plugin runtime boundary.
        try:
            import openclaw  # type: ignore

            skills = sorted(
                [
                    name
                    for name in dir(openclaw)
                    if not name.startswith("_")
                ]
            )
            return _ok(
                rpc_id,
                {
                    "provider": "openclaw",
                    "skills": skills[:200],
                },
            )
        except Exception as exc:
            return _error(
                rpc_id,
                "openclaw_unavailable",
                str(exc),
            )

    return _error(
        rpc_id,
        "method_not_implemented",
        f"unsupported_method:{method}",
        {"params": params},
    )


def main() -> int:
    raw = os.environ.get("MIYA_ADAPTER_RPC_REQ", "").strip()
    if not raw:
        print(
            json.dumps(
                _error("unknown", "missing_request", "MIYA_ADAPTER_RPC_REQ_missing")
            ),
            flush=True,
        )
        return 1
    try:
        req = json.loads(raw)
        if not isinstance(req, dict):
            raise ValueError("request_must_be_object")
    except Exception as exc:
        print(
            json.dumps(
                _error("unknown", "bad_request_json", str(exc))
            ),
            flush=True,
        )
        return 1

    try:
        response = _handle(req)
    except Exception as exc:
        response = _error(
            str(req.get("id", "unknown")),
            "unhandled_exception",
            str(exc),
            {"traceback": traceback.format_exc(limit=8)},
        )
    print(json.dumps(response, ensure_ascii=False), flush=True)
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())

