"""Unit tests for Settings configuration and CORS origins parsing."""

import os
import tempfile

import pytest

from config import Settings


def test_cors_origins_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "http://localhost:5173, http://localhost:3000, http://127.0.0.1:5173 ",
    )
    s = Settings(secret_key="x" * 32)
    assert s.cors_origins == [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]
    assert s.cors_origin_list == [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]


def test_cors_origins_normalization(monkeypatch: pytest.MonkeyPatch) -> None:
    """Origins with trailing slashes, missing schemes, or duplicates are normalized."""
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://waypoint-frontend.onrender.com,http://localhost:5173,"
        "https://waypoint-frontend-gvrq.onrender.com/,https://waypoint-frontend-gvrq.onrender.com,"
        "waypoint-frontend-gvrq.onrender.com/,waypoint-frontend-gvrq.onrender.com",
    )
    s = Settings(secret_key="x" * 32)
    assert "https://waypoint-frontend-gvrq.onrender.com" in s.cors_origins
    assert "https://waypoint-frontend.onrender.com" in s.cors_origins
    assert "http://localhost:5173" in s.cors_origins
    # Ensure no trailing slashes remain
    assert all(not origin.endswith("/") for origin in s.cors_origins)
    # Ensure all entries have valid scheme
    assert all(origin.startswith(("http://", "https://")) for origin in s.cors_origins)


def test_cors_origins_json_list_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", '["https://waypoint.app", "https://admin.waypoint.app"]')
    s = Settings(secret_key="x" * 32)
    assert s.cors_origins == ["https://waypoint.app", "https://admin.waypoint.app"]


def test_cors_origins_wildcard_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "*")
    s = Settings(secret_key="x" * 32)
    assert s.cors_origins == ["*"]


def test_cors_origins_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    s = Settings(secret_key="x" * 32)
    assert s.cors_origins == ["http://localhost:5173"]


def test_cors_origins_direct_list() -> None:
    s = Settings(secret_key="x" * 32, cors_origins=["http://a.com/", "http://b.com"])
    assert s.cors_origins == ["http://a.com", "http://b.com"]


def test_cors_origins_from_env_file() -> None:
    with tempfile.NamedTemporaryFile("w", delete=False) as f:
        f.write("CORS_ORIGINS=http://env1.example.com,http://env2.example.com\n")
        env_file_path = f.name

    try:

        class FileSettings(Settings):
            model_config = {"env_file": env_file_path, "extra": "ignore"}

        s = FileSettings(secret_key="x" * 32)
        assert s.cors_origins == ["http://env1.example.com", "http://env2.example.com"]
    finally:
        if os.path.exists(env_file_path):
            os.remove(env_file_path)
