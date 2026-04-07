"""Telegram Bot API notifications."""

from __future__ import annotations

import logging
from typing import TypedDict

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


class TelegramSendResult(TypedDict):
    """Telegram send outcome for diagnostics."""

    ok: bool
    skipped: bool
    message_id: str | None
    reason: str | None


def send_message(text: str) -> TelegramSendResult:
    """Send plain text and return detailed status."""

    s = get_settings()
    token = (s.telegram_bot_token or "").strip()
    chat_id = (s.telegram_chat_id or "").strip()
    if not token or not chat_id:
        logger.info("Telegram skipped: token or chat_id not configured")
        return {"ok": False, "skipped": True, "message_id": None, "reason": "missing_token_or_chat_id"}

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": text[:4000]}
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(url, json=payload)
            if not r.is_success:
                logger.error("Telegram send failed: status=%s body=%s", r.status_code, r.text)
            r.raise_for_status()
            body = r.json()
        mid = body.get("result", {}).get("message_id")
        return {"ok": True, "skipped": False, "message_id": str(mid) if mid is not None else None, "reason": None}
    except Exception:
        logger.exception("Telegram send failed (chat_id=%s)", chat_id)
        return {"ok": False, "skipped": False, "message_id": None, "reason": "request_failed"}
