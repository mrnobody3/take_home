/**
 * Typed API client for the Waypoint Fleet Telemetry Platform.
 *
 * Implements typed interfaces mirroring the FastAPI backend schemas
 * and a fetch wrapper with automatic JWT authorization header injection.
 */

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000';

export const TOKEN_STORAGE_KEY = 'waypoint_access_token';
export const USER_STORAGE_KEY = 'waypoint_current_user';

// --------------------------------------------------------------------------- //
// Model Interfaces (strictly typed, zero `any`)
// --------------------------------------------------------------------------- //

export type UserRole = 'DISPATCHER' | 'PLATFORM_STAFF';

export interface CurrentUser {
  id: number;
  email: string;
  role: UserRole;
  carrier_id: number | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: CurrentUser;
}

export interface Vehicle {
  id: number;
  plate: string;
  model: string;
  depot: string;
  carrier_id: number;
  carrier_name: string;
  trip_count: number;
  last_trip_at: string | null;
}

export interface Trip {
  id: number;
  vehicle_id: number;
  start_time: string;
  duration_seconds: number;
  end_time: string;
}

export interface VehicleRef {
  id: number;
  plate: string;
  model: string;
  depot: string;
  carrier_id: number;
}

export interface TripDetail extends Trip {
  vehicle: VehicleRef;
}

export interface TelemetryPoint {
  t: number;
  lat: number;
  lon: number;
  speed_kph: number;
  fuel_pct: number;
}

export interface TelemetryWindow {
  trip_id: number;
  from_t: number;
  to_t: number;
  step: number;
  samples: TelemetryPoint[];
}

// --------------------------------------------------------------------------- //
// Error Handling
// --------------------------------------------------------------------------- //

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`API Error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

interface ErrorResponseBody {
  detail?: string | { msg?: string }[];
}

function parseErrorDetail(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null) {
    const errorBody = body as ErrorResponseBody;
    if (typeof errorBody.detail === 'string') {
      return errorBody.detail;
    }
    if (Array.isArray(errorBody.detail) && errorBody.detail.length > 0) {
      const first = errorBody.detail[0];
      if (typeof first?.msg === 'string') {
        return first.msg;
      }
    }
  }
  return `HTTP error ${status}`;
}

// --------------------------------------------------------------------------- //
// Token / Storage Helpers
// --------------------------------------------------------------------------- //

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function removeStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getStoredUser(): CurrentUser | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export function setStoredUser(user: CurrentUser): void {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredAuth(): void {
  removeStoredToken();
  localStorage.removeItem(USER_STORAGE_KEY);
}

// --------------------------------------------------------------------------- //
// Base Fetch Wrapper
// --------------------------------------------------------------------------- //

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;

  const headers = new Headers(options.headers ?? {});

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const token = getStoredToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }

    let detail = `Request failed with status ${response.status}`;
    try {
      const errorJson: unknown = await response.json();
      detail = parseErrorDetail(response.status, errorJson);
    } catch {
      // response might be empty or plain text
    }

    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return (await response.json()) as T;
}

// --------------------------------------------------------------------------- //
// Typed API Endpoints
// --------------------------------------------------------------------------- //

export async function login(credentials: LoginRequest): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  setStoredToken(data.access_token);
  setStoredUser(data.user);
  return data;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return apiFetch<CurrentUser>('/auth/me');
}

export async function listVehicles(): Promise<Vehicle[]> {
  return apiFetch<Vehicle[]>('/vehicles');
}

export async function getVehicle(vehicleId: number): Promise<Vehicle> {
  return apiFetch<Vehicle>(`/vehicles/${vehicleId}`);
}

export async function listVehicleTrips(vehicleId: number): Promise<Trip[]> {
  return apiFetch<Trip[]>(`/vehicles/${vehicleId}/trips`);
}

export async function getTrip(tripId: number): Promise<TripDetail> {
  return apiFetch<TripDetail>(`/trips/${tripId}`);
}

/**
 * Fetch a time-based window of telemetry samples.
 * Used for timeline scrubbing and caching with TanStack Query.
 */
export async function fetchTelemetry(
  tripId: number,
  fromT: number,
  toT: number,
  step = 1
): Promise<TelemetryWindow> {
  const params = new URLSearchParams({
    from_t: fromT.toString(),
    to_t: toT.toString(),
  });
  if (step > 1) {
    params.set('step', step.toString());
  }

  return apiFetch<TelemetryWindow>(`/trips/${tripId}/telemetry?${params.toString()}`);
}

/**
 * Fetch a downsampled overview of the whole trip (e.g. 24h with step=30 yields ~2880 points).
 */
export async function fetchTripSummary(
  tripId: number,
  duration = 86400,
  step = 30
): Promise<TelemetryWindow> {
  return fetchTelemetry(tripId, 0, duration, step);
}

// Grouped object export for convenience
export const api = {
  login,
  getCurrentUser,
  listVehicles,
  getVehicle,
  listVehicleTrips,
  getTrip,
  fetchTelemetry,
  fetchTripSummary,
};
