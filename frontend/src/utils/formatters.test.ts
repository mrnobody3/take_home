import { describe, it, expect } from 'vitest';
import {
  formatSeconds,
  formatSpeed,
  formatFuel,
  formatCoordinates,
  formatDuration,
} from './formatters';

describe('Formatters', () => {
  describe('formatSeconds', () => {
    it('formats 0s correctly', () => {
      expect(formatSeconds(0)).toBe('00:00:00');
    });

    it('formats hours, minutes, and seconds', () => {
      expect(formatSeconds(3665)).toBe('01:01:05');
    });

    it('formats 24 hours (86,400s)', () => {
      expect(formatSeconds(86400)).toBe('24:00:00');
    });

    it('handles negative or invalid seconds gracefully', () => {
      expect(formatSeconds(-10)).toBe('00:00:00');
      expect(formatSeconds(NaN)).toBe('00:00:00');
    });
  });

  describe('formatSpeed', () => {
    it('formats speed in km/h with 1 decimal place', () => {
      expect(formatSpeed(45.67)).toBe('45.7 km/h');
      expect(formatSpeed(0)).toBe('0.0 km/h');
    });

    it('handles null/undefined gracefully', () => {
      expect(formatSpeed(null)).toBe('--');
      expect(formatSpeed(undefined)).toBe('--');
    });
  });

  describe('formatFuel', () => {
    it('formats fuel percentage with 1 decimal place', () => {
      expect(formatFuel(84.3)).toBe('84.3%');
      expect(formatFuel(100)).toBe('100.0%');
    });

    it('handles null/undefined gracefully', () => {
      expect(formatFuel(null)).toBe('--');
      expect(formatFuel(undefined)).toBe('--');
    });
  });

  describe('formatCoordinates', () => {
    it('formats coordinates with 5 decimal places', () => {
      expect(formatCoordinates(52.370216, 4.895168)).toBe('52.37022, 4.89517');
    });
  });

  describe('formatDuration', () => {
    it('formats full day duration', () => {
      expect(formatDuration(86400)).toBe('24 hours (86,400s)');
    });

    it('formats partial hour duration', () => {
      expect(formatDuration(3690)).toBe('1 hours (3,690s)');
    });
  });
});
