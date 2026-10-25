"""Application settings, read from environment variables (see docker-compose.yml)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "postgresql+asyncpg://waypoint:waypoint_dev_password@localhost:5432/waypoint"
    )
    # No default on purpose: a missing secret must fail loudly, not sign tokens with a known key.
    secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    # One dispatcher shift; no refresh tokens in this MVP.
    access_token_ttl_minutes: int = Field(default=8 * 60, gt=0)
    # Comma-separated, e.g. "http://localhost:5173,http://127.0.0.1:5173".
    cors_origins: str = "http://localhost:5173"

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg_driver(cls, value: str) -> str:
        """Accept plain postgres:// / postgresql:// URLs and force the asyncpg driver."""
        scheme, sep, rest = value.partition("://")
        if not sep:
            raise ValueError("DATABASE_URL must be a URL")
        if scheme in {"postgres", "postgresql"}:
            return f"postgresql+asyncpg://{rest}"
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
