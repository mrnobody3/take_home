# Waypoint — Fleet Telemetry Platform

Waypoint is a high-performance fleet telemetry replay portal for dispatchers and support staff. It allows users to scrub and zoom second-by-second vehicle telemetry (GPS route, speed over time, and fuel percentage) across 24-hour trips (~86,400 data points per trip) with instantaneous, bidirectional timeline navigation and strict multi-tenant access control.

---

## Quick Start (Clean clone to running app in < 5 minutes)

### Prerequisites
* Docker & Docker Compose v2+
* Node.js 20+ (for local linting/testing)
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

## Unified Quality Checks (One Single Command)

As required by the assignment brief, all formatting, linting, type checking, and test suites across both frontend and backend pass cleanly and can be executed via a **single root command**:

```bash
# Unified check command (backend ruff + mypy + pytest & frontend tsc + eslint + prettier + vitest):
npm run check
# or alternatively:
./check.sh
# or:
make check
```

### Individual Check Commands

#### 1. Backend (Ruff, Mypy & Pytest)
```bash
# Static type checking:
docker compose exec backend mypy .

# Linting & code formatting verification:
docker compose exec backend ruff check .
docker compose exec backend ruff format --check .

# Run backend test suite (RBAC isolation, token expiration & telemetry range tests):
docker compose exec backend pytest -v
```

#### 2. Frontend (TypeScript, ESLint, Prettier & Vitest)
```bash
cd frontend

# Run frontend check (typecheck + lint + prettier check + tests):
npm run check

# Run frontend test suite:
npm test

# Auto-format all frontend files:
npm run format
```

---

## Cloud Deployment (Render.com)

The repository is configured to deploy to [Render.com](https://render.com) without requiring any paid add-ons or Shell access.

### Automatic Blueprint Deployment
1. In the [Render Dashboard](https://dashboard.render.com), click **Blueprints** in the left sidebar (or **New** → **Blueprint**).
2. Connect your repository. Render automatically reads [`render.yaml`](render.yaml) and provisions:
   - **`waypoint-db`**: Managed PostgreSQL 16 database.
   - **`waypoint-backend`**: Python FastAPI web service with automatic database linking and secret generation.
   - **`waypoint-frontend`**: React Vite static site with SPA routing.
3. **Automatic Seeding:** The backend start command includes `python backend/seed.py --if-empty`. On the first boot, it detects that the database is unpopulated and streams all **691,200 rows** in ~5 seconds automatically. On subsequent boots, it skips immediately.

### Manual Reseeding (Free — No Paid Shell Tab Needed)
If you ever want to reset and reseed the Render database from your local machine:
1. In the Render Dashboard, open **`waypoint-db`** and copy the **External Database URL** (includes `?sslmode=require`).
2. Run from your local terminal:
   ```bash
   DATABASE_URL="<external-database-url>" python backend/seed.py
   ```

---

## Architectural Highlights

For detailed rationale and tradeoffs, refer to [DECISIONS.md](DECISIONS.md).

1. **Deterministic Time-Window Chunking & Bidirectional Zoom:**
   * A full 24-hour trip contains 86,400 data points. Delivering this in a single payload is prohibited by design.
   * Telemetry is requested in discrete windows on demand with **bidirectional zoom** (**1m, 5m, 10m, 30m, 1h**).
   * The custom hook [`useTripReplay`](frontend/src/hooks/useTripReplay.ts) manages bidirectional prefetching (`chunkIndex ± 1`), leveraging TanStack Query v5 with `staleTime: Infinity` and `placeholderData` to ensure smooth 60 FPS scrubbing without loading spinners or layout shifts.
   * Rapid scrubbing inputs are debounced by 120ms to prevent server query floods, while the playhead needle and telemetry gauges update in real time.
2. **PostgreSQL 16 Composite B-Tree Index & REAL Storage:**
   * Table `telemetry_samples` features a composite B-Tree index on `(trip_id, t)`.
   * Coordinates use `DOUBLE PRECISION` (8 bytes) for GPS accuracy, while metrics (`speed_kph`, `fuel_pct`) use `REAL` (4 bytes).
   * Window queries run as sub-millisecond index-only range scans ordered by `t ASC`.
3. **Server-Enforced Multi-Tenancy (RBAC):**
   * Permissions are enforced directly on the server (`backend/api.py`).
   * `DISPATCHER` access is strictly scoped to their assigned `carrier_id`.
   * Any cross-tenant attempt returns explicit **HTTP 403 (Forbidden)**, never masking data or failing open.
   * On HTTP 401, the frontend intercepts the response, flushes the TanStack Query cache (`queryClient.clear()`), and resets auth state.
4. **Hardware-Accelerated Canvas Rendering:**
   * Uses **uPlot** (HTML5 2D Canvas) for speed and fuel telemetry timelines, rendering thousands of points in under 2ms.
   * Interactive Leaflet map dynamically binds to the active telemetry point and window path.

---

## Project Structure

```text
.
├── docker-compose.yml          # Single-command local environment (db, backend, frontend)
├── render.yaml                 # Render.com Blueprint configuration (DB, API, Frontend)
├── check.sh                    # Unified one-command quality & test runner
├── Makefile                    # Make targets for check, test, lint, typecheck, format
├── package.json                # Root package for running 'npm run check'
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
│   ├── models.py               # SQLAlchemy 2.0 async models with PostgreSQL REAL/DOUBLE_PRECISION
│   ├── database.py             # Async database session & engine management
│   ├── seed.py                 # 691k row high-throughput binary seed script with --if-empty
│   ├── test_api.py             # RBAC, token expiration & windowing integration test suite
│   ├── ruff.toml               # Ruff linter and formatter configuration
│   ├── mypy.ini                # Python static type checker configuration
│   ├── requirements.txt        # Pinned Python dependencies
│   └── Dockerfile              # Python 3.12-slim runtime
└── frontend/
    ├── src/
    │   ├── api.ts              # Strict TypeScript client & typed API models (zero any)
    │   ├── api.test.ts         # Tests for token handling, error parsing, 401 dispatch
    │   ├── hooks/
    │   │   ├── useTripReplay.ts# Window calculation, zoom, prefetching & scrubbing loop
    │   │   └── useTripReplay.test.tsx # Tests for boundary clamping, zoom levels, seeking
    │   ├── components/
    │   │   ├── LoginForm.tsx   # Sign-In UI with demo credential auto-fill
    │   │   ├── VehicleList.tsx # Multi-tenant vehicle & trip listing with error UI
    │   │   └── TripReplayView.tsx # Scrubbable uPlot timeline with zoom + Leaflet map view
    │   ├── utils/
    │   │   ├── formatters.ts   # Centralized date, time, speed, fuel formatters
    │   │   └── formatters.test.ts # Unit tests for formatting logic
    │   ├── App.tsx             # Main view router, 401 interception & query cache purge
    │   └── main.tsx            # React 18 & TanStack Query setup
    ├── .prettierrc             # Prettier configuration
    ├── package.json            # Vite 5, React, TanStack Query, Vitest, uPlot, Leaflet
    └── tsconfig.json           # Strict TypeScript configuration
```

---

## Teardown

To stop and remove containers and database volumes:
```bash
docker compose down -v
```
