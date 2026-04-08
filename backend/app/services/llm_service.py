"""LLM adapters: OpenAI, GigaChat, stub — JSON repair, taxonomy, rate limit."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import httpx
import json_repair
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.keyword_taxonomy_v15 import normalize_match_categories
from app.prompts.cover import COVER_LETTER_SYSTEM, COVER_LETTER_USER_TEMPLATE
from app.prompts.vacancy_screening_qa import SCREENING_QA_SYSTEM, SCREENING_QA_USER_TEMPLATE
from app.prompts_v15_1 import MATCH_ANALYSIS_SYSTEM, MATCH_ANALYSIS_USER_TEMPLATE
from app.services import gigachat_client
from app.settings_service import ensure_defaults, get_int, get_str, get_value, set_value

logger = logging.getLogger(__name__)

PROMPT_VERSION_MATCH = "v15_4"
PROMPT_VERSION_COVER = "cover_v1"
PROMPT_VERSION_SCREENING_QA = "screening_qa_v1"


class MatchAnalysisLLMResult(BaseModel):
    """Structured match output from the LLM."""

    score: int = Field(ge=0, le=100)
    categories: list[str] = Field(default_factory=list)
    strengths_md: str = ""
    gaps_md: str = ""
    hr_advice_md: str = ""
    summary_for_notification: str = ""


def _md_field_to_string(value: Any) -> str:
    """Normalize markdown fields from LLM into a single string.

    Some models return arrays of bullet lines instead of a markdown string.
    """

    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        lines = [str(x).strip() for x in value if str(x).strip()]
        if not lines:
            return ""
        # Keep markdown bullet formatting for readability in UI.
        return "\n".join(f"- {line}" if not line.startswith(("-", "*", "P")) else line for line in lines)
    return str(value).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _resolve_openai_key(db: Session) -> str:
    """Prefer env `OPENAI_API_KEY`, else value from app settings (dashboard)."""

    ensure_defaults(db)
    s = get_settings()
    v = (s.openai_api_key or "").strip()
    if v:
        return v
    return get_str(db, "openai_api_key", "").strip()


def _gigachat_authorization_key_from_db(db: Session) -> str:
    """Dashboard stores Authorization Key; поддерживается старый ключ `gigachat_api_key`."""

    return (
        get_str(db, "gigachat_authorization_key", "").strip()
        or get_str(db, "gigachat_api_key", "").strip()
    )


def _settings_for_gigachat(db: Session) -> Settings:
    """Prefer env Authorization Key; fallback to dashboard-stored key."""

    s = get_settings()
    env_key = (s.gigachat_authorization_key or "").strip()
    if env_key:
        return s
    db_key = _gigachat_authorization_key_from_db(db)
    if db_key:
        return s.model_copy(update={"gigachat_authorization_key": db_key})
    return s


def gigachat_ready(db: Session) -> bool:
    """True if GigaChat OAuth can be attempted."""

    return gigachat_client.gigachat_configured(_settings_for_gigachat(db))


def get_effective_llm_provider(db: Session) -> Literal["openai", "gigachat", "none"]:
    """Resolve provider from DB (seeded from env) with validation."""

    ensure_defaults(db)
    s = get_settings()
    p = get_str(db, "llm_provider", s.llm_provider).lower().strip()
    if p in ("openai", "gigachat", "none"):
        return p  # type: ignore[return-value]
    return s.llm_provider  # type: ignore[return-value]


def get_llm_status(db: Session) -> dict[str, Any]:
    """Expose rate-limit window and credential flags for the UI."""

    ensure_defaults(db)
    s = get_settings()
    allowed, wait = try_acquire_llm_slot(db)
    prov = get_effective_llm_provider(db)
    return {
        "provider": prov,
        "llmCallAllowed": allowed,
        "retryAfterSeconds": 0 if allowed else wait,
        "openaiConfigured": bool(_resolve_openai_key(db)),
        "gigachatConfigured": gigachat_ready(db),
        "llmMinIntervalSeconds": get_int(db, "llm_min_interval_seconds", s.default_llm_min_interval_seconds),
    }


def assert_llm_slot(db: Session) -> None:
    """Raise PermissionError RATE_LIMIT:N if calls are too frequent."""

    allowed, wait = try_acquire_llm_slot(db)
    if not allowed:
        raise PermissionError(f"RATE_LIMIT:{wait}")


def try_acquire_llm_slot(db: Session) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds)."""

    ensure_defaults(db)
    min_sec = get_int(db, "llm_min_interval_seconds", get_settings().default_llm_min_interval_seconds)
    raw = get_value(db, "last_llm_call_at", None)
    if not raw:
        return True, 0
    try:
        last = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return True, 0
    delta = (datetime.now(timezone.utc) - last).total_seconds()
    if delta < min_sec:
        return False, int(min_sec - delta) + 1
    return True, 0


