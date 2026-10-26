import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  apiFetch,
  clearStoredAuth,
  getStoredToken,
  setStoredToken,
  getStoredUser,
  setStoredUser,
  TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
  ApiError,
} from './api';

describe('API Client & Auth State', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves token in localStorage', () => {
    expect(getStoredToken()).toBeNull();
    setStoredToken('test_token_123');
    expect(getStoredToken()).toBe('test_token_123');
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('test_token_123');
  });

  it('stores, retrieves and clears user session', () => {
    const user = {
      id: 1,
      email: 'test@example.com',
      role: 'DISPATCHER' as const,
      carrier_id: 1,
    };
    setStoredUser(user);
    expect(getStoredUser()).toEqual(user);

    clearStoredAuth();
    expect(getStoredToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
    expect(localStorage.getItem(USER_STORAGE_KEY)).toBeNull();
  });

  it('dispatches auth:unauthorized event and clears stored auth on HTTP 401', async () => {
    setStoredToken('expired_or_invalid_token');

    let eventFired = false;
    const handleUnauthorized = () => {
      eventFired = true;
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'Invalid or expired token' }),
    } as unknown as Response);

    await expect(apiFetch('/vehicles')).rejects.toThrow(ApiError);
    expect(getStoredToken()).toBeNull();
    expect(eventFired).toBe(true);

    window.removeEventListener('auth:unauthorized', handleUnauthorized);
  });
});
