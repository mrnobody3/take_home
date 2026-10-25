# Waypoint — Fleet Telemetry Platform

Waypoint is a high-performance fleet telemetry replay portal for dispatchers and support staff. It allows users to scrub second-by-second vehicle telemetry (GPS route, speed over time, and fuel percentage) across 24-hour trips (~86,400 data points per trip) with instantaneous, bidirectional timeline navigation and strict multi-tenant access control.

---

## Quick Start (Clean clone to running app in < 5 minutes)

### Prerequisites
* Docker & Docker Compose v2+
* Node.js 20+ (for local linting/typechecking)
* Ports `5173`, `8000`, and `5432` free

### 1. Start the Stack
From the project root directory, launch database, backend, and frontend containers:
```bash
docker compose up -d --build
```
> The backend automatically waits for PostgreSQL 16 to report healthy (`pg_isready`) before starting.

### 2. Seed the Database
Run the high-speed bulk seed script:
```bash
docker compose exec backend python seed.py
```
This resets the schema, generates 8 vehicles across 2 carriers with 24-hour trips, and bulk-streams **691,200 telemetry samples** in ~5 seconds using async binary COPY.

### 3. Open the Application
Navigate to:
* **Frontend Portal:** [http://localhost:5173](http://localhost:5173)
* **Backend API Documentation:** [http://localhost:8000/docs](http://localhost:8000/docs)
* **Health Check:** [http://localhost:8000/health](http://localhost:8000/health)

---

## Demo Credentials

All seeded accounts use password `waypoint-demo`:

| Role | Email | Password | Tenant / Scope |
|---|---|---|---|
| **DISPATCHER** | `dispatcher@northwind.nl` | `waypoint-demo` | **Northwind Logistics** (4 vehicles) |
| **DISPATCHER** | `dispatcher@polderexpress.nl` | `waypoint-demo` | **Polder Express** (4 vehicles) |
| **PLATFORM_STAFF** | `support@waypoint.io` | `waypoint-demo` | **All carriers** (8 vehicles) |

---

## Code Quality, Formatting, Type Checking & Tests

Both frontend and backend are configured with automated formatters, strict type checkers, and test suites that pass cleanly.

### 1. Frontend (TypeScript, ESLint & Prettier)
Enforces strict TypeScript (`noImplicitAny: true`, **zero `any` types**), ESLint, and Prettier code style:
```bash
cd frontend
npm install

# Run frontend check (typecheck + lint + prettier verification):
npm run check

# Auto-format all frontend files:
npm run format
```

### 2. Backend (Ruff & Pytest)
Configured with **Ruff** (modern, ultra-fast Python linter & formatter) and **Pytest**:
```bash
# Check linting and code formatting:
docker compose exec backend ruff check .
docker compose exec backend ruff format --check .

# Auto-format backend code:
docker compose exec backend ruff format .

# Run end-to-end integration test suite:
docker compose exec backend pytest -v
```
*(Tests cover RBAC tenant isolation with HTTP 403 enforcement, windowed range queries, and authentication)*

---

## Architectural Highlights

For detailed rationale and tradeoffs, refer to [DECISIONS.md](DECISIONS.md).

1. **Deterministic Time-Window Chunking:**
   * A full 24-hour trip contains 86,400 data points. Delivering this in a single payload is prohibited by design.
   * Telemetry is requested in discrete **600-second (10-minute) windows** (`from_t`..`to_t`).
   * The custom hook [`useTripReplay`](frontend/src/hooks/useTripReplay.ts) manages bidirectional prefetching (`chunkIndex ± 1`), leveraging TanStack Query v5 with `staleTime: Infinity` to ensure smooth 60 FPS scrubbing without loading spinners.
2. **PostgreSQL 16 Composite B-Tree Index:**
   * Table `telemetry_samples` features a composite B-Tree index on `(trip_id, t)`.
   * Window queries run as sub-millisecond index-only range scans ordered by `t ASC`.
3. **Server-Enforced Multi-Tenancy (RBAC):**
   * Permissions are enforced directly on the server (`backend/api.py`).
   * `DISPATCHER` access is strictly scoped to their assigned `carrier_id`.
   * Any cross-tenant attempt returns explicit **HTTP 403 (Forbidden)**, never masking data or failing open.
4. **Hardware-Accelerated Canvas Rendering:**
   * Uses **uPlot** (HTML5 2D Canvas) for speed and fuel telemetry timelines, rendering thousands of points in under 2ms.
   * Interactive Leaflet map dynamically binds to the active telemetry point and window path.

---

## Project Structure

```text
.
├── docker-compose.yml          # Single-command local environment (db, backend, frontend)
├── DECISIONS.md                # Architectural decisions, tradeoffs & benchmark rationale
├── AI-NOTES.md                 # AI collaboration disclosure & prompt details
├── RULES.md                    # Core project constraints & strict requirements
├── ASSIGNMENT.md               # Original assignment brief & evaluation criteria
├── fixtures/
│   └── fleet-sample.json       # 900-sample (15 min) closed-loop delivery fixture
├── backend/
│   ├── main.py                 # FastAPI application entrypoint & middleware
│   ├── api.py                  # Fleet endpoints, RBAC dependencies & windowing logic
│   ├── auth.py                 # JWT issuance, password verification & user resolution
│   ├── models.py               # SQLAlchemy 2.0 async models with naming conventions
│   ├── database.py             # Async database session & engine management
│   ├── seed.py                 # 691k row high-throughput binary seed script
│   ├── test_api.py             # RBAC & windowing integration test suite
│   ├── ruff.toml               # Ruff linter and formatter configuration
│   ├── requirements.txt        # Pinned Python dependencies
│   └── Dockerfile              # Python 3.12-slim runtime
└── frontend/
    ├── src/
    │   ├── api.ts              # Strict TypeScript client & typed API models (zero any)
    │   ├── hooks/
    │   │   └── useTripReplay.ts# Window calculation, prefetching & scrubbing loop
    │   ├── components/
    │   │   ├── LoginForm.tsx   # Sign-In UI with demo credential auto-fill
    │   │   ├── VehicleList.tsx # Multi-tenant vehicle & trip listing
    │   │   └── TripReplayView.tsx # Scrubbable uPlot timeline + Leaflet map view
    │   ├── utils/
    │   │   └── formatters.ts   # Centralized date, time, speed, fuel formatters
    │   ├── App.tsx             # Main view router & auth context
    │   └── main.tsx            # React 18 & TanStack Query setup
    ├── .prettierrc             # Prettier configuration
    ├── package.json            # Vite, React, TanStack Query, uPlot, Leaflet
    └── tsconfig.json           # Strict TypeScript configuration
```

---

## Teardown

To stop and remove containers and database volumes:
```bash
docker compose down -v
```
