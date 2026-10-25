# Architecture & Engineering Decisions — Waypoint

This document records the architectural tradeoffs, technical choices, and rationale behind Waypoint's implementation, as requested by the assignment brief.

---

### 1. Database Selection: PostgreSQL 16
* **Why Postgres:** Telemetry replay has a very specific read pattern: continuous, ordered 1-D range scans over `(trip_id, t)` (`WHERE trip_id = :id AND t >= :from_t AND t <= :to_t ORDER BY t ASC`). PostgreSQL’s composite B-Tree index on `(trip_id, t)` satisfies this query as an index-only or clustered range scan with sub-millisecond execution times even with ~700k+ rows.
* **Why not MongoDB or DynamoDB:** Relational integrity across multi-tenant relationships (`Carriers -> Vehicles -> Trips -> Samples`) with foreign keys, cascade deletes, and check constraints (`role_carrier_consistency`) eliminates orphan data and guarantees strict RBAC scoping directly in SQL joins without application-level eventual consistency or N+1 queries.
* **Storage Footprint:** Coordinates use `DOUBLE PRECISION` (8 bytes) for GPS accuracy, while metrics (`speed_kph`, `fuel_pct`) use `REAL` (4 bytes). On ~691,200 rows, this keeps memory footprint and disk I/O low.

### 2. Time-Window Chunking & Scrubbing Strategy
* **Chunking vs. Single Fetch:** A 24-hour trip contains 86,400 samples (~15 MB uncompressed JSON). Returning this at once would saturate network bandwidth, trigger memory pressure on mobile/low-end clients, and cause UI jank. Instead, data is fetched in discrete 600-second (10-minute) windows (`from_t`..`to_t`).
* **Cache & Determinism:** Telemetry windows are aligned to absolute timestamps (`chunkIndex = Math.floor(currentTime / 600)`), making URLs strictly deterministic (`from_t=0&to_t=600`, `600..1200`). This allows aggressive browser and client caching (`Cache-Control: private, max-age=3600`, TanStack Query `staleTime: Infinity`, `gcTime: 30m`). Scrubbing back over an already-viewed window requires zero network calls.
* **Lookahead & Bidirectional Prefetching:** The custom React hook `useTripReplay` automatically prefetches adjacent chunks (`chunkIndex + 1` and `chunkIndex - 1`) in the background. As the user scrubs or plays forward/backward, the next window is already in the TanStack Query cache, eliminating loading spinners during continuous playback.
* **Downsampling (`step` parameter):** The backend supports an optional `step=N` query parameter filtering on `t % step == 0` using the index. This allows full-day overviews (e.g. `step=30` yields ~2,880 points for all 86,400s) without violating the 3,600 points-per-payload ceiling (`MAX_POINTS_PER_WINDOW`).
* **O(1) / Binary Search Point Lookup:** Because samples are ordered by `t`, the frontend resolves the active telemetry point at `currentTime` via direct offset `targetT - fromT` (O(1) fast path) falling back to binary search (`O(log N)`), ensuring smooth 60 FPS slider movement without layout thrashing.

### 3. Rendering Approach: Canvas (uPlot) + Leaflet with Dynamic Slicing
* **uPlot for Telemetry Graphs:** Instead of heavy SVG-based chart libraries (Recharts, Chart.js) that struggle with thousands of DOM nodes, uPlot uses HTML5 2D Canvas. It renders 600–3,600 points in <2ms, smoothly handling high-frequency scrub events without dropping frames.
* **Leaflet Route Rendering:** The map renders the route segment corresponding to the active window as a Leaflet polyline, with a directional marker indicating vehicle position and speed at `currentTime`. Slicing to the current window avoids passing 86k SVG path coordinates to the DOM.

### 4. RBAC & Access Control: HTTP 403 vs 404
* **Consistent 403 on Carrier Mismatch:** When an authenticated `DISPATCHER` requests a vehicle, trip, or telemetry belonging to another carrier, the backend returns **HTTP 403 (Forbidden)**.
* **Why 403 instead of 404:** We chose explicit 403 over 404 for existing cross-tenant resources to clearly separate *"this resource does not exist"* (404) from *"you are not authorized to access this tenant's asset"* (403). It aids dispatcher debugging and fleet audit logging while still failing closed on the server. Non-existent IDs return 404.
* **Server-Side Enforcement:** All entity routes (`/vehicles/{id}`, `/vehicles/{id}/trips`, `/trips/{id}/telemetry`) verify tenant ownership in Python before executing telemetry queries. SQL queries filter by `carrier_id` directly; client-side hiding is treated solely as UI convenience.

### 5. High-Throughput Seeding with `asyncpg` Binary COPY
* **Seed Architecture:** Instead of slow ORM `session.add()` inserts (which would take several minutes for 691,200 rows), `seed.py` uses raw asyncpg binary `copy_records_to_table`.
* **Index Strategy During Seed:** The composite index `idx_telemetry_trip_t` is dropped prior to streaming data and rebuilt in a single sorted pass afterwards. This loads all 691,200 records in ~3–5 seconds total.
* **Database State:** The seed script drops and recreates schema using `Base.metadata.create_all`, seeds 2 carriers, 8 vehicles, 8 24-hour trips, demo accounts, and runs `ANALYZE` for fresh query planner statistics.

### 6. Fixture Tiling & Seam Handling
* **Tiling Decision:** The 900-second closed delivery loop fixture (`fleet-sample.json`) is tiled end-to-end 96× to reach 86,400 seconds (24 hours).
* **Seams Left Intact:** As permitted by the assignment brief, visible 15-minute seams (fuel level resetting to 100%, vehicle position looping to depot) were deliberately left intact without artificial smoothing. This keeps the telemetry true to the provided raw fixture and simplifies deterministic testing.

### 7. Explicit Cuts (What was cut to meet the 6-hour timebox)
* **Auth Extras:** In strict compliance with `RULES.md`, we omitted sign-up, password reset, and email verification. Authentication is strictly email/password sign-in issuing signed JWT bearer tokens.
* **Global Route Precomputation:** We omitted pre-simplifying the full 24-hour GPS path via Ramer-Douglas-Peucker on the server. Slicing on the client per chunk provided sufficient 60 FPS performance without adding background worker complexity.
* **Complex State Management:** Redux/Zustand were omitted in favor of TanStack Query v5 server-state caching + lightweight React Context for user sessions.

### 8. What We Would Do With Two More Days
1. **Server-Side Spatial Downsampling (Ramer-Douglas-Peucker / PostGIS):** Precompute generalized trip geometries at zoom-dependent resolutions (`overview`, `medium`, `detail`) to show the full 24h background route on the map while scrubbing a local chunk.
2. **WebSocket / SSE Live Ingestion:** Extend the architecture from post-trip replay to real-time telemetry streaming from on-vehicle IoT trackers.
3. **Automated End-to-End Tests:** Add Playwright browser tests verifying smooth slider drag interactions, canvas redraws, and map marker movements under simulated 3G latency.
4. **Export / Annotation Features:** Allow dispatchers to flag anomalous events (e.g. sudden fuel drop, speeding incidents > 90 km/h) and export CSV/PDF incident reports.
