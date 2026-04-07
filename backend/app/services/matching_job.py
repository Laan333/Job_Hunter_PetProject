"""Scheduled resume–vacancy matching, notifications, Telegram."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AnalysisSource, Notification, Resume, Vacancy, VacancyAnalysis
from app.services import llm_service
from app.services.llm_service import try_acquire_llm_slot
from app.services.telegram_service import send_message
from app.settings_service import ensure_defaults, get_bool, get_int, get_value, set_value

logger = logging.getLogger(__name__)

BATCH_LIMIT = 5


def _resume_markdown(r: Resume) -> str:
    parts = [
        f"# {r.position}\n",
        r.raw_text.strip() or "",
        "\n\n## Опыт\n",
        r.experience,
        "\n\n## Навыки\n",
        ", ".join(str(x) for x in (r.skills or [])),
        "\n\n## О себе\n",
        r.about,
    ]
    return "\n".join(parts)


def run_scheduled_matching(db: Session) -> dict[str, int]:
    """Analyze up to BATCH_LIMIT vacancies without analysis for the active resume."""

    ensure_defaults(db)
    s = get_settings()
    active = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if active is None:
        logger.info("Scheduled match: no active resume")
        return {"analyzed": 0, "notifications": 0}

    threshold = get_int(db, "high_match_threshold", s.default_high_match_threshold)
    telegram_enabled = get_bool(db, "telegram_enabled", False)
    notify_on_high_match = get_bool(db, "notify_on_high_match", True)
    tg_on = telegram_enabled and notify_on_high_match
    if not tg_on:
        logger.info(
            "Scheduled match: telegram disabled (telegram_enabled=%s, notify_on_high_match=%s)",
            telegram_enabled,
            notify_on_high_match,
        )

    analyzed_subq = db.query(VacancyAnalysis.vacancy_id).filter(VacancyAnalysis.resume_id == active.id)
    candidates = (
        db.query(Vacancy)
        .filter(~Vacancy.id.in_(analyzed_subq))
        .order_by(Vacancy.published_at.desc().nulls_last())
        .limit(BATCH_LIMIT)
        .all()
    )

    analyzed = 0
    notifications = 0
    for v in candidates:
        allowed, wait = try_acquire_llm_slot(db)
        if not allowed:
            logger.info("Scheduled match: LLM rate limit, stop batch (retry in %ss)", wait)
            break
        try:
            desc = v.description_md or ""
            skills = ", ".join(str(x) for x in (v.skills or []))
            parsed, raw, model = llm_service.run_match_analysis(
                db,
                title=v.title,
                company=v.company,
                location=v.location,
                schedule=v.schedule or "",
                employment=v.employment or "",
                experience=v.experience or "",
                skills=skills,
                description_md=desc,
                resume_md=_resume_markdown(active),
            )
            analysis = VacancyAnalysis(
                id=uuid.uuid4(),
                vacancy_id=v.id,
                resume_id=active.id,
                score=parsed.score,
                categories=list(parsed.categories),
                strengths_md=parsed.strengths_md,
                gaps_md=parsed.gaps_md,
                hr_advice_md=parsed.hr_advice_md,
                summary_notification=parsed.summary_for_notification,
                raw_ai_response=raw,
                model=model,
                prompt_version=llm_service.PROMPT_VERSION_MATCH,
                source=AnalysisSource.scheduled,
                created_at=datetime.now(timezone.utc),
            )
            db.add(analysis)
            v.is_analyzed = True
            v.match_score = parsed.score
            v.ai_analysis = parsed.summary_for_notification
            db.add(v)

            if parsed.score >= threshold:
                n = Notification(
                    id=uuid.uuid4(),
                    vacancy_id=v.id,
                    analysis_id=analysis.id,
                    resume_id=active.id,
                    summary=parsed.summary_for_notification,
                    score=parsed.score,
                    categories=list(parsed.categories),
                    read_at=None,
                    created_at=datetime.now(timezone.utc),
                )
                db.add(n)
                notifications += 1
                if tg_on:
                    link_base = (s.public_url or "").rstrip("/")
                    msg = (
                        f"Матч {parsed.score}/100: {v.title}\n{v.company}\n"
                        f"{parsed.summary_for_notification}\n{link_base}/dashboard/vacancies"
                    )
                    send_res = send_message(msg)
                    if send_res["ok"] and send_res["message_id"]:
                        n.telegram_message_id = send_res["message_id"]
                        n.telegram_sent_at = datetime.now(timezone.utc)
                        logger.info(
                            "Telegram sent for notification=%s vacancy=%s message_id=%s",
                            n.id,
                            v.id,
                            send_res["message_id"],
                        )
                    elif send_res["skipped"]:
                        logger.info(
                            "Telegram skipped for notification=%s vacancy=%s reason=%s",
                            n.id,
                            v.id,
                            send_res["reason"],
                        )
                    else:
                        logger.warning(
                            "Telegram failed for notification=%s vacancy=%s reason=%s",
                            n.id,
                            v.id,
                            send_res["reason"],
                        )
            db.commit()
            analyzed += 1
        except Exception:
            logger.exception("Scheduled match failed for vacancy %s", v.id)
            db.rollback()

    set_value(db, "last_match_job_at", datetime.now(timezone.utc).isoformat())
    return {"analyzed": analyzed, "notifications": notifications}


def match_job_status(db: Session) -> dict[str, str | None]:
    """Lightweight status for dashboard."""

    ensure_defaults(db)
    last = get_value(db, "last_match_job_at", None)
    return {"lastRunAt": str(last) if last else None}
