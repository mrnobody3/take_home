"""Authentication: email/password sign-in, JWT issuing and the current-user dependency.

Sign-in only — no sign-up / password reset; users are created by seed.py.
Tokens are stateless HS256 JWTs sent as `Authorization: Bearer <token>`.

Usage in a route:
    @router.get("/vehicles")
    async def list_vehicles(user: CurrentUserDep) -> ...: ...

    @router.get("/admin/carriers", dependencies=[Depends(require_roles(UserRole.PLATFORM_STAFF))])
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from config import Settings, get_settings
from database import get_session
from models import User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])

# auto_error=False: we raise our own 401 with a consistent body + WWW-Authenticate header.
_bearer = HTTPBearer(auto_error=False)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

ALLOWED_ROLES: frozenset[UserRole] = frozenset({UserRole.DISPATCHER, UserRole.PLATFORM_STAFF})


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:  # malformed hash, or password > 72 bytes (bcrypt limit)
        return False


# Checked when the email is unknown, so response time doesn't reveal which emails exist.
_DUMMY_HASH = hash_password("timing-equaliser")


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class CurrentUser(BaseModel):
    """The authenticated principal. Routes get this, never the ORM object."""

    model_config = ConfigDict(from_attributes=True, frozen=True)

    id: int
    email: str
    role: UserRole
    carrier_id: int | None

    @property
    def is_platform_staff(self) -> bool:
        return self.role is UserRole.PLATFORM_STAFF


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # seconds
    user: CurrentUser


class _TokenClaims(BaseModel):
    sub: str  # user id (JWT requires `sub` to be a string)


# --------------------------------------------------------------------------- #
# JWT
# --------------------------------------------------------------------------- #
def create_access_token(user: CurrentUser, settings: Settings) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user.id),
        # Informational for the client only; the server re-reads role/carrier from the DB.
        "role": user.role.value,
        "carrier_id": user.carrier_id,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_ttl_minutes),
    }
    return jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)


def _decode_user_id(token: str, settings: Settings) -> int:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp"]},
        )
        return int(_TokenClaims.model_validate(payload).sub)
    except (jwt.InvalidTokenError, ValidationError, ValueError):
        raise _unauthorized("Invalid or expired token") from None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(detail: str = "Forbidden") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# --------------------------------------------------------------------------- #
# Dependencies
# --------------------------------------------------------------------------- #
async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: SessionDep,
    settings: SettingsDep,
) -> CurrentUser:
    """Authenticate the bearer token and validate the user's role.

    The user is re-loaded from the DB on every request (one PK lookup), so a
    deleted user or a changed role/carrier takes effect immediately instead of
    living on inside an unexpired token.
    """
    if credentials is None:
        raise _unauthorized("Not authenticated")

    user = await session.get(User, _decode_user_id(credentials.credentials, settings))
    if user is None:
        raise _unauthorized("User no longer exists")

    current = CurrentUser.model_validate(user)
    if current.role not in ALLOWED_ROLES:
        raise _forbidden("Unknown role")
    # Defence in depth (the DB has a CHECK for this too): a dispatcher without
    # a carrier would otherwise have an undefined tenant scope.
    if current.role is UserRole.DISPATCHER and current.carrier_id is None:
        raise _forbidden("Dispatcher is not assigned to a carrier")
    return current


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[CurrentUser], Awaitable[CurrentUser]]:
    """Dependency factory restricting a route to specific roles (403 otherwise)."""
    allowed = frozenset(roles)

    async def dependency(user: CurrentUserDep) -> CurrentUser:
        if user.role not in allowed:
            raise _forbidden()
        return user

    return dependency


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@router.post("/login")
async def login(body: LoginRequest, session: SessionDep, settings: SettingsDep) -> TokenResponse:
    email = body.email.strip().lower()
    user = await session.scalar(select(User).where(User.email == email))

    # bcrypt is CPU-bound (~250 ms): keep it off the event loop.
    password_ok = await run_in_threadpool(
        verify_password, body.password, user.password_hash if user else _DUMMY_HASH
    )
    if user is None or not password_ok:
        # Same message for both cases: don't leak which emails are registered.
        raise _unauthorized("Invalid email or password")

    current = CurrentUser.model_validate(user)
    return TokenResponse(
        access_token=create_access_token(current, settings),
        expires_in=settings.access_token_ttl_minutes * 60,
        user=current,
    )


@router.get("/me")
async def me(user: CurrentUserDep) -> CurrentUser:
    return user
