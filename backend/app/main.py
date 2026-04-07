"""FastAPI entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import health, me, rest, vacancies
from app.services.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown hooks."""

    _ = app
    start_scheduler()
    yield
    shutdown_scheduler()


def create_app() -> FastAPI:
    """Application factory."""

    settings = get_settings()
    app = FastAPI(
        title="Job Hunt Dashboard API",
        lifespan=lifespan,
        redirect_slashes=False,
    )

    origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
    if not origins:
        origins = [settings.public_url]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    for api_prefix in ("/api/v1", "/api"):
        app.include_router(me.router, prefix=api_prefix)
        app.include_router(vacancies.router, prefix=api_prefix)
        app.include_router(rest.router, prefix=api_prefix)

    return app


app = create_app()
