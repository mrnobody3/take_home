/**
 * Formatting utilities for Waypoint telemetry, timestamps, and vehicle metrics.
 */

/**
 * Formats seconds into HH:MM:SS format (e.g. 43200 -> "12:00:00").
 */
export function formatSeconds(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Formats an ISO datetime string into human-friendly format (e.g. "24 Oct 2026, 02:00").
 */
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return 'No trips yet';
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return isoString;
  }
}

/**
 * Formats speed in km/h with 1 decimal place (e.g. 45.2 -> "45.2 km/h").
 */
export function formatSpeed(speedKph: number | null | undefined): string {
  if (speedKph == null || Number.isNaN(speedKph)) return '--';
  return `${speedKph.toFixed(1)} km/h`;
}

/**
 * Formats fuel percentage with 1 decimal place (e.g. 98.5 -> "98.5%").
 */
export function formatFuel(fuelPct: number | null | undefined): string {
  if (fuelPct == null || Number.isNaN(fuelPct)) return '--';
  return `${fuelPct.toFixed(1)}%`;
}

/**
 * Formats GPS coordinates to 5 decimal places (~1.1m precision).
 */
export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Formats trip duration into hours and seconds (e.g. 86400 -> "24 hours (86,400s)").
 */
export function formatDuration(seconds: number): string {
  const hours = Math.round(seconds / 3600);
  return `${hours} hours (${seconds.toLocaleString()}s)`;
}
