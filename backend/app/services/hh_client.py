"""HTTP client for hh.ru public API (pattern from root `main.py`)."""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

_DEFAULT_HH_UA = "hh-vacancy-searcher/1.0 (contact: you@example.com)"


def _extract_user_agent(raw: str) -> str:
    """Extract User-Agent from plain string or JSON-like env value."""

    value = raw.strip()
    if not value:
        return ""
    if value.startswith("{") and value.endswith("}"):
        try:
            data = json.loads(value)
            if isinstance(data, dict):
                ua = data.get("User-Agent") or data.get("user-agent") or data.get("user_agent")
                return str(ua).strip() if ua else ""
        except Exception:
            logger.exception("Failed to parse HH_USER_AGENT as JSON object")
            return ""
    return value


def _normalize_hh_ua(raw: str) -> str:
    """Normalize HH UA and avoid known blacklisted demo identifiers."""

    ua = _extract_user_agent(raw)
    if not ua:
        ua = _DEFAULT_HH_UA
    low = ua.lower()
    if "hh-vacancy-searcher/1.0" in low or "find-work-dashboard/1.0" in low:
        ua = "find-work-bot/1.0 (contact: you@example.com)"
    return ua


def _hh_headers() -> dict[str, str]:
    """Build headers for hh.ru API.

    HH may respond with 400 on missing/empty User-Agent, so we always provide a non-empty value.
    """

    ua = _normalize_hh_ua(get_settings().hh_user_agent or "")
    return {"User-Agent": ua, "Accept": "application/json"}


def _hh_api_token(value: str | None) -> str | None:
    """Pass only ASCII tokens (hh enum ids); skip Russian labels from UI."""

    if not value:
        return None
    v = value.strip().lower()
    if v in {"any", "__any__", "all", "*"}:
        return None
    if any(ord(c) > 127 for c in value):
        return None
    return value.strip()


def fetch_vacancies_page(
    *,
    text: str,
    area: int | None,
    schedule: str | None,
    employment: str | None,
    experience: str | None,
    salary_from: int | None,
    salary_to: int | None,  # reserved; hh list API uses a single salary floor in MVP
    page: int,
    per_page: int,
) -> dict[str, Any]:
    """Call `GET /vacancies` with the same parameter style as `main.py`."""

    s = get_settings()
    params: dict[str, Any] = {
        "text": text,
        "per_page": per_page,
        "page": page,
        "order_by": "publication_time",
    }
    if area is not None:
        params["area"] = area
    if schedule:
        params["schedule"] = schedule
    emp = _hh_api_token(employment)
    if emp:
        params["employment"] = emp
    exp = _hh_api_token(experience)
    if exp:
        params["experience"] = exp
    if salary_from is not None:
        params["salary"] = salary_from
        params["only_with_salary"] = True
    _ = salary_to

    headers = _hh_headers()
    url = f"{s.hh_base_url.rstrip('/')}/vacancies"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, headers=headers, params=params)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            # HH often returns a helpful JSON body for 400s; include it in logs for debugging.
            logger.error("HH /vacancies error %s for %s; body=%s", resp.status_code, resp.request.url, resp.text)
            raise
        return resp.json()


def fetch_vacancy_detail(external_id: str) -> dict[str, Any]:
    """Call `GET /vacancies/{id}` for full card."""

    s = get_settings()
    headers = _hh_headers()
    url = f"{s.hh_base_url.rstrip('/')}/vacancies/{external_id}"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(url, headers=headers)
        resp.raise_for_status()
        return resp.json()
