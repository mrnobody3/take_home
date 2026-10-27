"""Reset the database and load demo data for Waypoint.

Volume: 2 carriers x 4 vehicles x 1 trip, each trip = the 900-sample fixture
tiled 96x end-to-end (24 h at 1 Hz = 86,400 samples) -> 691,200 telemetry rows,
streamed into Postgres with a single binary COPY (asyncpg.copy_records_to_table).

Usage:
    docker compose exec backend python seed.py
    # or from the host, against the dockerised db:
    DATABASE_URL=postgresql://waypoint:waypoint_dev_password@localhost:5432/waypoint \
        python backend/seed.py

Env:
    DATABASE_URL  postgresql[+asyncpg]://...  (default: local docker db)
    FIXTURE_PATH  path to fleet-sample.json   (default: <repo>/fixtures/fleet-sample.json)
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import bcrypt
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import CreateIndex, DDLElement, DropIndex

from models import Base, UserRole

DEFAULT_DATABASE_URL = "postgresql://waypoint:waypoint_dev_password@localhost:5432/waypoint"
# backend/seed.py -> <repo>/fixtures/...  (inside the container: /app -> /fixtures/...)
DEFAULT_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "fleet-sample.json"

TILES = 96  # 96 x 15 min = 24 h
DEMO_PASSWORD = "waypoint-demo"
FIXTURE_FIELDS = ["t", "lat", "lon", "speedKph", "fuelPct"]
TELEMETRY_COLUMNS = ("trip_id", "t", "lat", "lon", "speed_kph", "fuel_pct")
TRIP_STAGGER = timedelta(minutes=15)  # vehicles leave the depot at different times

# (t, lat, lon, speed_kph, fuel_pct)
Sample = tuple[int, float, float, float, float]
TelemetryRow = tuple[int, int, float, float, float, float]

_TELEMETRY_TABLE = Base.metadata.tables["telemetry_samples"]
_TELEMETRY_INDEX = next(i for i in _TELEMETRY_TABLE.indexes if i.name == "idx_telemetry_trip_t")
_PG_DIALECT = postgresql.dialect()


@dataclass(frozen=True, slots=True)
class VehicleSpec:
    plate: str
    model: str
    depot: str


@dataclass(frozen=True, slots=True)
class CarrierSpec:
    name: str
    dispatcher_email: str
    vehicles: tuple[VehicleSpec, ...]


@dataclass(frozen=True, slots=True)
class SeededUser:
    email: str
    role: UserRole
    carrier: str | None


CARRIERS: tuple[CarrierSpec, ...] = (
    CarrierSpec(
        name="Northwind Logistics",
        dispatcher_email="dispatcher@northwind.nl",
        vehicles=(
            VehicleSpec("VNB-01-K", "Mercedes-Benz eSprinter", "Amsterdam West"),
            VehicleSpec("VNB-02-K", "Mercedes-Benz eSprinter", "Amsterdam West"),
            VehicleSpec("VNB-03-K", "Ford E-Transit", "Amsterdam Noord"),
            VehicleSpec("VNB-04-K", "Ford E-Transit", "Amsterdam Noord"),
        ),
    ),
    CarrierSpec(
        name="Polder Express",
        dispatcher_email="dispatcher@polderexpress.nl",
        vehicles=(
            VehicleSpec("VPX-11-R", "Renault Master E-Tech", "Amsterdam Zuid"),
            VehicleSpec("VPX-12-R", "Renault Master E-Tech", "Amsterdam Zuid"),
            VehicleSpec("VPX-13-R", "Volkswagen Crafter", "Amsterdam Oost"),
            VehicleSpec("VPX-14-R", "Volkswagen Crafter", "Amsterdam Oost"),
        ),
    ),
)
PLATFORM_STAFF_EMAIL = "support@waypoint.io"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def database_urls() -> tuple[str, str]:
    """Return (asyncpg DSN, SQLAlchemy async URL) from DATABASE_URL.

    docker-compose sets `postgresql+asyncpg://...`, which asyncpg itself rejects.
    """
    raw = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    _, sep, rest = raw.partition("://")
    if not sep:
        raise ValueError(f"DATABASE_URL is not a URL: {raw!r}")
    return f"postgresql://{rest}", f"postgresql+asyncpg://{rest}"


def ddl(stmt: DDLElement) -> str:
    return str(stmt.compile(dialect=_PG_DIALECT))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def load_fixture(path: Path) -> list[Sample]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("fields") != FIXTURE_FIELDS:
        raise ValueError(
            f"Unexpected fixture fields {data.get('fields')!r}, want {FIXTURE_FIELDS!r}"
        )
    samples: list[Sample] = [
        (int(t), float(lat), float(lon), float(speed), float(fuel))
        for t, lat, lon, speed, fuel in data["samples"]
    ]
    # Tiling relies on a gap-free 1 Hz stream starting at t=0.
    if [s[0] for s in samples] != list(range(len(samples))):
        raise ValueError("Fixture must be contiguous 1 Hz samples starting at t=0")
    return samples


def telemetry_rows(trip_ids: Sequence[int], loop: Sequence[Sample]) -> Iterator[TelemetryRow]:
    """Lazily tile the fixture loop TILES times per trip (no 690k-row list in memory).

    The seam every 15 min (fuel back to the fixture's start value, route restarts)
    is left as-is on purpose: it is the fixture's documented behaviour.
    """
    period = len(loop)
    for trip_id in trip_ids:
        for tile in range(TILES):
            offset = tile * period
            for t, lat, lon, speed, fuel in loop:
                yield (trip_id, offset + t, lat, lon, speed, fuel)


# --------------------------------------------------------------------------- #
# Steps
# --------------------------------------------------------------------------- #
async def reset_schema(sqlalchemy_url: str) -> None:
    """Drop and recreate all tables from models.py (single source of truth for DDL)."""
    engine = create_async_engine(sqlalchemy_url)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


async def insert_tenants(
    conn: asyncpg.Connection, trip_start: datetime, trip_seconds: int
) -> tuple[list[int], list[SeededUser]]:
    """Insert carriers, vehicles, one 24 h trip per vehicle and the demo users."""
    trip_ids: list[int] = []
    users: list[SeededUser] = []
    vehicle_index = 0

    for carrier in CARRIERS:
        carrier_id: int = await conn.fetchval(
            "INSERT INTO carriers (name) VALUES ($1) RETURNING id", carrier.name
        )
        await conn.execute(
            "INSERT INTO users (email, password_hash, role, carrier_id) VALUES ($1, $2, $3, $4)",
            carrier.dispatcher_email,
            hash_password(DEMO_PASSWORD),
            UserRole.DISPATCHER.value,
            carrier_id,
        )
        users.append(SeededUser(carrier.dispatcher_email, UserRole.DISPATCHER, carrier.name))

        for vehicle in carrier.vehicles:
            vehicle_id: int = await conn.fetchval(
                "INSERT INTO vehicles (carrier_id, plate, model, depot) "
                "VALUES ($1, $2, $3, $4) RETURNING id",
                carrier_id,
                vehicle.plate,
                vehicle.model,
                vehicle.depot,
            )
            trip_id: int = await conn.fetchval(
                "INSERT INTO trips (vehicle_id, start_time, duration_seconds) "
                "VALUES ($1, $2, $3) RETURNING id",
                vehicle_id,
                trip_start + vehicle_index * TRIP_STAGGER,
                trip_seconds,
            )
            trip_ids.append(trip_id)
            vehicle_index += 1

    await conn.execute(
        "INSERT INTO users (email, password_hash, role, carrier_id) VALUES ($1, $2, $3, NULL)",
        PLATFORM_STAFF_EMAIL,
        hash_password(DEMO_PASSWORD),
        UserRole.PLATFORM_STAFF.value,
    )
    users.append(SeededUser(PLATFORM_STAFF_EMAIL, UserRole.PLATFORM_STAFF, None))
    return trip_ids, users


async def copy_telemetry(
    conn: asyncpg.Connection, trip_ids: Sequence[int], loop: Sequence[Sample]
) -> int:
    """Bulk-load telemetry via binary COPY.

    The (trip_id, t) index is dropped for the load and rebuilt afterwards:
    one sorted index build is much cheaper than 690k incremental B-Tree inserts.
    """
    await conn.execute(ddl(DropIndex(_TELEMETRY_INDEX)))
    status = await conn.copy_records_to_table(
        "telemetry_samples",
        records=telemetry_rows(trip_ids, loop),
        columns=TELEMETRY_COLUMNS,
    )
    await conn.execute(ddl(CreateIndex(_TELEMETRY_INDEX)))
    return int(status.split()[-1])  # "COPY 691200"


def print_summary(users: Sequence[SeededUser], trips: int, rows: int, elapsed: float) -> None:
    print(
        f"\nSeeded {len(CARRIERS)} carriers, {trips} vehicles, {trips} trips, "
        f"{rows:,} telemetry rows in {elapsed:.1f}s\n"
    )
    print("Sign-in credentials:")
    print(f"  {'ROLE':<16} {'EMAIL':<30} {'PASSWORD':<15} CARRIER")
    for user in users:
        print(
            f"  {user.role.value:<16} {user.email:<30} {DEMO_PASSWORD:<15} {user.carrier or '— (all)'}"
        )
    print()


async def main() -> None:
    started = time.perf_counter()
    dsn, sqlalchemy_url = database_urls()
    fixture_path = Path(os.environ.get("FIXTURE_PATH", DEFAULT_FIXTURE_PATH))

    loop = load_fixture(fixture_path)
    trip_seconds = TILES * len(loop)  # 86,400 s = 24 h; samples cover t = 0..trip_seconds-1
    # Trips cover "yesterday" (UTC) so the data always looks recent.
    trip_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=1
    )

    print(f"Fixture: {fixture_path} ({len(loop)} samples, tiled {TILES}x)")
    print("Resetting schema…")
    await reset_schema(sqlalchemy_url)

    conn = await asyncpg.connect(dsn)
    try:
        # One transaction: a failed seed never leaves a half-loaded database.
        async with conn.transaction():
            trip_ids, users = await insert_tenants(conn, trip_start, trip_seconds)
            print(f"Copying {len(trip_ids) * TILES * len(loop):,} telemetry rows…")
            rows = await copy_telemetry(conn, trip_ids, loop)
        await conn.execute("ANALYZE")  # fresh planner stats for the (trip_id, t) range scans
    finally:
        await conn.close()

    print_summary(users, len(trip_ids), rows, time.perf_counter() - started)


if __name__ == "__main__":
    asyncio.run(main())