def record_llm_call(db: Session) -> None:
    """Persist last LLM call timestamp."""

    set_value(db, "last_llm_call_at", _now_iso())


def _parse_match_json(text: str) -> MatchAnalysisLLMResult:
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            if attempt == 0:
                data = json.loads(text.strip())
            elif attempt == 1:
                data = json_repair.repair_json(text, return_objects=True)
            else:
                repaired = json_repair.repair_json(text, return_objects=False)
                data = json.loads(str(repaired))
            if isinstance(data, dict):
                for md_key in ("strengths_md", "gaps_md", "hr_advice_md"):
                    if md_key in data:
                        data[md_key] = _md_field_to_string(data.get(md_key))
            parsed = MatchAnalysisLLMResult.model_validate(data)
            cats = normalize_match_categories(list(parsed.categories))
            return parsed.model_copy(update={"categories": cats})
        except (json.JSONDecodeError, TypeError, ValidationError) as e:
            last_err = e
            logger.warning("Match JSON parse attempt %s failed: %s", attempt + 1, e)
    raise ValueError(f"Invalid LLM JSON: {last_err}")


def _openai_chat_json(db: Session, system: str, user: str) -> tuple[str, str]:
    """Return (model_name, message_content)."""

    key = _resolve_openai_key(db)
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    cfg = get_settings()
    model = str(get_value(db, "openai_model", cfg.openai_model) or cfg.openai_model)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.3,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=120.0) as client:
        r = client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        body = r.json()
    content = body["choices"][0]["message"]["content"]
    record_llm_call(db)
    return model, content


def _openai_chat_text(db: Session, system: str, user: str) -> tuple[str, str]:
    """Return (model_name, markdown text)."""

    key = _resolve_openai_key(db)
    if not key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    cfg = get_settings()
    model = str(get_value(db, "openai_model", cfg.openai_model) or cfg.openai_model)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.5,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=120.0) as client:
        r = client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        body = r.json()
    content = body["choices"][0]["message"]["content"]
    record_llm_call(db)
    return model, content


def _gigachat_chat_json(db: Session, system: str, user: str) -> tuple[str, str]:
    """Return (model_name, message_content)."""

    st = _settings_for_gigachat(db)
    model = st.gigachat_model or "GigaChat-2"
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        content = gigachat_client.chat_completion(
            st,
            messages=messages,
            model=model,
            temperature=0.3,
            response_format={"type": "json_object"},
        )
    except Exception:
        logger.warning("GigaChat json_object mode failed, retrying without response_format")
        content = gigachat_client.chat_completion(
            st,
            messages=messages,
            model=model,
            temperature=0.3,
            response_format=None,
        )
    record_llm_call(db)
    return model, content


def _gigachat_chat_text(db: Session, system: str, user: str) -> tuple[str, str]:
    """Return (model_name, markdown text)."""

    st = _settings_for_gigachat(db)
    model = st.gigachat_model or "GigaChat-2"
    content = gigachat_client.chat_completion(
        st,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        model=model,
        temperature=0.5,
        response_format=None,
    )
    record_llm_call(db)
    return model, content


def _stub_match_result() -> tuple[MatchAnalysisLLMResult, str, str]:
    stub_raw = json.dumps(
        {
            "score": 72,
            "categories": ["python", "backend", "other"],
            "strengths_md": "**Совпадения:** опыт Python и веб-разработки.",
            "gaps_md": "**Пробелы:** уточните доменные требования.",
            "hr_advice_md": "Сфокусируйте сопроводительное на релевантных проектах.",
            "summary_for_notification": "Средний матч: стоит уточнить стек и отправить короткое сопроводительное.",
        },
        ensure_ascii=False,
    )
    return _parse_match_json(stub_raw), stub_raw, "stub-no-key"


