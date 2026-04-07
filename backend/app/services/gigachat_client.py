"""OAuth + chat/completions for Sber GigaChat (OpenAI-compatible payload)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

_DEFAULT_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
_DEFAULT_API_BASE = "https://gigachat.devices.sberbank.ru/api/v1"


@dataclass
class _TokenState:
    access_token: str
    expires_at: datetime


_token_state: _TokenState | None = None


def _basic_credentials(settings: Settings) -> str | None:
    """Authorization Key из личного кабинета GigaChat (для заголовка `Authorization: Basic …` при OAuth)."""

    raw = (settings.gigachat_authorization_key or "").strip()
    return raw or None


def gigachat_configured(settings: Settings) -> bool:
    """True when env provides enough data to obtain a token."""

    return _basic_credentials(settings) is not None


def _fetch_token(settings: Settings) -> _TokenState:
    basic = _basic_credentials(settings)
    if not basic:
        raise RuntimeError("GigaChat credentials are not configured")

    oauth_url = (settings.gigachat_oauth_url or _DEFAULT_OAUTH_URL).rstrip("/")
    data = {"scope": settings.gigachat_scope}
    headers = {
        "Authorization": f"Basic {basic}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "RqUID": str(uuid.uuid4()),
    }
    verify = settings.gigachat_verify_ssl
    with httpx.Client(timeout=60.0, verify=verify) as client:
        r = client.post(oauth_url, data=data, headers=headers)
        r.raise_for_status()
        body = r.json()
    access = body.get("access_token")
    if not access:
        raise RuntimeError("GigaChat OAuth response missing access_token")
    expires_raw = body.get("expires_at")
    # expires_at is ms since epoch in GigaChat responses
    try:
        exp_ms = int(expires_raw)
        exp = datetime.fromtimestamp(exp_ms / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError):
        exp = datetime.now(timezone.utc) + timedelta(minutes=25)
    return _TokenState(access_token=str(access), expires_at=exp)


def get_access_token(settings: Settings) -> str:
    """Return a valid bearer token (cached until shortly before expiry)."""

    global _token_state
    now = datetime.now(timezone.utc)
    if _token_state and _token_state.expires_at > now + timedelta(seconds=90):
        return _token_state.access_token
    _token_state = _fetch_token(settings)
    return _token_state.access_token


def chat_completion(
    settings: Settings,
    *,
    messages: list[dict[str, str]],
    model: str | None = None,
    temperature: float = 0.3,
    response_format: dict[str, str] | None = None,
) -> str:
    """Call `POST .../chat/completions` and return assistant message content."""

    token = get_access_token(settings)
    base = (settings.gigachat_api_base or _DEFAULT_API_BASE).rstrip("/")
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model or settings.gigachat_model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    verify = settings.gigachat_verify_ssl
    with httpx.Client(timeout=120.0, verify=verify) as client:
        r = client.post(url, headers=headers, json=payload)
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError:
            logger.exception("GigaChat chat failed: %s", r.text[:500])
            raise
        body = r.json()
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("GigaChat response has no choices")
    msg = choices[0].get("message") or {}
    content = msg.get("content")
    if content is None:
        raise RuntimeError("GigaChat response missing message.content")
    return str(content)
