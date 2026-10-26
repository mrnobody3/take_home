"""SQLAlchemy 2.0 ORM models for Waypoint.

Tenancy chain: Carrier -> Vehicle -> Trip -> TelemetrySample.
A DISPATCHER is scoped to exactly one carrier; PLATFORM_STAFF has no carrier.
"""

from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
)
from sqlalchemy.dialects.postgresql import DOUBLE_PRECISION, REAL
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Deterministic constraint names -> stable, readable migrations.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class UserRole(str, enum.Enum):
    DISPATCHER = "DISPATCHER"
    PLATFORM_STAFF = "PLATFORM_STAFF"


class Carrier(Base):
    """A delivery company — the tenant."""

    __tablename__ = "carriers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)

    # lazy="raise": forbid implicit lazy-loading (it breaks under asyncio anyway).
    vehicles: Mapped[list[Vehicle]] = relationship(back_populates="carrier", lazy="raise")
    users: Mapped[list[User]] = relationship(back_populates="carrier", lazy="raise")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # DISPATCHER must belong to a carrier; PLATFORM_STAFF must not.
        CheckConstraint(
            "(role = 'DISPATCHER' AND carrier_id IS NOT NULL) "
            "OR (role = 'PLATFORM_STAFF' AND carrier_id IS NULL)",
            name="role_carrier_consistency",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    carrier_id: Mapped[int | None] = mapped_column(
        ForeignKey("carriers.id", ondelete="CASCADE"), index=True
    )

    carrier: Mapped[Carrier | None] = relationship(back_populates="users", lazy="raise")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    carrier_id: Mapped[int] = mapped_column(
        ForeignKey("carriers.id", ondelete="CASCADE"), index=True
    )
    plate: Mapped[str] = mapped_column(String(32), unique=True)
    model: Mapped[str] = mapped_column(String(120))
    depot: Mapped[str] = mapped_column(String(120))

    carrier: Mapped[Carrier] = relationship(back_populates="vehicles", lazy="raise")
    trips: Mapped[list[Trip]] = relationship(back_populates="vehicle", lazy="raise")


class Trip(Base):
    """One shift for one vehicle."""

    __tablename__ = "trips"
    __table_args__ = (
        CheckConstraint("duration_seconds >= 0", name="duration_non_negative"),
        # "Trips for a vehicle, most recent first".
        Index("idx_trips_vehicle_start", "vehicle_id", "start_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    # timezone=True -> TIMESTAMPTZ; always written/read as UTC.
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Trip length in seconds; lets the client size the timeline without
    # touching telemetry_samples. End time = start_time + duration_seconds.
    duration_seconds: Mapped[int] = mapped_column(Integer)

    vehicle: Mapped[Vehicle] = relationship(back_populates="trips", lazy="raise")
    # Intentionally NO `samples` relationship: a trip has 86,400 rows and must
    # only ever be read in time windows via an explicit (trip_id, t) range query.


class TelemetrySample(Base):
    """One second of telemetry within a trip."""

    __tablename__ = "telemetry_samples"
    __table_args__ = (
        # Composite B-Tree for windowed scrubbing:
        #   WHERE trip_id = :id AND t BETWEEN :from_t AND :to_t ORDER BY t
        # Unique as well: one sample per second per trip.
        Index("idx_telemetry_trip_t", "trip_id", "t", unique=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    t: Mapped[int] = mapped_column(Integer)  # seconds from trip start
    lat: Mapped[float] = mapped_column(DOUBLE_PRECISION)
    lon: Mapped[float] = mapped_column(DOUBLE_PRECISION)
    speed_kph: Mapped[float] = mapped_column(REAL)
    fuel_pct: Mapped[float] = mapped_column(REAL)
