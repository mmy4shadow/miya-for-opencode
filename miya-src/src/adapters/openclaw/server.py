import json
import os
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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


def _json_request(
    url: str,
    method: str = "GET",
    payload: Any = None,
    timeout: float = 6.0,
    headers: Dict[str, str] | None = None,
) -> Any:
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url=url, data=data, headers=req_headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace").strip()
        if not raw:
            return {}
        return json.loads(raw)


def _gateway_base_url() -> str:
    return os.environ.get("MIYA_OPENCLAW_GATEWAY_URL", "http://127.0.0.1:8040").rstrip("/")


def _gateway_headers() -> Dict[str, str]:
    token = os.environ.get("MIYA_OPENCLAW_GATEWAY_TOKEN", "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}", "X-Gateway-Token": token}


def _jsonrpc(method: str, params: Dict[str, Any]) -> Any:
    base = _gateway_base_url()
    req = {
        "jsonrpc": "2.0",
        "id": f"miya-{method}",
        "method": method,
        "params": params,
    }
    rpc_url_candidates = [f"{base}/rpc", f"{base}/wsrpc", f"{base}/api/rpc"]
    last_error: str | None = None
    for url in rpc_url_candidates:
        try:
            data = _json_request(
                url=url,
                method="POST",
                payload=req,
                timeout=6.0,
                headers=_gateway_headers(),
            )
            if isinstance(data, dict):
                if "error" in data:
                    err = data.get("error") or {}
                    code = err.get("code", "upstream_error")
                    message = err.get("message", "rpc_error")
                    raise RuntimeError(f"{code}:{message}")
                if "result" in data:
                    return data.get("result")
                if "ok" in data:
                    if data.get("ok"):
                        return data.get("result")
                    err = data.get("error") or {}
                    raise RuntimeError(
                        f"{err.get('code', 'upstream_error')}:{err.get('message', 'rpc_error')}"
                    )
            return data
        except Exception as exc:
            last_error = str(exc)
            continue
    raise RuntimeError(last_error or "jsonrpc_unreachable")


def _rest_get(paths: list[str], query: Dict[str, Any] | None = None) -> Any:
    base = _gateway_base_url()
    last_error: str | None = None
    query_text = ""
    if query:
        query_text = "?" + urllib.parse.urlencode(
            {k: v for k, v in query.items() if v is not None}
        )
    for p in paths:
        url = f"{base}{p}{query_text}"
        try:
            return _json_request(url=url, method="GET", headers=_gateway_headers())
        except Exception as exc:
            last_error = str(exc)
            continue
    raise RuntimeError(last_error or "rest_unreachable")


def _rest_post(paths: list[str], payload: Dict[str, Any]) -> Any:
    base = _gateway_base_url()
    last_error: str | None = None
    for p in paths:
        url = f"{base}{p}"
        try:
            return _json_request(
                url=url,
                method="POST",
                payload=payload,
                headers=_gateway_headers(),
            )
        except Exception as exc:
            last_error = str(exc)
            continue
    raise RuntimeError(last_error or "rest_unreachable")


def _handle_status(params: Dict[str, Any]) -> Dict[str, Any]:
    _ = params
    try:
        data = _jsonrpc("gateway.status.get", {})
        return {
            "provider": "openclaw",
            "source": "jsonrpc",
            "status": data,
        }
    except Exception:
        data = _rest_get(["/api/status", "/status", "/health"])
        return {
            "provider": "openclaw",
            "source": "rest",
            "status": data,
        }


def _handle_session_status(params: Dict[str, Any]) -> Dict[str, Any]:
    session_id = str(params.get("sessionID", "")).strip() or None
    rpc_params: Dict[str, Any] = {}
    if session_id:
        rpc_params["sessionID"] = session_id
    try:
        data = _jsonrpc("sessions.get" if session_id else "sessions.list", rpc_params)
        return {"provider": "openclaw", "source": "jsonrpc", "session": data}
    except Exception:
        data = _rest_get(
            ["/api/sessions", "/sessions"],
            {"sessionID": session_id} if session_id else None,
        )
        return {"provider": "openclaw", "source": "rest", "session": data}


def _handle_session_send(params: Dict[str, Any]) -> Dict[str, Any]:
    session_id = str(params.get("sessionID", "")).strip()
    text = str(params.get("text", "")).strip()
    if not session_id or not text:
        raise ValueError("invalid_sessions_send_args")
    payload = {
        "sessionID": session_id,
        "text": text,
        "source": str(params.get("source", "miya")).strip() or "miya",
    }
    try:
        data = _jsonrpc("sessions.send", payload)
        return {"provider": "openclaw", "source": "jsonrpc", "sent": data}
    except Exception:
        data = _rest_post(["/api/sessions/send", "/sessions/send"], payload)
        return {"provider": "openclaw", "source": "rest", "sent": data}


