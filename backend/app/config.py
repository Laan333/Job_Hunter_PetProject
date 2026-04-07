"""Application settings loaded from environment."""

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://findwork:findwork@localhost:5432/findwork",
        alias="DATABASE_URL",
    )
    admin_api_keys: str = Field(default="", alias="ADMIN_API_KEYS")
    cors_allowed_origins: str = Field(default="http://localhost:8080", alias="CORS_ALLOWED_ORIGINS")
    public_url: str = Field(default="http://localhost:8080", alias="PUBLIC_URL")

    hh_user_agent: str = Field(
        default="find-work-dashboard/1.0 (contact: admin@localhost)",
        alias="HH_USER_AGENT",
    )
    hh_base_url: str = Field(default="https://api.hh.ru", alias="HH_BASE_URL")
    hh_fetch_detail: bool = Field(default=False, alias="HH_FETCH_VACANCY_DETAIL")

    llm_provider: Literal["openai", "gigachat", "none"] = Field(default="openai", alias="LLM_PROVIDER")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-3.5-turbo", alias="OPENAI_MODEL")
    gigachat_authorization_key: str = Field(
        default="",
        validation_alias=AliasChoices("GIGACHAT_AUTHORIZATION_KEY", "GIGACHAT_AUTH_KEY"),
        description="Ключ авторизации из кабинета GigaChat (вставляется в заголовок Authorization: Basic … при OAuth).",
    )
    gigachat_oauth_url: str = Field(default="", alias="GIGACHAT_OAUTH_URL")
    gigachat_api_base: str = Field(default="", alias="GIGACHAT_API_BASE")
    gigachat_model: str = Field(default="GigaChat-2", alias="GIGACHAT_MODEL")
    gigachat_scope: str = Field(default="GIGACHAT_API_PERS", alias="GIGACHAT_SCOPE")
    gigachat_verify_ssl: bool = Field(default=False, alias="GIGACHAT_VERIFY_SSL")

    alert_webhook_url: str = Field(default="", alias="ALERT_WEBHOOK_URL")

    telegram_bot_token: str = Field(default="", alias="TELEGRAM_BOT_TOKEN")
    telegram_chat_id: str = Field(default="", alias="TELEGRAM_CHAT_ID")

    default_hh_sync_time: str = Field(default="10:00", alias="DEFAULT_HH_SYNC_TIME")
    default_hh_sync_timezone: str = Field(default="Europe/Moscow", alias="DEFAULT_HH_SYNC_TIMEZONE")
    default_vacancy_max_age_days: int = Field(default=14, alias="DEFAULT_VACANCY_MAX_AGE_DAYS")
    default_match_interval_minutes: int = Field(default=60, alias="DEFAULT_MATCH_INTERVAL_MINUTES")
    default_llm_min_interval_seconds: int = Field(
        default=180,
        alias="DEFAULT_LLM_MIN_INTERVAL_SECONDS",
        description="Min seconds between LLM calls (e.g. 180 ≈ one analysis every 3 minutes).",
    )
    default_high_match_threshold: int = Field(default=85, alias="DEFAULT_HIGH_MATCH_THRESHOLD")


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""

    return Settings()


def parse_api_keys(raw: str) -> set[str]:
    """Split comma-separated API keys into a stripped non-empty set."""

    return {k.strip() for k in raw.split(",") if k.strip()}
