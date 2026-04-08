"""Vacancy list/detail, patch, cover letter, LLM analysis."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import String, or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.deps import verify_api_key
from app.models import AnalysisSource, CoverLetter, Resume, Vacancy, VacancyAnalysis, VacancyStatus
from app.serializers import analysis_to_dict, vacancy_to_dict
from app.services import hh_client
from app.services.hh_mapper import enrich_from_detail
from app.services import llm_service
from app.services.llm_service import assert_llm_slot

logger = logging.getLogger(__name__)

# Совпадает с верхней границей «макс. вакансий на поиск» в настройках (UI до 500).
MAX_VACANCIES_PAGE_SIZE = 500

router = APIRouter(prefix="/vacancies", tags=["vacancies"])


def _rate_limit_http(db: Session) -> None:
    try:
        assert_llm_slot(db)
    except PermissionError as e:
        msg = str(e)
        if msg.startswith("RATE_LIMIT:"):
            wait = int(msg.split(":")[1])
            raise HTTPException(
                status_code=429,
                detail={"message": "LLM rate limit", "retryAfterSeconds": wait},
                headers={"Retry-After": str(wait)},
            ) from e
        raise


class VacancyPatchBody(BaseModel):
    """Partial update for vacancy UI state."""

    status: VacancyStatus | None = None
    is_favorite: bool | None = Field(default=None, alias="isFavorite")
    is_analyzed: bool | None = Field(default=None, alias="isAnalyzed")

    model_config = {"populate_by_name": True}


class CoverLetterBody(BaseModel):
    """Optional resume scope for cover letter."""

    resume_id: UUID | None = Field(default=None, alias="resumeId")

    model_config = {"populate_by_name": True}


class VacancyScreeningQABody(BaseModel):
    """Employer questions from the application form; answered via GigaChat only."""

    questions: str = Field(..., min_length=3, max_length=20_000)
    resume_id: UUID | None = Field(default=None, alias="resumeId")

    model_config = {"populate_by_name": True}


def _resume_markdown(r: Resume) -> str:
    parts = [
        f"# {r.position}\n",
        r.raw_text.strip() or "",
        "\n\n## Опыт\n",
        r.experience,
        "\n\n## Навыки\n",
        ", ".join(str(x) for x in (r.skills or [])),
    ]
    return "\n".join(parts)


def _vacancy_markdown_bundle(v: Vacancy) -> str:
    """All vacancy fields useful for answering screening questions."""

    lines: list[str] = [f"# {v.title}", "", f"**Компания:** {v.company}", f"**Локация:** {v.location}"]
    if v.experience:
        lines.append(f"**Опыт (из карточки):** {v.experience}")
    if v.employment:
        lines.append(f"**Занятость:** {v.employment}")
    if v.schedule:
        lines.append(f"**График:** {v.schedule}")
    sal_bits: list[str] = []
    if v.salary_from is not None:
        sal_bits.append(f"от {v.salary_from}")
    if v.salary_to is not None:
        sal_bits.append(f"до {v.salary_to}")
    if sal_bits:
        cur = v.salary_currency or "RUR"
        gross_note = " (до вычета налогов)" if v.salary_gross else ""
        lines.append(f"**Зарплата:** {' — '.join(sal_bits)} {cur}{gross_note}")
    skills = ", ".join(str(s) for s in (v.skills or []) if s)
    if skills:
        lines.append(f"**Навыки:** {skills}")
    lines.extend(["", "## Описание", (v.description_md or "_нет_").strip() or "_нет_"])
    if (v.requirements_md or "").strip():
        lines.extend(["", "## Требования", v.requirements_md.strip()])
    if (v.responsibilities_md or "").strip():
        lines.extend(["", "## Обязанности", v.responsibilities_md.strip()])
    lines.extend(["", f"**URL:** {v.url}"])
    return "\n".join(lines)


@router.get("/")
def list_vacancies(
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
    status: VacancyStatus | None = None,
    favorite_only: bool = Query(default=False, alias="favoriteOnly"),
    search_text: str | None = Query(
        default=None,
        alias="q",
        description="Case-insensitive text search in title/company/description/skills",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=MAX_VACANCIES_PAGE_SIZE, alias="pageSize"),
    saved_search_id: UUID | None = Query(
        default=None,
        alias="savedSearchId",
        description="Filter by saved search (HH query) that first ingested the vacancy",
    ),
) -> dict[str, Any]:
    """Paginated vacancy list."""

    stmt = db.query(Vacancy).options(joinedload(Vacancy.saved_search))
    if saved_search_id is not None:
        stmt = stmt.filter(Vacancy.saved_search_id == saved_search_id)
    if status is not None:
        stmt = stmt.filter(Vacancy.status == status)
    if favorite_only:
        stmt = stmt.filter(Vacancy.is_favorite.is_(True))
    if search_text:
        # Tokenized search: "fastapi python" matches rows containing both terms
        # in any searchable text field (not necessarily as one exact phrase).
        tokens = [t.strip() for t in search_text.split() if t.strip()]
        for token in tokens:
            term = f"%{token}%"
            stmt = stmt.filter(
                or_(
                    Vacancy.title.ilike(term),
                    Vacancy.company.ilike(term),
                    Vacancy.description_md.ilike(term),
                    Vacancy.requirements_md.ilike(term),
                    Vacancy.responsibilities_md.ilike(term),
                    Vacancy.skills.cast(String).ilike(term),
                )
            )
    total = stmt.count()
    rows = (
        stmt.order_by(Vacancy.published_at.desc().nulls_last())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [vacancy_to_dict(v) for v in rows],
        "total": total,
        "page": page,
        "pageSize": page_size,
    }


@router.get("/{vacancy_id}")
def get_vacancy(
    vacancy_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    v = (
        db.query(Vacancy)
        .options(joinedload(Vacancy.saved_search))
        .filter(Vacancy.id == vacancy_id)
        .one_or_none()
    )
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    need_full = (
        v.source == "hh"
        and (
            not (v.description_md or "").strip()
            or len((v.description_md or "").strip()) < 700
            or not (v.requirements_md or "").strip()
            or not (v.responsibilities_md or "").strip()
        )
    )
    if need_full:
        try:
            detail = hh_client.fetch_vacancy_detail(v.external_id)
            enriched = enrich_from_detail(
                {
                    "raw_payload": dict(v.raw_payload or {}),
                    "description_md": v.description_md,
                    "requirements_md": v.requirements_md,
                    "responsibilities_md": v.responsibilities_md,
                    "skills": list(v.skills or []),
                    "experience": v.experience,
                    "employment": v.employment,
                    "schedule": v.schedule,
                },
                detail,
            )
            v.raw_payload = enriched.get("raw_payload", v.raw_payload)
            v.description_md = enriched.get("description_md", v.description_md)
            v.requirements_md = enriched.get("requirements_md", v.requirements_md)
            v.responsibilities_md = enriched.get("responsibilities_md", v.responsibilities_md)
            v.skills = enriched.get("skills", v.skills)
            v.experience = enriched.get("experience", v.experience)
            v.employment = enriched.get("employment", v.employment)
            v.schedule = enriched.get("schedule", v.schedule)
            db.add(v)
            db.commit()
            db.refresh(v)
        except Exception:
            logger.exception("Failed to enrich full vacancy detail for %s", v.id)
    return vacancy_to_dict(v)


@router.patch("/{vacancy_id}")
def patch_vacancy(
    vacancy_id: UUID,
    body: VacancyPatchBody,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    v = db.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if body.status is not None:
        v.status = body.status
    if body.is_favorite is not None:
        v.is_favorite = body.is_favorite
    if body.is_analyzed is not None:
        v.is_analyzed = body.is_analyzed
    db.add(v)
    db.commit()
    db.refresh(v)
    return vacancy_to_dict(v)


@router.delete("/{vacancy_id}")
def delete_vacancy(
    vacancy_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, str]:
    v = db.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    db.delete(v)
    db.commit()
    return {"ok": "true"}


@router.post("/{vacancy_id}/cover-letter")
def post_cover_letter(
    vacancy_id: UUID,
    body: CoverLetterBody,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    v = db.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if body.resume_id:
        resume = db.get(Resume, body.resume_id)
    else:
        resume = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if resume is None:
        raise HTTPException(status_code=400, detail="No resume found")

    _rate_limit_http(db)
    try:
        text, model = llm_service.run_cover_letter(
            db,
            title=v.title,
            company=v.company,
            requirements=v.requirements_md or v.description_md or "",
            resume_md=_resume_markdown(resume),
        )
    except Exception as e:
        logger.exception("Cover letter failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    cl = CoverLetter(
        id=uuid.uuid4(),
        vacancy_id=v.id,
        resume_id=resume.id,
        body_md=text,
        model=model,
        created_at=datetime.now(timezone.utc),
    )
    db.add(cl)
    v.cover_letter_text = text
    db.add(v)
    db.commit()
    return {"coverLetter": text, "model": model}


@router.post("/{vacancy_id}/screening-answers")
def post_screening_answers(
    vacancy_id: UUID,
    body: VacancyScreeningQABody,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    """Answer employer form questions using GigaChat (resume + full vacancy context)."""

    v = db.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    if body.resume_id:
        resume = db.get(Resume, body.resume_id)
    else:
        resume = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if resume is None:
        raise HTTPException(status_code=400, detail="No resume found")

    _rate_limit_http(db)
    vacancy_md = _vacancy_markdown_bundle(v)
    resume_md = _resume_markdown(resume)
    try:
        text, model = llm_service.run_screening_qa_gigachat(
            db,
            vacancy_markdown=vacancy_md,
            resume_md=resume_md,
            employer_questions=body.questions,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        logger.error("Screening Q&A unavailable: %s", e)
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Screening Q&A failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    logger.info(
        "screening_answers vacancy=%s model=%s prompt=%s",
        vacancy_id,
        model,
        llm_service.PROMPT_VERSION_SCREENING_QA,
    )
    return {
        "answers": text,
        "model": model,
        "promptVersion": llm_service.PROMPT_VERSION_SCREENING_QA,
    }


@router.post("/{vacancy_id}/analyze")
def post_analyze(
    vacancy_id: UUID,
    db: Session = Depends(get_db),
    _t: str = Depends(verify_api_key),
) -> dict[str, Any]:
    v = db.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Vacancy not found")
    resume = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if resume is None:
        raise HTTPException(status_code=400, detail="No active resume")

    _rate_limit_http(db)
    try:
        parsed, raw, model = llm_service.run_match_analysis(
            db,
            title=v.title,
            company=v.company,
            location=v.location,
            schedule=v.schedule or "",
            employment=v.employment or "",
            experience=v.experience or "",
            skills=", ".join(str(x) for x in (v.skills or [])),
            description_md=v.description_md or "",
            resume_md=_resume_markdown(resume),
        )
    except Exception as e:
        logger.exception("Analyze failed")
        raise HTTPException(status_code=502, detail=str(e)) from e

    analysis = VacancyAnalysis(
        id=uuid.uuid4(),
        vacancy_id=v.id,
        resume_id=resume.id,
        score=parsed.score,
        categories=list(parsed.categories),
        strengths_md=parsed.strengths_md,
        gaps_md=parsed.gaps_md,
        hr_advice_md=parsed.hr_advice_md,
        summary_notification=parsed.summary_for_notification,
        raw_ai_response=raw,
        model=model,
        prompt_version=llm_service.PROMPT_VERSION_MATCH,
        source=AnalysisSource.manual,
        created_at=datetime.now(timezone.utc),
    )
    db.add(analysis)
    v.is_analyzed = True
    v.match_score = parsed.score
    v.ai_analysis = parsed.summary_for_notification
    db.add(v)
    db.commit()
    db.refresh(analysis)
    return {"analysis": analysis_to_dict(analysis)}