def _handle_pairing_query(params: Dict[str, Any]) -> Dict[str, Any]:
    pair_id = str(params.get("pairID", "")).strip() or None
    try:
        data = _jsonrpc("nodes.pair.list", {})
        if pair_id and isinstance(data, list):
            data = [item for item in data if isinstance(item, dict) and str(item.get("id", "")).strip() == pair_id]
        return {"provider": "openclaw", "source": "jsonrpc", "pairing": data}
    except Exception:
        data = _rest_get(
            ["/api/pairing", "/pairing", "/api/nodes/pairs"],
            {"pairID": pair_id} if pair_id else None,
        )
        return {"provider": "openclaw", "source": "rest", "pairing": data}


def _handle_skills_sync(params: Dict[str, Any]) -> Dict[str, Any]:
    action = str(params.get("action", "list")).strip().lower()
    source_pack_id = (
        str(params.get("sourcePackID", "")).strip()
        or str(params.get("source", "")).strip()
        or str(params.get("target", "")).strip()
        or None
    )
    revision = str(params.get("revision", "")).strip() or None
    session_id = str(params.get("sessionID", "")).strip() or None
    policy_hash = str(params.get("policyHash", "")).strip() or None
    if action == "list":
        data = _jsonrpc("miya.sync.list", {})
        return {"provider": "openclaw", "source": "jsonrpc", "sync": data}
    if action == "diff":
        if not source_pack_id:
            raise ValueError("sourcePackID_required_for_diff")
        payload = {"sourcePackID": source_pack_id}
        data = _jsonrpc("miya.sync.diff", payload)
        return {"provider": "openclaw", "source": "jsonrpc", "sync": data}
    if action == "apply":
        if not source_pack_id:
            raise ValueError("sourcePackID_required_for_apply")
        payload = {
            "sourcePackID": source_pack_id,
            "revision": revision,
            "sessionID": session_id,
            "policyHash": policy_hash,
            "dryRun": bool(params.get("dryRun", False)),
        }
        data = _jsonrpc("miya.sync.apply", payload)
        return {"provider": "openclaw", "source": "jsonrpc", "sync": data}
    if action == "verify":
        if not source_pack_id:
            raise ValueError("sourcePackID_required_for_verify")
        payload = {"sourcePackID": source_pack_id}
        data = _jsonrpc("miya.sync.verify", payload)
        return {"provider": "openclaw", "source": "jsonrpc", "sync": data}
    raise ValueError(f"unsupported_sync_action:{action}")


def _handle_routing_map(params: Dict[str, Any]) -> Dict[str, Any]:
    limit = params.get("limit", 100)
    try:
        limit_num = max(1, min(1000, int(limit)))
    except Exception:
        limit_num = 100
    data = _jsonrpc("routing.stats.get", {"limit": limit_num})
    mode = data.get("mode") if isinstance(data, dict) else None
    recent = data.get("recent", []) if isinstance(data, dict) else []
    return {
        "provider": "openclaw",
        "source": "jsonrpc",
        "routing": {
            "mode": mode,
            "recent": recent,
            "cost": data.get("cost") if isinstance(data, dict) else None,
        },
    }


def _handle_audit_replay(params: Dict[str, Any]) -> Dict[str, Any]:
    limit = params.get("limit", 50)
    try:
        limit_num = max(1, min(500, int(limit)))
    except Exception:
        limit_num = 50
    data = _jsonrpc("audit.ledger.list", {"limit": limit_num})
    replay_token = str(params.get("replayToken", "")).strip()
    if replay_token and isinstance(data, dict) and isinstance(data.get("items"), list):
        items = [item for item in data.get("items", []) if isinstance(item, dict) and item.get("replayToken") == replay_token]
        return {
            "provider": "openclaw",
            "source": "jsonrpc",
            "audit": {"items": items, "matched": len(items), "replayToken": replay_token},
        }
    return {"provider": "openclaw", "source": "jsonrpc", "audit": data}


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
                "at": datetime.now(timezone.utc).isoformat(),
            },
        )

    if method in ("status.get", "gateway.status.get"):
        try:
            return _ok(rpc_id, _handle_status(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("session.status", "sessions.status", "sessions.get", "sessions.list"):
        try:
            return _ok(rpc_id, _handle_session_status(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("session.send", "sessions.send"):
        try:
            return _ok(rpc_id, _handle_session_send(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("pairing.query", "pairing.list", "nodes.pair.list", "nodes.pair.status"):
        try:
            return _ok(rpc_id, _handle_pairing_query(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("skills.sync", "miya.sync", "sync.skills"):
        try:
            return _ok(rpc_id, _handle_skills_sync(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("routing.map", "routing.stats"):
        try:
            return _ok(rpc_id, _handle_routing_map(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

    if method in ("audit.replay", "audit.ledger", "audit.list"):
        try:
            return _ok(rpc_id, _handle_audit_replay(params))
        except Exception as exc:
            return _error(rpc_id, "openclaw_gateway_unavailable", str(exc))

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
