"""hh.ru sync: saved searches queue, insert-only, TTL cleanup."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

import httpx

from app.config import get_settings
from app.models import SavedSearch, SyncRun, SyncRunItem, SyncTrigger, Vacancy, VacancyStatus
from app.services import hh_client
from app.services.hh_mapper import enrich_from_detail, map_list_item_to_row
from app.services.process_events import clear_active, emit_event, set_active
from app.services.telegram_service import send_message
from app.settings_service import ensure_defaults, get_bool, get_int
from app.sources import get_vacancy_source

logger = logging.getLogger(__name__)


def _post_alert_webhook(message: str) -> None:
    """POST a short JSON payload to `ALERT_WEBHOOK_URL` if configured."""

    url = (get_settings().alert_webhook_url or "").strip()
    if not url:
        return
    try:
        with httpx.Client(timeout=15.0) as client:
            client.post(url, json={"text": message, "source": "findwork-sync"})
    except Exception:
        logger.exception("Alert webhook request failed")


def _vacancy_insert_row(item: dict[str, Any], *, fetch_detail: bool, vacancy_source: str) -> dict[str, Any]:
    """Build insert dict; optionally enrich from vacancy card."""

    base = map_list_item_to_row(item, raw_payload=dict(item), vacancy_source=vacancy_source)
    if fetch_detail and vacancy_source == "hh":
        try:
            detail = hh_client.fetch_vacancy_detail(str(item["id"]))
            base = enrich_from_detail(base, detail)
        except Exception:
            logger.exception("Failed to fetch vacancy detail for %s", item.get("id"))
    base["is_analyzed"] = False
    base["is_favorite"] = False
    base["match_score"] = None
    base["ai_analysis"] = None
    base["cover_letter_text"] = None
    base["status"] = VacancyStatus.new
    base["id"] = uuid.uuid4()
    return base


def sync_one_search(db: Session, search: SavedSearch, *, max_pages: int, per_page: int, fetch_detail: bool) -> dict[str, Any]:
    """Run hh fetch for one saved search; insert new vacancies only."""

    inserted = 0
    skipped = 0
    fetched_total = 0
    t0 = time.perf_counter()
    src = get_vacancy_source(search.vacancy_source)
    try:
        for page in range(max_pages):
            data = src.fetch_search_page(search, page=page, per_page=per_page)
            items = data.get("items") or []
            if not items:
                break
            fetched_total += len(items)
            for item in items:
                row = _vacancy_insert_row(item, fetch_detail=fetch_detail, vacancy_source=src.id)
                stmt = pg_insert(Vacancy).values(**row).on_conflict_do_nothing(constraint="uq_vacancy_source_external")
                res = db.execute(stmt)
                if res.rowcount:
                    inserted += 1
                else:
                    skipped += 1
            pages = data.get("pages") or 1
            if page + 1 >= pages:
                break
        search.last_run_at = datetime.now(timezone.utc)
        search.last_error = None
        # Keep per-search counter aligned with the latest run size (not cumulative across reruns).
        search.vacancies_found = fetched_total
        db.add(search)
        db.commit()
    except Exception as e:
        logger.exception("Sync failed for search %s", search.id)
        search.last_error = str(e)
        search.last_run_at = datetime.now(timezone.utc)
        db.add(search)
        db.commit()
        return {
            "inserted": inserted,
            "skipped_duplicates": skipped,
            "fetched_total": fetched_total,
            "error": str(e),
            "duration_ms": int((time.perf_counter() - t0) * 1000),
        }

    return {
        "inserted": inserted,
        "skipped_duplicates": skipped,
        "fetched_total": fetched_total,
        "error": None,
        "duration_ms": int((time.perf_counter() - t0) * 1000),
    }


def delete_expired_vacancies(db: Session, max_age_days: int) -> int:
    """Remove vacancies older than `max_age_days` by `published_at` (when set)."""

    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    q = delete(Vacancy).where(Vacancy.published_at.is_not(None), Vacancy.published_at < cutoff)
    result = db.execute(q)
    db.commit()
    return result.rowcount or 0


def run_full_sync(db: Session, *, trigger: SyncTrigger) -> SyncRun:
    """Execute sync for all active saved searches and TTL cleanup."""

    s = get_settings()
    ensure_defaults(db)

    fallback_max = get_int(db, "max_vacancies_per_search", 200)
    max_age = get_int(db, "vacancy_max_age_days", s.default_vacancy_max_age_days)
    fetch_detail = s.hh_fetch_detail

    run = SyncRun(
        id=uuid.uuid4(),
        started_at=datetime.now(timezone.utc),
        trigger=trigger,
        finished_at=None,
        error=None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run_id = str(run.id)
    set_active(db, process_type="sync", run_id=run_id, phase="start", message="Синхронизация запущена", progress=1)
    emit_event(
        db,
        process_type="sync",
        run_id=run_id,
        phase="start",
        status="running",
        message="Запущен парсинг вакансий",
        progress=1,
        counters={"inserted": 0, "skipped": 0, "errors": 0},
    )

    try:
        removed = delete_expired_vacancies(db, max_age)
        logger.info("TTL cleanup removed %s vacancies (older than %s days)", removed, max_age)

        searches = db.query(SavedSearch).filter(SavedSearch.is_active.is_(True)).all()
        sync_errors: list[str] = []
        inserted_total = 0
        skipped_total = 0
        tg_progress_on = get_bool(db, "telegram_enabled", False)
        if tg_progress_on:
            send_message(f"Парсинг вакансий запущен. Поисковых запросов: {len(searches)}")
        for idx, search in enumerate(searches, start=1):
            max_per_search = int(search.max_vacancies or fallback_max)
            per_page = min(100, max_per_search)
            max_pages = max(1, (max_per_search + per_page - 1) // per_page)
            stats = sync_one_search(db, search, max_pages=max_pages, per_page=per_page, fetch_detail=fetch_detail)
            err = stats.get("error")
            if err:
                sync_errors.append(f"{search.keyword!r}: {err}")
            inserted_total += int(stats["inserted"])
            skipped_total += int(stats["skipped_duplicates"])
            progress = int((idx / max(1, len(searches))) * 100)
            counters = {
                "inserted": inserted_total,
                "skipped": skipped_total,
                "errors": len(sync_errors),
                "processedSearches": idx,
                "totalSearches": len(searches),
            }
            set_active(
                db,
                process_type="sync",
                run_id=run_id,
                phase="search_sync",
                message=f"Обработан запрос: {search.keyword}",
                progress=progress,
                counters=counters,
            )
            emit_event(
                db,
                process_type="sync",
                run_id=run_id,
                phase="search_sync",
                status="running",
                message=f"{search.keyword}: +{stats['inserted']} новых, {stats['skipped_duplicates']} дубликатов",
                progress=progress,
                counters=counters,
                details={"searchId": str(search.id), "searchKeyword": search.keyword, "error": err},
            )
            if tg_progress_on:
                send_message(
                    f"Парсинг прогресс: {idx}/{len(searches)}\n"
                    f"{search.keyword}\n"
                    f"Новых: {stats['inserted']}, дубликатов: {stats['skipped_duplicates']}"
                )
            item = SyncRunItem(
                id=uuid.uuid4(),
                sync_run_id=run.id,
                search_id=search.id,
                inserted=stats["inserted"],
                skipped_duplicates=stats["skipped_duplicates"],
                duration_ms=stats["duration_ms"],
                error=stats.get("error"),
            )
            db.add(item)
        db.commit()

        run.finished_at = datetime.now(timezone.utc)
        db.add(run)
        db.commit()
        final_message = (
            f"Парсинг завершен: новых {inserted_total}, дубликатов {skipped_total}, ошибок {len(sync_errors)}"
        )
        set_active(
            db,
            process_type="sync",
            run_id=run_id,
            phase="completed",
            message=final_message,
            progress=100,
            counters={
                "inserted": inserted_total,
                "skipped": skipped_total,
                "errors": len(sync_errors),
                "processedSearches": len(searches),
                "totalSearches": len(searches),
            },
        )
        emit_event(
            db,
            process_type="sync",
            run_id=run_id,
            phase="completed",
            status="completed",
            message=final_message,
            progress=100,
            counters={
                "inserted": inserted_total,
                "skipped": skipped_total,
                "errors": len(sync_errors),
                "processedSearches": len(searches),
                "totalSearches": len(searches),
            },
        )
        if tg_progress_on:
            send_message(final_message)
        clear_active(db)
        if sync_errors:
            _post_alert_webhook("Vacancy sync completed with errors:\n" + "\n".join(sync_errors[:8]))
    except Exception as e:
        logger.exception("Full sync failed")
        run.finished_at = datetime.now(timezone.utc)
        run.error = str(e)
        db.add(run)
        db.commit()
        emit_event(
            db,
            process_type="sync",
            run_id=run_id,
            phase="failed",
            status="failed",
            message=f"Парсинг завершился ошибкой: {e}",
            progress=100,
            details={"error": str(e)},
        )
        clear_active(db)
        _post_alert_webhook(f"Full vacancy sync failed: {e}")

    return run


def run_ttl_only(db: Session) -> int:
    """Run TTL cleanup using settings."""

    ensure_defaults(db)
    s = get_settings()
    max_age = get_int(db, "vacancy_max_age_days", s.default_vacancy_max_age_days)
    return delete_expired_vacancies(db, max_age)
