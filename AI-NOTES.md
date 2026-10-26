# AI Collaboration Notes — Waypoint

As required by the assignment brief, this document provides an honest, transparent breakdown of how AI assistance (WebStorm AI / Claude 3.5 Sonnet) was utilized during the development of Waypoint.

---

## 1. Division of Work: What AI Wrote vs. What Was Edited & Hand-Authored

### What AI Generated Directly (with guidance):
* **Docker & Infrastructure Boilerplate:**
  * Initial multi-container `docker-compose.yml` (`db` on Postgres 16, `backend` with Python 3.12, `frontend` with Node 20 / Vite).
  * Healthcheck configuration (`pg_isready`) ensuring backend waits for database readiness.
* **Database Models & Schema Definition (`backend/models.py`):**
  * SQLAlchemy 2.0 async mapped classes (`Carrier`, `User`, `Vehicle`, `Trip`, `TelemetrySample`).
  * Check constraints (e.g. `role_carrier_consistency`) and composite B-Tree index `idx_telemetry_trip_t`.
* **High-Volume Seed Script (`backend/seed.py`):**
  * Tiling 900-sample fixture 96× to generate 86,400 samples (24h) per vehicle.
  * Async streaming pipeline with `asyncpg.copy_records_to_table` and temporary index dropping for fast bulk loading (~691k rows in <5s).
* **Telemetry Windowing & Scrubbing Hook (`frontend/src/hooks/useTripReplay.ts`):**
  * Calculation of discrete window ranges (`fromT`, `toT`).
  * Integration with TanStack Query v5 (`useQuery`) with infinite stale time.
  * Bidirectional prefetching (`chunkIndex + 1` and `chunkIndex - 1`) and binary search point lookup.
* **FastAPI Endpoints & RBAC Enforcement (`backend/api.py`, `backend/auth.py`):**
  * JWT issuance, password hashing with bcrypt, role-based checks for `DISPATCHER` vs `PLATFORM_STAFF`.
  * Windowed telemetry endpoint (`GET /trips/{id}/telemetry?from_t=...&to_t=...&step=...`) with `MAX_POINTS_PER_WINDOW` protection.

### What Was Hand-Authored, Refined, or Heavily Edited:
* **Dependency Debugging & Vite / Plugin-React Lockfile Reconciliation:**
  * Fixed an npm resolution failure when `vite@8.3.3` was specified in `package.json` while `@vitejs/plugin-react@^4.3.3` required Vite <= 7, which caused `npm ci` inside Docker to crash with `ERESOLVE`. Pinned `vite: ^5.4.11` and regenerated `package-lock.json` ensuring clean `npm ci` builds in Docker and local environments.
* **Bidirectional Zoom & Smooth Scrubbing UX:**
  * Implemented bidirectional timeline zoom controls (**1m, 5m, 10m, 30m, 1h**) allowing dispatchers to seamlessly drill down to 1 Hz precision or zoom out for macro shifts.
  * Fixed scrubbing request floods by debouncing window queries (120ms) and configured `placeholderData: (previousData) => previousData` in TanStack Query so the uPlot canvas never flickers or gets replaced by a loading spinner.
  * Fixed the `t = 86400` duration boundary bug: AI initially allowed `chunkIndex` to overflow to chunk 144 (`fromT=86400, toT=86400`) which returned 0 samples since 1 Hz telemetry ends at `t = 86399`. Clamped `chunkIndex` to `totalChunks - 1` (chunk 143: `85800..86400`) and resolved the final second gracefully.
* **Auth Lifecycle & Cache Invalidation:**
  * Implemented automatic sign-out and TanStack Query cache purging (`queryClient.clear()`) when an HTTP 401 response is intercepted via a custom `'auth:unauthorized'` event, preventing multi-tenant data leaks between sessions.
* **Data Fetching Error UI:**
  * Replaced silent failures with explicit error alert banners and "Retry" buttons for both telemetry windows and the 24h summary chart.
