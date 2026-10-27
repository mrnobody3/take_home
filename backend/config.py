"""Application settings, read from environment variables (see docker-compose.yml)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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
    # Comma-separated (e.g. "http://localhost:5173,http://127.0.0.1:5173") or JSON array.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173"]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: Any) -> list[str]:
        """Parse comma-separated or JSON list of origins, normalizing trailing slashes & schemes."""
        raw_items: list[str] = []
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("[") and value.endswith("]"):
                try:
                    parsed = json.loads(value)
                    if isinstance(parsed, list):
                        raw_items = [str(item) for item in parsed]
                except Exception:
                    pass
            if not raw_items:
                raw_items = value.split(",")
        elif isinstance(value, (list, tuple, set)):
            raw_items = [str(item) for item in value]
        else:
            return value

        normalized: list[str] = []
        for raw in raw_items:
            clean = raw.strip().rstrip("/")
            if not clean:
                continue
            if clean == "*":
                if clean not in normalized:
                    normalized.append(clean)
                continue
            if clean.startswith(("http://", "https://")):
                if clean not in normalized:
                    normalized.append(clean)
            else:
                for scheme in ("https://", "http://"):
                    full = f"{scheme}{clean}"
                    if full not in normalized:
                        normalized.append(full)

        return normalized

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
        return self.cors_origins


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # values come from the environment
