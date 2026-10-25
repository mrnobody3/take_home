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
  * Calculation of discrete 600-second window ranges (`fromT`, `toT`).
  * Integration with TanStack Query v5 (`useQuery`) with infinite stale time.
  * Bidirectional prefetching (`chunkIndex + 1` and `chunkIndex - 1`) and binary search point lookup.
* **FastAPI Endpoints & RBAC Enforcement (`backend/api.py`, `backend/auth.py`):**
  * JWT issuance, password hashing with bcrypt, role-based checks for `DISPATCHER` vs `PLATFORM_STAFF`.
  * Windowed telemetry endpoint (`GET /trips/{id}/telemetry?from_t=...&to_t=...&step=...`) with `MAX_POINTS_PER_WINDOW` protection.

### What Was Hand-Authored, Refined, or Heavily Edited:
* **Dependency Debugging & Lockfile Reconciliation:**
  * Fixed an npm resolution failure when AI suggested non-existent `uplot-react@^1.3.2`. Manually verified registry versions, pinned `1.2.4` and `uplot@^1.6.32`, and ensured clean `npm ci` build inside Docker.
* **Component Styling, UI Polish & Replay UX (`TripReplayView.tsx`, `VehicleList.tsx`):**
  * Tailored dashboard layout, scrub bar feedback, playback speed controls (1×, 2×, 5×, 10×, 60×), dynamic Leaflet vehicle markers, and map auto-centering logic.
  * Adjusted uPlot canvas options (dark theme colors, responsive dimensions, crisp series lines).
* **HTTP Status Code Consistency (403 vs 404):**
  * Ensured carrier mismatch returns explicit HTTP 403 (Forbidden) rather than masking resources as 404 or returning empty arrays, aligning with the project requirements.
* **Comprehensive Integration Tests (`backend/test_api.py`):**
  * Verified multi-tenant authorization boundaries, token expiration, non-existent entity responses, and window boundary validation (`to_t < from_t`).

---

## 2. Prompts & Approaches That Worked Well

1. **Strict Context Injection from Project Rules:**
   * Feeding [RULES.md](.aiassistant/rules/RULES.md) into the prompt context at the start prevented common AI hallucinations (such as writing redundant sign-up flows, using Redux, or introducing `any` in TypeScript).
2. **Explicit Algorithm Framing for Windowing:**
   * Prompting for *"deterministic chunking based on absolute time intervals (e.g. 600s) + adjacent chunk prefetching with TanStack Query"* generated a rock-solid, production-grade custom hook without memory leaks or race conditions.
3. **Database Performance Directives:**
   * Instructing AI to *"use raw asyncpg copy_records_to_table with temporary index drop rather than ORM session inserts"* yielded a seed script that finished in under 5 seconds instead of 4 minutes.
4. **FastAPI Dependencies for RBAC:**
   * Specifying *"enforce carrier check in FastAPI route dependencies and raise 403 on cross-tenant requests"* resulted in clean, DRY code without repetitive `if-else` boilerplate across endpoints.

---

## 3. Where AI Failed or Required Correction

1. **NPM Package Version Hallucination:**
   * When instructed to include `uplot-react` in `package.json`, AI hallucinated version `^1.3.2`. The latest version on npm was `1.2.4`, which broke `npm install` inside Docker.
   * *Resolution:* Queried the npm registry, updated `package.json` to valid versions (`1.2.4` and `uplot@^1.6.32`), and generated a locked `package-lock.json`.
2. **CDN vs Local NPM Imports:**
   * Initially, AI placed external unpkg CDN links in `index.html` for Leaflet and uPlot CSS, violating the principle of self-contained local deployment.
   * *Resolution:* Replaced CDN links with direct npm package CSS imports in `src/main.tsx` (`leaflet/dist/leaflet.css`, `uplot/dist/uPlot.min.css`).
3. **Overly Eager SQLAlchemy Lazy Loading:**
   * Standard ORM relationship definitions default to lazy loading, which fails in asynchronous SQLAlchemy sessions.
   * *Resolution:* Explicitly configured `lazy="raise"` on all model relationships and wrote explicit queries with joins to prevent accidental runtime errors.
4. **TypeScript Strictness Guardrails:**
   * AI occasionally defaulted to loose typing for API error handlers and Leaflet event objects.
   * *Resolution:* Enforced strict TypeScript compiler flags (`noImplicitAny: true`, `strict: true`) and created dedicated type definitions in `api.ts` to satisfy the "zero `any`" constraint.

---

## 4. Overall Assessment

AI acted as an ultra-fast copilot for boilerplate, schema definition, and mathematical scaffolding (binary search, chunk boundaries). Human oversight was crucial for validating library versions, enforcing strict security boundaries (RBAC 403 vs 404), fine-tuning UI responsiveness during scrubbing, and maintaining architectural simplicity.