* **PostgreSQL Column Types:**
  * Corrected SQLAlchemy columns from generic `Float` (which defaults to 8-byte `DOUBLE PRECISION` on Postgres) to explicit `DOUBLE_PRECISION` for coordinates and `REAL` (4 bytes) for speed and fuel.
* **Comprehensive Integration & Unit Tests:**
  * Extended `backend/test_api.py` with explicit tests for expired JWT tokens, tampered signatures, and malformed auth headers.
  * Added 18 unit and integration tests on the frontend using Vitest and React Testing Library (`formatters.test.ts`, `api.test.ts`, `useTripReplay.test.tsx`).
  * Configured Python static type checking (`mypy`) and unified quality checks into a single root command (`npm run check` / `./check.sh` / `make check`).

---

## 2. Prompts & Approaches That Worked Well

1. **Strict Context Injection from Project Rules:**
   * Feeding project constraints into the prompt context prevented common AI hallucinations (such as writing redundant sign-up flows, using Redux, or introducing `any` in TypeScript).
2. **Explicit Algorithm Framing for Windowing:**
   * Prompting for *\"deterministic chunking based on absolute time intervals + adjacent chunk prefetching with TanStack Query\"* generated a solid mathematical foundation for timeline scrubbing.
3. **Database Performance Directives:**
   * Instructing AI to *\"use raw asyncpg copy_records_to_table with temporary index drop rather than ORM session inserts\"* yielded a seed script that finished in under 5 seconds instead of 4 minutes.
4. **FastAPI Dependencies for RBAC:**
   * Specifying *\"enforce carrier check in FastAPI route dependencies and raise 403 on cross-tenant requests\"* resulted in clean, DRY code without repetitive `if-else` boilerplate across endpoints.

---

## 3. Where AI Failed or Required Correction

1. **NPM Package Version Conflict & Vite 8 Hallucination:**
   * AI specified `vite: 8.3.3` in `package.json`, but `@vitejs/plugin-react@^4.3.3` only supports Vite <= 7, which broke `npm ci` inside Docker.
   * *Resolution:* Pinned `vite: ^5.4.11`, regenerated `package-lock.json`, and tested `npm ci` across Docker and host.
2. **Missing Zoom & Timeline Boundary Edge Case (t=86400):**
   * AI only implemented a fixed 600-second window without zoom controls, and calculated `chunkIndex = Math.floor(currentTime / chunkSize)`, which at `currentTime = 86400` resulted in `fromT=86400, toT=86400` (returning an empty array and blank screen).
   * *Resolution:* Hand-coded bidirectional zoom levels (1m, 5m, 10m, 30m, 1h), clamped `chunkIndex` to `totalChunks - 1`, and clamped sample lookup.
3. **Scrubbing Jank & Replacing Chart with Spinner:**
   * AI triggered telemetry fetch queries on every single slider change without debounce, and swapped the uPlot canvas for a spinner during pending queries.
   * *Resolution:* Debounced fetch triggers during scrubbing (120ms) and used `placeholderData` in TanStack Query to preserve previous samples while fetching new windows.
4. **SQLAlchemy Type Mapping:**
   * AI used generic `Float` instead of PostgreSQL `REAL` for speed and fuel metrics.
   * *Resolution:* Imported explicit `DOUBLE_PRECISION` and `REAL` types from `sqlalchemy.dialects.postgresql`.
5. **Missing Error States & Session Cleanup:**
   * AI omitted query cache invalidation on logout and error banners on data fetch failure.
   * *Resolution:* Added `queryClient.clear()` on sign out, 401 interception, and user-facing retry banners.

---

## 4. Overall Assessment

AI acted as an ultra-fast copilot for boilerplate, schema definition, and initial scaffolding. Human oversight was critical for validating dependency compatibility, handling edge cases at timeline boundaries, ensuring smooth 60 FPS scrubbing without jank, enforcing security boundaries (RBAC 403 vs 404), and verifying that all written documentation matches the actual codebase.
