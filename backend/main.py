from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import router as api_router
from auth import router as auth_router
from config import get_settings

app = FastAPI(
    title="Waypoint Fleet Telemetry API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    # Explicit origins: "*" is not allowed together with credentials.
    allow_origins=get_settings().cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Support both direct (/vehicles, /trips, /auth) and prefixed (/api/vehicles, /api/trips, /api/auth)
app.include_router(auth_router)
app.include_router(api_router)
app.include_router(auth_router, prefix="/api")
app.include_router(api_router, prefix="/api")


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "waypoint-backend"}


@app.get("/api/health")
async def api_health_check() -> dict[str, str]:
    return {"status": "ok", "service": "waypoint-backend"}


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Waypoint Fleet Telemetry API"}
