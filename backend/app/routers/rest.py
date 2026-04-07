"""Searches, settings, resume, sync logs, analytics, notifications, match status."""

from __future__ import annotations

import logging
import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import verify_api_key
from app.models import (
    Notification,
    Resume,
    SavedSearch,
    SyncRun,
    SyncRunItem,
    SyncTrigger,
    Vacancy,
    VacancyStatus,
)
from app.serializers import notification_to_dict, resume_to_dict, search_to_dict, sync_run_to_dict
from app.services.llm_service import get_llm_status
from app.services.matching_job import match_job_status, run_scheduled_matching
from app.services.process_events import get_process_logs, get_process_status
from app.services.sync_service import run_full_sync, sync_one_search
from app.settings_service import ensure_defaults, get_bool, get_int, get_str, get_value, set_value
from app.sources import VacancySourceRegistry

logger = logging.getLogger(__name__)

router = APIRouter(tags=["rest"])

_SKILL_FALLBACK_KEYWORDS: tuple[str, ...] = (
    "python",
    "django",
    "fastapi",
    "flask",
    "sql",
    "postgresql",
    "docker",
    "kubernetes",
    "aws",
    "gcp",
    "azure",
    "redis",
    "celery",
    "git",
    "linux",
    "javascript",
    "typescript",
    "react",
    "next.js",
    "node.js",
    "pandas",
    "numpy",
    "machine learning",
    "nlp",
    "llm",
)


def _normalize_skill_name(value: str) -> str:
    clean = re.sub(r"\s+", " ", value).strip()
    return clean.lower()


def _collect_skills_counter(db: Session) -> Counter[str]:
    skills_counter: Counter[str] = Counter()
    rows = db.query(Vacancy.skills, Vacancy.title, Vacancy.requirements_md, Vacancy.description_md).all()
    for skills, title, requirements, description in rows:
        normalized_any = False
        for item in skills or []:
            raw = str(item or "").strip()
            if not raw:
                continue
            normalized = _normalize_skill_name(raw)
            if normalized:
                skills_counter[normalized] += 1
                normalized_any = True
        if normalized_any:
            continue

        haystack = " ".join(
            part for part in [str(title or ""), str(requirements or ""), str(description or "")] if part
        ).lower()
        if not haystack:
            continue
        for kw in _SKILL_FALLBACK_KEYWORDS:
            if kw in haystack:
                skills_counter[kw] += 1
    return skills_counter


def _mask_secret(value: str | None) -> str:
    if not value:
        return ""
    if len(value) <= 4:
        return "****"
    return "****" + value[-4:]


class SearchCreate(BaseModel):
    """Create saved search (hh.ru oriented)."""

    keyword: str
    location: str | None = None
    area_id: int | None = Field(default=None, alias="areaId")
    experience: str | None = None
    employment: str | None = None
    schedule: str | None = None
    salary_from: int | None = Field(default=None, alias="salaryFrom")
    salary_to: int | None = Field(default=None, alias="salaryTo")
    is_active: bool = Field(default=True, alias="isActive")
    interval: int = Field(default=60, ge=1)
    max_vacancies: int = Field(default=200, ge=1, le=1000, alias="maxVacancies")
    vacancy_source: str = Field(default="hh", alias="vacancySource")

    model_config = {"populate_by_name": True}


class SearchPatch(BaseModel):
    """Patch saved search."""

    keyword: str | None = None
    location: str | None = None
    area_id: int | None = Field(default=None, alias="areaId")
    experience: str | None = None
    employment: str | None = None
    schedule: str | None = None
    salary_from: int | None = Field(default=None, alias="salaryFrom")
    salary_to: int | None = Field(default=None, alias="salaryTo")
    is_active: bool | None = Field(default=None, alias="isActive")
    interval: int | None = Field(default=None, ge=1)
    max_vacancies: int | None = Field(default=None, ge=1, le=1000, alias="maxVacancies")
    vacancy_source: str | None = Field(default=None, alias="vacancySource")

    model_config = {"populate_by_name": True}


