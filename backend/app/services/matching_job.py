"""Scheduled resume–vacancy matching, notifications, Telegram."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AnalysisSource, Notification, Resume, Vacancy, VacancyAnalysis
from app.services import llm_service
from app.services.llm_service import try_acquire_slot_for_match_analysis
from app.services.process_events import clear_active, emit_event, set_active
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
    run_id = str(uuid.uuid4())
    set_active(
        db,
        process_type="ai_match",
        run_id=run_id,
        phase="start",
        message="AI-анализ запущен",
        progress=1,
        counters={"analyzed": 0, "notifications": 0},
    )
    emit_event(
        db,
        process_type="ai_match",
        run_id=run_id,
        phase="start",
        status="running",
        message="Запущен пакетный AI-анализ вакансий",
        progress=1,
    )
    active = db.query(Resume).filter(Resume.is_active.is_(True)).order_by(Resume.updated_at.desc()).first()
    if active is None:
        logger.info("Scheduled match: no active resume")
        emit_event(
            db,
            process_type="ai_match",
            run_id=run_id,
            phase="skipped",
            status="completed",
            message="AI-анализ пропущен: нет активного резюме",
            progress=100,
        )
        clear_active(db)
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
    total = len(candidates)
    for idx, v in enumerate(candidates, start=1):
        allowed, wait = try_acquire_slot_for_match_analysis(db)
        if not allowed:
            logger.info("Scheduled match: LLM rate limit, stop batch (retry in %ss)", wait)
            emit_event(
                db,
                process_type="ai_match",
                run_id=run_id,
                phase="rate_limited",
                status="running",
                message=f"AI rate limit: пауза, повтор через {wait}с",
                progress=int((idx / max(1, total)) * 100),
                counters={"analyzed": analyzed, "notifications": notifications},
            )
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
                    hh_link = (v.url or "").strip() or "-"
                    panel_link = f"{link_base}/dashboard/vacancies?vacancyId={v.id}"
                    msg = (
                        f"Матч {parsed.score}/100: {v.title}\n{v.company}\n"
                        f"{parsed.summary_for_notification}\n"
                        f"HH: {hh_link}\n"
                        f"В панели: {panel_link}"
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
            progress = int((idx / max(1, total)) * 100)
            counters = {"analyzed": analyzed, "notifications": notifications, "totalCandidates": total}
            set_active(
                db,
                process_type="ai_match",
                run_id=run_id,
                phase="analyzing",
                message=f"Проанализировано {analyzed}/{total}",
                progress=progress,
                counters=counters,
            )
            emit_event(
                db,
                process_type="ai_match",
                run_id=run_id,
                phase="analyzing",
                status="running",
                message=f"{v.title}: score {parsed.score}/100",
                progress=progress,
                counters=counters,
                details={"vacancyId": str(v.id), "score": parsed.score},
            )
        except Exception:
            logger.exception("Scheduled match failed for vacancy %s", v.id)
            db.rollback()
            emit_event(
                db,
                process_type="ai_match",
                run_id=run_id,
                phase="error",
                status="running",
                message=f"Ошибка анализа вакансии {v.title}",
                details={"vacancyId": str(v.id)},
            )

    set_value(db, "last_match_job_at", datetime.now(timezone.utc).isoformat())
    emit_event(
        db,
        process_type="ai_match",
        run_id=run_id,
        phase="completed",
        status="completed",
        message=f"AI-анализ завершен: {analyzed} обработано, уведомлений {notifications}",
        progress=100,
        counters={"analyzed": analyzed, "notifications": notifications, "totalCandidates": total},
    )
    clear_active(db)
    return {"analyzed": analyzed, "notifications": notifications}


def match_job_status(db: Session) -> dict[str, str | None]:
    """Lightweight status for dashboard."""

    ensure_defaults(db)
    last = get_value(db, "last_match_job_at", None)
    return {"lastRunAt": str(last) if last else None}
