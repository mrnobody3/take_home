.PHONY: check test format lint typecheck clean

check:
	@./check.sh

test:
	@echo "=== Running Backend Tests ==="
	@if [ -d ".venv" ]; then .venv/bin/pytest -v backend; else docker compose exec -T backend pytest -v; fi
	@echo "=== Running Frontend Tests ==="
	@cd frontend && npm test

lint:
	@if [ -d ".venv" ]; then .venv/bin/ruff check backend; else docker compose exec -T backend ruff check .; fi
	@cd frontend && npm run lint

typecheck:
	@if [ -d ".venv" ]; then .venv/bin/mypy backend; else docker compose exec -T backend mypy .; fi
	@cd frontend && npm run typecheck

format:
	@if [ -d ".venv" ]; then .venv/bin/ruff format backend; else docker compose exec -T backend ruff format .; fi
	@cd frontend && npm run format