class SettingsPatch(BaseModel):
    """Dashboard settings (camelCase for frontend)."""

    gigachat_authorization_key: str | None = Field(default=None, alias="gigachatAuthorizationKey")
    gigachat_api_key: str | None = Field(
        default=None,
        alias="gigachatApiKey",
        description="Deprecated: то же, что Authorization Key; используйте gigachatAuthorizationKey.",
    )
    openai_api_key: str | None = Field(default=None, alias="openaiApiKey")
    refresh_interval: int | None = Field(default=None, alias="refreshInterval")
    auto_analyze: bool | None = Field(default=None, alias="autoAnalyze")
    max_vacancies_per_search: int | None = Field(default=None, alias="maxVacanciesPerSearch")
    analyze_delay_minutes: int | None = Field(default=None, alias="analyzeDelay")
    browser_notifications: bool | None = Field(default=None, alias="browserNotifications")
    notify_on_new_vacancies: bool | None = Field(default=None, alias="notifyOnNewVacancies")
    notify_on_high_match: bool | None = Field(default=None, alias="notifyOnHighMatch")
    high_match_threshold: int | None = Field(default=None, alias="highMatchThreshold")
    telegram_enabled: bool | None = Field(default=None, alias="telegramEnabled")
    match_analysis_interval_minutes: int | None = Field(default=None, alias="matchAnalysisIntervalMinutes")
    llm_min_interval_seconds: int | None = Field(default=None, alias="llmMinIntervalSeconds")
    hh_daily_sync_time: str | None = Field(default=None, alias="hhDailySyncTime")
    hh_daily_sync_timezone: str | None = Field(default=None, alias="hhDailySyncTimezone")
    vacancy_max_age_days: int | None = Field(default=None, alias="vacancyMaxAgeDays")
    llm_provider: str | None = Field(default=None, alias="llmProvider")

    model_config = {"populate_by_name": True}


class ResumePut(BaseModel):
    """Full resume replace."""

    title: str = ""
    full_name: str = Field(default="", alias="fullName")
    position: str = ""
    experience: str = ""
    skills: list[str] = Field(default_factory=list)
    education: str = ""
    about: str = ""
    contacts: dict[str, Any] = Field(default_factory=dict)
    raw_text: str = Field(default="", alias="rawText")
    is_active: bool = Field(default=True, alias="isActive")

    model_config = {"populate_by_name": True}


