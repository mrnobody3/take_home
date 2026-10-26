"""Unit/integration tests for fleet API routes, RBAC, and telemetry windowing."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import ASGITransport, AsyncClient

from config import get_settings
from database import engine
from main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
async def cleanup_engine():
    yield
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def tokens(client: AsyncClient) -> dict[str, str]:
    """Obtain auth tokens for Northwind dispatcher, Polder dispatcher, and Platform staff."""
    # Northwind Dispatcher (Carrier 1)
    r1 = await client.post(
        "/auth/login",
        json={"email": "dispatcher@northwind.nl", "password": "waypoint-demo"},
    )
    assert r1.status_code == 200, f"Login failed: {r1.text}"

    # Polder Express Dispatcher (Carrier 2)
    r2 = await client.post(
        "/auth/login",
        json={"email": "dispatcher@polderexpress.nl", "password": "waypoint-demo"},
    )
    assert r2.status_code == 200, f"Login failed: {r2.text}"

    # Platform Staff (All carriers)
    r3 = await client.post(
        "/auth/login",
        json={"email": "support@waypoint.io", "password": "waypoint-demo"},
    )
    assert r3.status_code == 200, f"Login failed: {r3.text}"

    return {
        "northwind": r1.json()["access_token"],
        "polder": r2.json()["access_token"],
        "staff": r3.json()["access_token"],
    }


@pytest.mark.anyio
async def test_token_validation_and_expiration(client: AsyncClient, tokens: dict[str, str]):
    """Verify expired token, tampered signature, and malformed tokens return 401."""
    settings = get_settings()

    # 1. Tampered / invalid signature token
    tampered_token = tokens["northwind"] + "tampered"
    r_tampered = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tampered_token}"}
    )
    assert r_tampered.status_code == 401
    assert "Invalid or expired token" in r_tampered.text

    # 2. Malformed token string
    r_malformed = await client.get(
        "/vehicles", headers={"Authorization": "Bearer not-a-valid-token"}
    )
    assert r_malformed.status_code == 401
    assert "Invalid or expired token" in r_malformed.text

    # 3. Expired token
    expired_payload = {
        "sub": "1",
        "role": "DISPATCHER",
        "carrier_id": 1,
        "iat": datetime.now(UTC) - timedelta(hours=2),
        "exp": datetime.now(UTC) - timedelta(hours=1),
    }
    expired_token = jwt.encode(
        expired_payload, settings.secret_key, algorithm=settings.jwt_algorithm
    )
    r_expired = await client.get("/vehicles", headers={"Authorization": f"Bearer {expired_token}"})
    assert r_expired.status_code == 401
    assert "Invalid or expired token" in r_expired.text


@pytest.mark.anyio
async def test_unauthenticated_requests_fail(client: AsyncClient):
    """Endpoints require authentication."""
    r = await client.get("/vehicles")
    assert r.status_code == 401

    r = await client.get("/vehicles/1/trips")
    assert r.status_code == 401

    r = await client.get("/trips/1/telemetry?from_t=0&to_t=60")
    assert r.status_code == 401


@pytest.mark.anyio
async def test_vehicles_list_rbac(client: AsyncClient, tokens: dict[str, str]):
    """DISPATCHER sees only their own carrier vehicles; PLATFORM_STAFF sees all."""
    # Northwind dispatcher sees only Northwind
    r_nw = await client.get("/vehicles", headers={"Authorization": f"Bearer {tokens['northwind']}"})
    assert r_nw.status_code == 200
    vehicles_nw = r_nw.json()
    assert len(vehicles_nw) > 0
    assert all(v["carrier_name"] == "Northwind Logistics" for v in vehicles_nw)

    # Polder dispatcher sees only Polder
    r_polder = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tokens['polder']}"}
    )
    assert r_polder.status_code == 200
    vehicles_polder = r_polder.json()
    assert len(vehicles_polder) > 0
    assert all(v["carrier_name"] == "Polder Express" for v in vehicles_polder)

    # Staff sees both
    r_staff = await client.get("/vehicles", headers={"Authorization": f"Bearer {tokens['staff']}"})
    assert r_staff.status_code == 200
    vehicles_staff = r_staff.json()
    carriers = {v["carrier_name"] for v in vehicles_staff}
    assert "Northwind Logistics" in carriers
    assert "Polder Express" in carriers
    assert len(vehicles_staff) == len(vehicles_nw) + len(vehicles_polder)


@pytest.mark.anyio
async def test_vehicle_trips_rbac(client: AsyncClient, tokens: dict[str, str]):
    """DISPATCHER gets 403 when requesting another carrier's vehicle trips."""
    r_nw = await client.get("/vehicles", headers={"Authorization": f"Bearer {tokens['northwind']}"})
    nw_vehicle_id = r_nw.json()[0]["id"]

    r_polder = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tokens['polder']}"}
    )
    polder_vehicle_id = r_polder.json()[0]["id"]

    # Northwind dispatcher accesses own vehicle trips -> 200
    r_own = await client.get(
        f"/vehicles/{nw_vehicle_id}/trips",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_own.status_code == 200
    assert isinstance(r_own.json(), list)
    assert len(r_own.json()) > 0
    assert r_own.json()[0]["vehicle_id"] == nw_vehicle_id

    # Northwind dispatcher accesses Polder vehicle trips -> 403 Forbidden
    r_foreign = await client.get(
        f"/vehicles/{polder_vehicle_id}/trips",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_foreign.status_code == 403

    # Polder dispatcher accesses Northwind vehicle trips -> 403 Forbidden
    r_foreign2 = await client.get(
        f"/vehicles/{nw_vehicle_id}/trips",
        headers={"Authorization": f"Bearer {tokens['polder']}"},
    )
    assert r_foreign2.status_code == 403

    # Platform staff accesses both -> 200
    r_staff_nw = await client.get(
        f"/vehicles/{nw_vehicle_id}/trips",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_staff_nw.status_code == 200

    r_staff_polder = await client.get(
        f"/vehicles/{polder_vehicle_id}/trips",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_staff_polder.status_code == 200

    # Non-existent vehicle -> 404
    r_not_found = await client.get(
        "/vehicles/999999/trips",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_not_found.status_code == 404


@pytest.mark.anyio
async def test_trip_telemetry_rbac(client: AsyncClient, tokens: dict[str, str]):
    """DISPATCHER gets 403 when requesting another carrier's trip telemetry."""
    # Find a Northwind trip
    r_nw_vehicles = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tokens['northwind']}"}
    )
    nw_v_id = r_nw_vehicles.json()[0]["id"]
    r_nw_trips = await client.get(
        f"/vehicles/{nw_v_id}/trips", headers={"Authorization": f"Bearer {tokens['northwind']}"}
    )
    nw_trip_id = r_nw_trips.json()[0]["id"]

    # Find a Polder trip
    r_polder_vehicles = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tokens['polder']}"}
    )
    polder_v_id = r_polder_vehicles.json()[0]["id"]
    r_polder_trips = await client.get(
        f"/vehicles/{polder_v_id}/trips", headers={"Authorization": f"Bearer {tokens['polder']}"}
    )
    polder_trip_id = r_polder_trips.json()[0]["id"]

    # Northwind accesses own trip telemetry -> 200
    r_own = await client.get(
        f"/trips/{nw_trip_id}/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_own.status_code == 200

    # Northwind accesses Polder trip telemetry -> 403 Forbidden
    r_foreign = await client.get(
        f"/trips/{polder_trip_id}/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_foreign.status_code == 403

    # Polder accesses Northwind trip telemetry -> 403 Forbidden
    r_foreign2 = await client.get(
        f"/trips/{nw_trip_id}/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['polder']}"},
    )
    assert r_foreign2.status_code == 403

    # Staff accesses both -> 200
    r_staff_nw = await client.get(
        f"/trips/{nw_trip_id}/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_staff_nw.status_code == 200

    r_staff_polder = await client.get(
        f"/trips/{polder_trip_id}/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_staff_polder.status_code == 200

    # Non-existent trip -> 404
    r_not_found = await client.get(
        "/trips/999999/telemetry?from_t=0&to_t=60",
        headers={"Authorization": f"Bearer {tokens['staff']}"},
    )
    assert r_not_found.status_code == 404


@pytest.mark.anyio
async def test_trip_telemetry_windowing(client: AsyncClient, tokens: dict[str, str]):
    """Telemetry returns exact window [from_t, to_t] ordered by t."""
    r_nw_vehicles = await client.get(
        "/vehicles", headers={"Authorization": f"Bearer {tokens['northwind']}"}
    )
    nw_v_id = r_nw_vehicles.json()[0]["id"]
    r_nw_trips = await client.get(
        f"/vehicles/{nw_v_id}/trips", headers={"Authorization": f"Bearer {tokens['northwind']}"}
    )
    trip_id = r_nw_trips.json()[0]["id"]

    # Window from 10 to 50
    from_t, to_t = 10, 50
    r = await client.get(
        f"/trips/{trip_id}/telemetry?from_t={from_t}&to_t={to_t}",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["trip_id"] == trip_id
    assert data["from_t"] == from_t
    assert data["to_t"] == to_t
    samples = data["samples"]
    assert len(samples) == (to_t - from_t + 1)
    assert samples[0]["t"] == from_t
    assert samples[-1]["t"] == to_t

    # Ascending order check
    for i in range(len(samples) - 1):
        assert samples[i]["t"] < samples[i + 1]["t"]

    # Window validation: to_t < from_t -> 422
    r_invalid = await client.get(
        f"/trips/{trip_id}/telemetry?from_t=100&to_t=50",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_invalid.status_code == 422

    # Step query
    r_step = await client.get(
        f"/trips/{trip_id}/telemetry?from_t=0&to_t=100&step=10",
        headers={"Authorization": f"Bearer {tokens['northwind']}"},
    )
    assert r_step.status_code == 200
    step_samples = r_step.json()["samples"]
    assert all(s["t"] % 10 == 0 for s in step_samples)
