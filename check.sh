#!/usr/bin/env bash
set -e

echo "=== Running Backend Quality Checks ==="
if command -v docker &> /dev/null && docker compose ps --services --filter "status=running" | grep -q "backend"; then
    echo "Using running Docker backend container..."
    docker compose exec -T backend ruff check .
    docker compose exec -T backend ruff format --check .
    docker compose exec -T backend mypy .
    docker compose exec -T backend pytest -v
elif [ -d ".venv" ]; then
    echo "Using local .venv..."
    .venv/bin/ruff check backend
    .venv/bin/ruff format --check backend
    .venv/bin/mypy backend
    SECRET_KEY="${SECRET_KEY:-dev_waypoint_secret_key_super_secure_for_jwt_2026}" \
    DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://waypoint:waypoint_dev_password@localhost:5432/waypoint}" \
    .venv/bin/pytest -v backend
else
    echo "Running via docker compose run..."
    docker compose run --rm backend ruff check .
    docker compose run --rm backend ruff format --check .
    docker compose run --rm backend mypy .
    docker compose run --rm backend pytest -v
fi

echo ""
echo "=== Running Frontend Quality Checks ==="
cd frontend
npm run check
cd ..

echo ""
echo "=== All Quality Checks Passed Cleanly! ==="