def run_match_analysis(
    db: Session,
    *,
    title: str,
    company: str,
    location: str,
    schedule: str,
    employment: str,
    experience: str,
    skills: str,
    description_md: str,
    resume_md: str,
) -> tuple[MatchAnalysisLLMResult, str, str]:
    """Return (parsed, raw_response, model)."""

    user = MATCH_ANALYSIS_USER_TEMPLATE.format(
        title=title,
        company=company,
        location=location,
        schedule=schedule,
        employment=employment,
        experience=experience,
        skills=skills,
        description=description_md or "",
        resume=resume_md,
    )
    prov = get_effective_llm_provider(db)

    if prov == "none":
        parsed, raw, model = _stub_match_result()
        record_llm_call(db)
        return parsed, raw, model

    if prov == "gigachat" and gigachat_ready(db):
        try:
            model, raw = _gigachat_chat_json(db, MATCH_ANALYSIS_SYSTEM, user)
            parsed = _parse_match_json(raw)
            return parsed, raw, model
        except Exception:
            logger.exception("GigaChat match analysis failed, falling back")

    if prov == "openai" and _resolve_openai_key(db):
        try:
            model, raw = _openai_chat_json(db, MATCH_ANALYSIS_SYSTEM, user)
            parsed = _parse_match_json(raw)
            return parsed, raw, model
        except Exception:
            logger.exception("OpenAI match analysis failed")

    if prov == "gigachat" and _resolve_openai_key(db):
        try:
            model, raw = _openai_chat_json(db, MATCH_ANALYSIS_SYSTEM, user)
            parsed = _parse_match_json(raw)
            return parsed, raw, model
        except Exception:
            logger.exception("OpenAI fallback after GigaChat failure also failed")

    parsed, raw, model = _stub_match_result()
    record_llm_call(db)
    return parsed, raw, model


def run_cover_letter(
    db: Session,
    *,
    title: str,
    company: str,
    requirements: str,
    resume_md: str,
) -> tuple[str, str]:
    """Return (markdown body, model)."""

    user = COVER_LETTER_USER_TEMPLATE.format(
        title=title,
        company=company,
        requirements=requirements or "",
        resume=resume_md,
    )
    if gigachat_ready(db):
        try:
            model, text = _gigachat_chat_text(db, COVER_LETTER_SYSTEM, user)
            return text.strip(), model
        except Exception:
            logger.exception("GigaChat cover letter failed")

    record_llm_call(db)
    return (
        f"Здравствуйте!\n\nПишу по вакансии **{title}** в **{company}**. "
        f"По моему резюме у меня есть релевантный опыт для этой роли. "
        f"Мне интересна возможность развиваться в задачах вашей команды.\n\n"
        f"Буду рад(а) обсудить детали на интервью.",
        "stub-no-gigachat",
    )


def run_screening_qa_gigachat(
    db: Session,
    *,
    vacancy_markdown: str,
    resume_md: str,
    employer_questions: str,
) -> tuple[str, str]:
    """Answer employer screening questions using **only** GigaChat (no OpenAI fallback).

    Returns:
        Tuple of (markdown answers, model name).

    Raises:
        RuntimeError: If GigaChat is not configured or the call fails.
        ValueError: If ``employer_questions`` is empty or too short after strip.
    """

    q = employer_questions.strip()
    if len(q) < 3:
        raise ValueError("Введите вопросы работодателя (не менее 3 символов).")
    if not gigachat_ready(db):
        raise RuntimeError(
            "GigaChat не настроен: укажите Authorization Key в настройках или переменную окружения.",
        )
    user = SCREENING_QA_USER_TEMPLATE.format(
        vacancy=vacancy_markdown.strip(),
        resume=resume_md.strip(),
        questions=q,
    )
    try:
        model, text = _gigachat_chat_text(db, SCREENING_QA_SYSTEM, user)
        return text.strip(), model
    except Exception as e:
        logger.exception("GigaChat screening Q&A failed")
        raise RuntimeError(str(e)) from e
