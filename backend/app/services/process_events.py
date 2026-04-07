"""Lightweight process status/log timeline stored in app settings."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.settings_service import get_value, set_value

_ACTIVE_KEY = "process_active_state"
_LOGS_KEY = "process_events_timeline"
_MAX_EVENTS = 300


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_logs(db: Session) -> list[dict[str, Any]]:
    raw = get_value(db, _LOGS_KEY, [])
    return list(raw) if isinstance(raw, list) else []


def _write_logs(db: Session, events: list[dict[str, Any]]) -> None:
    set_value(db, _LOGS_KEY, events[-_MAX_EVENTS:])


def get_process_status(db: Session) -> dict[str, Any]:
    raw = get_value(db, _ACTIVE_KEY, None)
    if isinstance(raw, dict):
        return raw
    return {"active": False}


def get_process_logs(db: Session, *, limit: int = 100) -> list[dict[str, Any]]:
    logs = _read_logs(db)
    return list(reversed(logs[-limit:]))


def set_active(
    db: Session,
    *,
    process_type: str,
    run_id: str,
    phase: str,
    message: str,
    progress: int | None = None,
    counters: dict[str, int] | None = None,
) -> None:
    state: dict[str, Any] = {
        "active": True,
        "processType": process_type,
        "runId": run_id,
        "phase": phase,
        "message": message,
        "updatedAt": _now_iso(),
    }
    if progress is not None:
        state["progress"] = int(progress)
    if counters:
        state["counters"] = counters
    set_value(db, _ACTIVE_KEY, state)


def clear_active(db: Session) -> None:
    set_value(db, _ACTIVE_KEY, {"active": False, "updatedAt": _now_iso()})


def emit_event(
    db: Session,
    *,
    process_type: str,
    run_id: str,
    phase: str,
    status: str,
    message: str,
    progress: int | None = None,
    counters: dict[str, int] | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    event: dict[str, Any] = {
        "id": str(uuid4()),
        "ts": _now_iso(),
        "processType": process_type,
        "runId": run_id,
        "phase": phase,
        "status": status,
        "message": message,
    }
    if progress is not None:
        event["progress"] = int(progress)
    if counters:
        event["counters"] = counters
    if details:
        event["details"] = details
    logs = _read_logs(db)
    logs.append(event)
    _write_logs(db, logs)
