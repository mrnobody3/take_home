"""Vehicle, trip and telemetry routes.

Access control (enforced here, on the server):
  * every route requires an authenticated user (`get_current_user`);
  * PLATFORM_STAFF sees every carrier;
  * DISPATCHER sees only their own carrier: lists are filtered by `carrier_id`,
    and a request for another carrier's specific vehicle/trip is a 403 —
    never a silently empty result. Unknown IDs are a 404.

Telemetry is only ever served as a time window (`from_t`..`to_t`, inclusive),
never as a whole trip and never with limit/offset pagination.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, computed_field
from sqlalchemy import Select, func, select

from auth import CurrentUser, CurrentUserDep, SessionDep, get_current_user
from models import Carrier, TelemetrySample, Trip, UserRole, Vehicle

# Router-level dependency: any route added here later is authenticated by default.
router = APIRouter(tags=["fleet"], dependencies=[Depends(get_current_user)])

# Upper bound on points per telemetry response (1 h at 1 Hz, or a whole
# 24 h trip at step=24). Keeps every payload small regardless of zoom level.
MAX_POINTS_PER_WINDOW = 3600


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class VehicleOut(BaseModel):
    id: int
    plate: str
    model: str
    depot: str
    carrier_id: int
    carrier_name: str
    trip_count: int
    last_trip_at: datetime | None


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    vehicle_id: int
    start_time: datetime
    duration_seconds: int

    @computed_field  # type: ignore[prop-decorator]
    @property
    def end_time(self) -> datetime:
        return self.start_time + timedelta(seconds=self.duration_seconds)


class VehicleRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plate: str
    model: str
    depot: str
    carrier_id: int


class TripDetail(TripOut):
    vehicle: VehicleRef


class TelemetryPoint(BaseModel):
    t: int
    lat: float
    lon: float
    speed_kph: float
    fuel_pct: float


class TelemetryWindow(BaseModel):
    trip_id: int
    from_t: int
    to_t: int
    step: int
    samples: list[TelemetryPoint]


# --------------------------------------------------------------------------- #
# Access control helpers
# --------------------------------------------------------------------------- #
def ensure_carrier_access(user: CurrentUser, carrier_id: int) -> None:
    """403 unless the user may see entities owned by `carrier_id`."""
    if user.role is UserRole.PLATFORM_STAFF:
        return
    if carrier_id != user.carrier_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _not_found(entity: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{entity} not found")


async def _vehicle_carrier_id(session: SessionDep, vehicle_id: int) -> int:
    carrier_id = await session.scalar(select(Vehicle.carrier_id).where(Vehicle.id == vehicle_id))
    if carrier_id is None:
        raise _not_found("Vehicle")
    return carrier_id


async def _trip_carrier_id(session: SessionDep, trip_id: int) -> int:
    carrier_id = await session.scalar(
        select(Vehicle.carrier_id)
        .join(Trip, Trip.vehicle_id == Vehicle.id)
        .where(Trip.id == trip_id)
    )
    if carrier_id is None:
        raise _not_found("Trip")
    return carrier_id


def _vehicle_summary_query() -> Select[tuple[int, str, str, str, int, str, int, datetime | None]]:
    """Vehicles with carrier name, trip count and latest trip start — one query, no N+1."""
    return (
        select(
            Vehicle.id,
            Vehicle.plate,
            Vehicle.model,
            Vehicle.depot,
            Vehicle.carrier_id,
            Carrier.name.label("carrier_name"),
            func.count(Trip.id).label("trip_count"),
            func.max(Trip.start_time).label("last_trip_at"),
        )
        .join(Carrier, Carrier.id == Vehicle.carrier_id)
        .outerjoin(Trip, Trip.vehicle_id == Vehicle.id)
        .group_by(Vehicle.id, Carrier.name)
    )


# --------------------------------------------------------------------------- #
# Vehicles
# --------------------------------------------------------------------------- #
@router.get("/vehicles")
async def list_vehicles(user: CurrentUserDep, session: SessionDep) -> list[VehicleOut]:
    stmt = _vehicle_summary_query().order_by(Carrier.name, Vehicle.plate)
    if user.role is UserRole.DISPATCHER:
        stmt = stmt.where(Vehicle.carrier_id == user.carrier_id)
    rows = await session.execute(stmt)
    return [VehicleOut.model_validate(row._mapping) for row in rows]


@router.get("/vehicles/{id}")
async def get_vehicle(id: int, user: CurrentUserDep, session: SessionDep) -> VehicleOut:
    # Deliberately NOT tenant-filtered in SQL: a foreign ID must be a 403, not a 404.
    row = (await session.execute(_vehicle_summary_query().where(Vehicle.id == id))).one_or_none()
    if row is None:
        raise _not_found("Vehicle")
    ensure_carrier_access(user, row.carrier_id)
    return VehicleOut.model_validate(row._mapping)


@router.get("/vehicles/{vehicle_id}", include_in_schema=False)
async def get_vehicle_alias(
    vehicle_id: int, user: CurrentUserDep, session: SessionDep
) -> VehicleOut:
    return await get_vehicle(id=vehicle_id, user=user, session=session)


@router.get("/vehicles/{id}/trips")
async def list_vehicle_trips(id: int, user: CurrentUserDep, session: SessionDep) -> list[TripOut]:
    # Check the parent first, so another carrier's vehicle is a 403, not an empty list.
    ensure_carrier_access(user, await _vehicle_carrier_id(session, id))
    trips = await session.scalars(
        select(Trip).where(Trip.vehicle_id == id).order_by(Trip.start_time.desc())
    )
    return [TripOut.model_validate(trip) for trip in trips]


@router.get("/vehicles/{vehicle_id}/trips", include_in_schema=False)
async def list_vehicle_trips_alias(
    vehicle_id: int, user: CurrentUserDep, session: SessionDep
) -> list[TripOut]:
    return await list_vehicle_trips(id=vehicle_id, user=user, session=session)


# --------------------------------------------------------------------------- #
# Trips & telemetry
# --------------------------------------------------------------------------- #
@router.get("/trips/{id}")
async def get_trip(id: int, user: CurrentUserDep, session: SessionDep) -> TripDetail:
    """Trip metadata (no samples): enough for the client to size the timeline."""
    row = (
        await session.execute(
            select(Trip, Vehicle).join(Vehicle, Vehicle.id == Trip.vehicle_id).where(Trip.id == id)
        )
    ).one_or_none()
    if row is None:
        raise _not_found("Trip")
    trip, vehicle = row[0], row[1]
    ensure_carrier_access(user, vehicle.carrier_id)
    return TripDetail(
        id=trip.id,
        vehicle_id=trip.vehicle_id,
        start_time=trip.start_time,
        duration_seconds=trip.duration_seconds,
        vehicle=VehicleRef.model_validate(vehicle),
    )


@router.get("/trips/{trip_id}", include_in_schema=False)
async def get_trip_alias(trip_id: int, user: CurrentUserDep, session: SessionDep) -> TripDetail:
    return await get_trip(id=trip_id, user=user, session=session)


@router.get("/trips/{id}/telemetry")
async def get_trip_telemetry(
    id: int,
    user: CurrentUserDep,
    session: SessionDep,
    response: Response,
    from_t: Annotated[
        int, Query(ge=0, description="Window start, seconds from trip start (inclusive)")
    ],
    to_t: Annotated[
        int, Query(ge=0, description="Window end, seconds from trip start (inclusive)")
    ],
    step: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_POINTS_PER_WINDOW,
            description="Return every Nth second (for zoomed-out views)",
        ),
    ] = 1,
) -> TelemetryWindow:
    """One time window of a trip's telemetry, ordered by `t`.

    Served by the composite (trip_id, t) B-Tree as a single range scan.
    `step` > 1 keeps samples where `t % step == 0` — aligned to absolute `t`,
    so the same window always returns the same points and caches well.
    """
    if to_t < from_t:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "to_t must be >= from_t")
    points = (to_t - from_t) // step + 1
    if points > MAX_POINTS_PER_WINDOW:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Window too large: {points} points requested, max {MAX_POINTS_PER_WINDOW}. "
            "Narrow from_t..to_t or increase step.",
        )

    ensure_carrier_access(user, await _trip_carrier_id(session, id))

    query = (
        select(
            TelemetrySample.t,
            TelemetrySample.lat,
            TelemetrySample.lon,
            TelemetrySample.speed_kph,
            TelemetrySample.fuel_pct,
        )
        .where(
            TelemetrySample.trip_id == id,
            TelemetrySample.t >= from_t,
            TelemetrySample.t <= to_t,
        )
        .order_by(TelemetrySample.t.asc())
    )
    if step > 1:
        query = query.where(TelemetrySample.t % step == 0)

    rows = await session.execute(query)
    # Recorded telemetry never changes: let the browser reuse windows while scrubbing back.
    response.headers["Cache-Control"] = "private, max-age=3600"
    return TelemetryWindow(
        trip_id=id,
        from_t=from_t,
        to_t=to_t,
        step=step,
        samples=[TelemetryPoint.model_validate(row._mapping) for row in rows],
    )


@router.get("/trips/{trip_id}/telemetry", include_in_schema=False)
async def get_trip_telemetry_alias(
    trip_id: int,
    user: CurrentUserDep,
    session: SessionDep,
    response: Response,
    from_t: Annotated[
        int, Query(ge=0, description="Window start, seconds from trip start (inclusive)")
    ],
    to_t: Annotated[
        int, Query(ge=0, description="Window end, seconds from trip start (inclusive)")
    ],
    step: Annotated[
        int,
        Query(
            ge=1,
            le=MAX_POINTS_PER_WINDOW,
            description="Return every Nth second (for zoomed-out views)",
        ),
    ] = 1,
) -> TelemetryWindow:
    return await get_trip_telemetry(
        id=trip_id,
        user=user,
        session=session,
        response=response,
        from_t=from_t,
        to_t=to_t,
        step=step,
    )