@router.get("/searches")
def list_searches(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> list[dict[str, Any]]:
    rows = db.query(SavedSearch).order_by(SavedSearch.created_at.desc()).all()
    return [search_to_dict(s) for s in rows]


@router.post("/searches")
def create_search(
    body: SearchCreate,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    src_id = body.vacancy_source.lower().strip() or "hh"
    try:
        VacancySourceRegistry.get(src_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown vacancySource") from None
    experience = body.experience.strip() if body.experience else None
    if experience in {"any", "__any__", ""}:
        experience = None
    employment = body.employment.strip() if body.employment else None
    if employment in {"any", "__any__", ""}:
        employment = None

    s = SavedSearch(
        id=uuid.uuid4(),
        keyword=body.keyword,
        area_id=body.area_id,
        location_label=body.location,
        experience=experience,
        employment=employment,
        schedule=body.schedule,
        salary_from=body.salary_from,
        salary_to=body.salary_to,
        is_active=body.is_active,
        interval_minutes=body.interval,
        max_vacancies=body.max_vacancies,
        vacancy_source=src_id,
        last_run_at=None,
        last_error=None,
        vacancies_found=0,
        created_at=now,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return search_to_dict(s)


@router.patch("/searches/{search_id}")
def patch_search(
    search_id: UUID,
    body: SearchPatch,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    s = db.get(SavedSearch, search_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Search not found")
    data = body.model_dump(exclude_unset=True, by_alias=False)
    if "area_id" in data:
        s.area_id = data["area_id"]
    if "keyword" in data and data["keyword"] is not None:
        s.keyword = data["keyword"]
    if "location" in data:
        s.location_label = data["location"]
    if "experience" in data:
        v = data["experience"]
        v = v.strip() if isinstance(v, str) else v
        s.experience = None if v in {None, "", "any", "__any__"} else v
    if "employment" in data:
        v = data["employment"]
        v = v.strip() if isinstance(v, str) else v
        s.employment = None if v in {None, "", "any", "__any__"} else v
    if "schedule" in data:
        s.schedule = data["schedule"]
    if "salary_from" in data:
        s.salary_from = data["salary_from"]
    if "salary_to" in data:
        s.salary_to = data["salary_to"]
    if "is_active" in data and data["is_active"] is not None:
        s.is_active = data["is_active"]
    if "interval" in data and data["interval"] is not None:
        s.interval_minutes = data["interval"]
    if "max_vacancies" in data and data["max_vacancies"] is not None:
        s.max_vacancies = data["max_vacancies"]
    if "vacancy_source" in data and data["vacancy_source"] is not None:
        vs = str(data["vacancy_source"]).lower().strip()
        try:
            VacancySourceRegistry.get(vs)
        except ValueError:
            raise HTTPException(status_code=400, detail="Unknown vacancySource") from None
        s.vacancy_source = vs
    db.add(s)
    db.commit()
    db.refresh(s)
    return search_to_dict(s)


@router.post("/searches/{search_id}/sync")
def run_saved_search_sync(
    search_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    """Fetch vacancies for one saved search immediately (inactive OK; scheduled sync still skips paused)."""

    s_row = db.get(SavedSearch, search_id)
    if s_row is None:
        raise HTTPException(status_code=404, detail="Search not found")

    ensure_defaults(db)
    settings = get_settings()
    max_per_search = int(s_row.max_vacancies or get_int(db, "max_vacancies_per_search", 200))
    per_page = min(100, max_per_search)
    max_pages = max(1, (max_per_search + per_page - 1) // per_page)

    stats = sync_one_search(
        db,
        s_row,
        max_pages=max_pages,
        per_page=per_page,
        fetch_detail=settings.hh_fetch_detail,
    )
    auto_match_stats: dict[str, int] | None = None
    if get_bool(db, "auto_analyze", False):
        auto_match_stats = run_scheduled_matching(db)
    db.refresh(s_row)
    return {
        "inserted": stats["inserted"],
        "skippedDuplicates": stats["skipped_duplicates"],
        "durationMs": stats["duration_ms"],
        "error": stats.get("error"),
        "search": search_to_dict(s_row),
        "autoAnalyze": auto_match_stats,
    }


@router.delete("/searches/{search_id}")
def delete_search(
    search_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, str]:
    s = db.get(SavedSearch, search_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Search not found")
    db.delete(s)
    db.commit()
    return {"ok": "true"}


def _gigachat_authorization_key_resolved(db: Session) -> str:
    """Authorization Key из env в приоритете, затем из БД (legacy fallback)."""

    s = get_settings()
    return (
        (s.gigachat_authorization_key or "").strip()
        or get_str(db, "gigachat_authorization_key", "").strip()
        or get_str(db, "gigachat_api_key", "").strip()
    )


def _openai_api_key_resolved(db: Session) -> str:
    """OpenAI key with env-first precedence."""

    s = get_settings()
    return (
        (s.openai_api_key or "").strip()
        or get_str(db, "openai_api_key", "").strip()
    )


def _settings_response(db: Session) -> dict[str, Any]:
    ensure_defaults(db)
    s = get_settings()
    gk = _gigachat_authorization_key_resolved(db)
    ok = _openai_api_key_resolved(db)
    match_interval = get_int(
        db,
        "match_analysis_interval_minutes",
        s.default_match_interval_minutes,
    )
    return {
        "apiKeys": {
            "gigachatAuthorizationKey": _mask_secret(gk),
            "gigachat": _mask_secret(gk),
            "openai": _mask_secret(ok),
        },
        "refreshInterval": get_int(db, "refresh_interval", 60),
        "autoAnalyze": get_bool(db, "auto_analyze", False),
        "maxVacanciesPerSearch": get_int(db, "max_vacancies_per_search", 200),
        "analyzeDelay": match_interval,
        "notifications": {
            "email": False,
            "browser": get_bool(db, "browser_notifications", False),
        },
        "browserNotifications": get_bool(db, "browser_notifications", False),
        "notifyOnNewVacancies": get_bool(db, "notify_on_new_vacancies", False),
        "notifyOnHighMatch": get_bool(db, "notify_on_high_match", True),
        "highMatchThreshold": get_int(db, "high_match_threshold", s.default_high_match_threshold),
        "telegramEnabled": get_bool(db, "telegram_enabled", False),
        "telegramConfigured": bool((s.telegram_bot_token or "").strip() and (s.telegram_chat_id or "").strip()),
        "matchAnalysisIntervalMinutes": match_interval,
        "llmMinIntervalSeconds": get_int(db, "llm_min_interval_seconds", s.default_llm_min_interval_seconds),
        "hhDailySyncTime": get_str(db, "hh_daily_sync_time", s.default_hh_sync_time),
        "hhDailySyncTimezone": get_str(db, "hh_daily_sync_timezone", s.default_hh_sync_timezone),
        "vacancyMaxAgeDays": get_int(db, "vacancy_max_age_days", s.default_vacancy_max_age_days),
        "llmProvider": get_str(db, "llm_provider", s.llm_provider),
        "vacancySources": VacancySourceRegistry.ids(),
    }


@router.get("/settings")
def get_settings_api(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, Any]:
    return _settings_response(db)


@router.patch("/settings")
def patch_settings(
    body: SettingsPatch,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    ensure_defaults(db)
    raw = body.model_dump(exclude_unset=True, by_alias=False)
    gc_new = raw.pop("gigachat_authorization_key", None)
    gc_old = raw.pop("gigachat_api_key", None)
    if gc_new is not None or gc_old is not None:
        gc_val = gc_new if (gc_new is not None and gc_new != "") else gc_old
        if gc_val is not None and gc_val != "":
            set_value(db, "gigachat_authorization_key", gc_val)
    delay_minutes = raw.get("analyze_delay_minutes")
    if delay_minutes is not None:
        try:
            dm = max(1, int(delay_minutes))
            # Backward compatible alias from legacy UI field.
            raw["match_analysis_interval_minutes"] = dm
            raw["llm_min_interval_seconds"] = dm * 60
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid analyzeDelay") from None

    key_map = {
        "openai_api_key": "openai_api_key",
        "refresh_interval": "refresh_interval",
        "auto_analyze": "auto_analyze",
        "max_vacancies_per_search": "max_vacancies_per_search",
        "analyze_delay_minutes": "analyze_delay_minutes",
        "browser_notifications": "browser_notifications",
        "notify_on_new_vacancies": "notify_on_new_vacancies",
        "notify_on_high_match": "notify_on_high_match",
        "high_match_threshold": "high_match_threshold",
        "telegram_enabled": "telegram_enabled",
        "match_analysis_interval_minutes": "match_analysis_interval_minutes",
        "llm_min_interval_seconds": "llm_min_interval_seconds",
        "hh_daily_sync_time": "hh_daily_sync_time",
        "hh_daily_sync_timezone": "hh_daily_sync_timezone",
        "vacancy_max_age_days": "vacancy_max_age_days",
        "llm_provider": "llm_provider",
    }
    for pydantic_key, store_key in key_map.items():
        if pydantic_key not in raw:
            continue
        val = raw[pydantic_key]
        if pydantic_key == "openai_api_key" and (val is None or val == ""):
            continue
        if pydantic_key == "llm_provider" and val is not None:
            v = str(val).lower().strip()
            if v not in ("openai", "gigachat", "none"):
                raise HTTPException(status_code=400, detail="Invalid llmProvider")
            set_value(db, store_key, v)
            continue
        set_value(db, store_key, val)
    return _settings_response(db)


@router.get("/llm/status")
def llm_status_endpoint(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, Any]:
    """Cooldown / provider flags for dashboard LLM actions."""

    return get_llm_status(db)


@router.get("/resumes")
def list_resumes(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> list[dict[str, Any]]:
    """All resumes (newest first)."""

    rows = db.query(Resume).order_by(Resume.updated_at.desc()).all()
    return [resume_to_dict(r) for r in rows]


@router.post("/resumes")
def create_resume(
    body: ResumePut,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    """Create an additional resume row (does not deactivate existing)."""

    now = datetime.now(timezone.utc)
    r = Resume(
        id=uuid.uuid4(),
        title=body.title,
        full_name=body.full_name,
        position=body.position,
        experience=body.experience,
        skills=list(body.skills),
        education=body.education,
        about=body.about,
        contacts=dict(body.contacts),
        raw_text=body.raw_text,
        is_active=body.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return resume_to_dict(r)


@router.get("/resume")
def get_resume(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, Any]:
    r = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if r is None:
        r = db.query(Resume).order_by(Resume.updated_at.desc()).first()
    if r is None:
        raise HTTPException(status_code=404, detail="No resume")
    return resume_to_dict(r)


@router.put("/resume")
def put_resume(
    body: ResumePut,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    r = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if r is None:
        r = Resume(
            id=uuid.uuid4(),
            title=body.title,
            full_name=body.full_name,
            position=body.position,
            experience=body.experience,
            skills=list(body.skills),
            education=body.education,
            about=body.about,
            contacts=dict(body.contacts),
            raw_text=body.raw_text,
            is_active=body.is_active,
            created_at=now,
            updated_at=now,
        )
        db.add(r)
    else:
        r.title = body.title
        r.full_name = body.full_name
        r.position = body.position
        r.experience = body.experience
        r.skills = list(body.skills)
        r.education = body.education
        r.about = body.about
        r.contacts = dict(body.contacts)
        r.raw_text = body.raw_text
        r.is_active = body.is_active
        r.updated_at = now
        db.add(r)
    db.commit()
    db.refresh(r)
    return resume_to_dict(r)


@router.post("/resume/upload")
async def upload_resume_file(
    file: UploadFile = File(...),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    """Extract plain text from .txt, .pdf, or .docx for the resume ``rawText`` field."""

    from app.services.resume_file_parse import MAX_RESUME_UPLOAD_BYTES, extract_resume_text

    raw_name = file.filename or "upload.txt"
    data = await file.read()
    if len(data) > MAX_RESUME_UPLOAD_BYTES:
        mb = MAX_RESUME_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File too large (max {mb} MB)")
    try:
        text, warnings = extract_resume_text(raw_name, data)
    except ValueError as e:
        code = str(e)
        if code == "unsupported_format":
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Use .txt, .pdf, or .docx",
            ) from e
        if code == "file_too_large":
            mb = MAX_RESUME_UPLOAD_BYTES // (1024 * 1024)
            raise HTTPException(status_code=413, detail=f"File too large (max {mb} MB)") from e
        raise HTTPException(
            status_code=400,
            detail="Could not read file. It may be corrupted or password-protected.",
        ) from e
    return {"rawText": text, "fileName": raw_name, "warnings": warnings}


@router.post("/sync")
def post_sync(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, str | None]:
    run = run_full_sync(db, trigger=SyncTrigger.manual)
    return {
        "runId": str(run.id),
        "status": "completed" if run.finished_at else "failed",
        "error": run.error,
    }


@router.get("/sync/logs")
def sync_logs(
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[dict[str, Any]]:
    runs = db.query(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit).all()
    out: list[dict[str, Any]] = []
    for r in runs:
        items = db.query(SyncRunItem).filter(SyncRunItem.sync_run_id == r.id).all()
        out.append(sync_run_to_dict(r, items))
    return out


@router.post("/data/clear-vacancies")
def clear_all_vacancies(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, int]:
    """Delete all vacancies and reset saved search counters."""

    r = db.execute(delete(Vacancy))
    db.query(SavedSearch).update(
        {
            SavedSearch.vacancies_found: 0,
            SavedSearch.last_error: None,
        },
        synchronize_session=False,
    )
    db.commit()
    return {"deleted": int(r.rowcount or 0)}


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, Any]:
    total = db.query(func.count(Vacancy.id)).scalar() or 0
    analyzed = db.query(func.count(Vacancy.id)).filter(Vacancy.is_analyzed.is_(True)).scalar() or 0
    applied = db.query(func.count(Vacancy.id)).filter(Vacancy.status == VacancyStatus.applied).scalar() or 0
    favorites = db.query(func.count(Vacancy.id)).filter(Vacancy.is_favorite.is_(True)).scalar() or 0

    from datetime import timedelta

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    new_today = (
        db.query(func.count(Vacancy.id))
        .filter(Vacancy.published_at.is_not(None), Vacancy.published_at >= today_start)
        .scalar()
        or 0
    )

    avg_row = db.query(func.avg(Vacancy.salary_from)).filter(Vacancy.salary_from.isnot(None)).scalar()
    avg_salary = int(avg_row) if avg_row is not None else 0

    skills_counter = _collect_skills_counter(db)
    top_skills = [{"skill": k, "count": v} for k, v in skills_counter.most_common(12)]

    by_date: dict[str, int] = {}
    for (pub,) in db.query(Vacancy.published_at).filter(Vacancy.published_at.isnot(None)).all():
        if pub is None:
            continue
        d = pub.date().isoformat()
        by_date[d] = by_date.get(d, 0) + 1
    vacancies_by_date = sorted(({"date": k, "count": v} for k, v in by_date.items()), key=lambda x: x["date"])[
        -14:
    ]

    by_exp: Counter[str] = Counter()
    for (ex,) in db.query(Vacancy.experience).all():
        if ex:
            by_exp[ex] += 1
    vacancies_by_experience = [{"experience": k, "count": v} for k, v in by_exp.most_common()]

    return {
        "totalVacancies": total,
        "newToday": new_today,
        "analyzed": analyzed,
        "applied": applied,
        "favorites": favorites,
        "avgSalary": avg_salary,
        "topSkills": top_skills,
        "vacanciesByDate": vacancies_by_date,
        "vacanciesBySource": [{"source": "hh.ru", "count": total}],
        "vacanciesByExperience": vacancies_by_experience,
    }


@router.get("/notifications")
def list_notifications(
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
    unread_only: bool = Query(default=False, alias="unreadOnly"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
) -> dict[str, Any]:
    q = db.query(Notification)
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    total = q.count()
    rows = q.order_by(Notification.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [notification_to_dict(n) for n in rows],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    n = db.get(Notification, notification_id)
    if n is None:
        raise HTTPException(status_code=404, detail="Not found")
    n.read_at = datetime.now(timezone.utc)
    db.add(n)
    db.commit()
    return notification_to_dict(n)


@router.post("/notifications/mark-all-read")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    q = db.query(Notification).filter(Notification.read_at.is_(None))
    count = 0
    for n in q.all():
        n.read_at = now
        db.add(n)
        count += 1
    db.commit()
    return {"updated": count}


@router.get("/match-job/status")
def match_status(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, str | None]:
    return match_job_status(db)


@router.post("/match-job/run-once")
def match_run_once(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, int]:
    """Manual trigger for scheduled matching (admin)."""

    stats = run_scheduled_matching(db)
    return stats


@router.get("/process/status")
def process_status(db: Session = Depends(get_db), _t: str = Depends(verify_api_key)) -> dict[str, Any]:
    """Current active long-running process status for header polling."""
    ensure_defaults(db)
    state = get_process_status(db)
    auto_analyze = get_bool(db, "auto_analyze", False)
    state["autoAnalyzeEnabled"] = auto_analyze
    if auto_analyze and not state.get("active"):
        s = get_settings()
        interval_min = get_int(db, "match_analysis_interval_minutes", s.default_match_interval_minutes)
        last_raw = get_value(db, "last_match_job_at", None)
        if last_raw:
            try:
                lm = datetime.fromisoformat(str(last_raw).replace("Z", "+00:00"))
                if lm.tzinfo is None:
                    lm = lm.replace(tzinfo=timezone.utc)
                delta_sec = int((datetime.now(timezone.utc) - lm).total_seconds())
                wait_sec = max(0, interval_min * 60 - delta_sec)
                state["waiting"] = wait_sec > 0
                state["waitSeconds"] = wait_sec
                if wait_sec > 0:
                    state["message"] = f"Авто-анализ в ожидании, следующий запуск через ~{max(1, wait_sec // 60)} мин"
                else:
                    state["message"] = "Авто-анализ готов к следующему запуску"
            except ValueError:
                state["waiting"] = False
        else:
            state["waiting"] = False
            state["message"] = "Авто-анализ готов к первому запуску"
    elif not auto_analyze and not state.get("active"):
        state["waiting"] = False
        state["message"] = "Авто-анализ выключен в настройках"
    return state


@router.get("/process/logs")
def process_logs(
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
    limit: int = Query(default=100, ge=1, le=300),
) -> list[dict[str, Any]]:
    """Recent process events timeline (sync + ai_match)."""

    return get_process_logs(db, limit=limit)
