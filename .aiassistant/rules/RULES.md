---
apply: always
---

# Project: Waypoint Fleet Telemetry MVP
# Context: 6-hour take-home assignment. Prioritize working vertical slices over over-engineering.

## Tech Stack
- **Backend:** Python 3.12, FastAPI, asyncpg, SQLAlchemy 2.0 (async), Pydantic v2.
- **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS, TanStack Query v5.
- **Database:** PostgreSQL 16.

## Strict Constraints (DO NOT VIOLATE)
1. **TypeScript Typing:** ZERO use of `any` types. All API responses, state, and component props MUST have strict interfaces.
2. **Auth Scope:** Implement ONLY Sign-In (email/password returning JWT/session). DO NOT implement Sign-Up, Password Reset, or email verification. Do not add redundant user management screens.
3. **Multi-tenancy (RBAC):** Permissions MUST be enforced on the backend. `DISPATCHER` role can only access entities belonging to their `carrier_id`. `PLATFORM_STAFF` accesses all. Return HTTP 403 (Forbidden) on carrier mismatch. Do not just hide data on the frontend.
4. **Data Windowing (Crucial):** NEVER return a full trip's telemetry (86,400 points) in a single request. The frontend must fetch data in time-based chunks (e.g., 600-second windows: `?from_t=0&to_t=600`).
5. **Database Performance:** The `telemetry_samples` table MUST include a composite B-Tree index on `(trip_id, t)` for fast scrubbing queries.
6. **Infrastructure:** The entire application must run locally via a single `docker-compose.yml` file. No manual database initialization steps — use an init script or seed command.
7. **Simplicity:** Do not add complex state management like Redux if Zustand or React Context + TanStack Query is sufficient. Do not add an ORM overhead if raw async queries are faster for the seed script.