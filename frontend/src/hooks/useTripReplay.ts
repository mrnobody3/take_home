import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchTelemetry, TelemetryPoint, TelemetryWindow, ApiError } from '../api';

/** Default trip duration: 24 hours = 86,400 seconds */
export const DEFAULT_DURATION = 86400;

/** Default window chunk size: 600 seconds (10 minutes) */
export const CHUNK_SIZE = 600;

export interface UseTripReplayOptions {
  /** The ID of the active trip. If null/undefined, telemetry fetching is disabled. */
  tripId: number | null | undefined;
  /** Total trip duration in seconds (default: 86,400) */
  duration?: number;
  /** Initial playback position in seconds (default: 0) */
  initialTime?: number;
  /** Window size in seconds for chunking queries (default: 600) */
  chunkSize?: number;
  /** Whether replay begins in playing state (default: false) */
  autoPlay?: boolean;
  /** Initial playback speed multiplier (default: 1) */
  initialPlaybackSpeed?: number;
}

export interface UseTripReplayReturn {
  // --- Time State & Scrubbing ---
  /** Current playback position in seconds (between 0 and duration) */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Update currentTime with boundary clamping [0, duration] */
  setCurrentTime: (time: number | ((prev: number) => number)) => void;
  /** Direct seek to a specific second [0, duration] */
  seekTo: (time: number) => void;
  /** Step forward by N seconds (default: 1) */
  stepForward: (seconds?: number) => void;
  /** Step backward by N seconds (default: 1) */
  stepBackward: (seconds?: number) => void;

  // --- Window / Chunk Information ---
  /** Index of current 600s chunk: Math.floor(currentTime / chunkSize) */
  chunkIndex: number;
  /** Start second of the current window (inclusive) */
  fromT: number;
  /** End second of the current window (inclusive) */
  toT: number;
  /** Chunk window size in seconds (e.g. 600) */
  chunkSize: number;

  // --- Telemetry Data & Active Point ---
  /** Current active telemetry sample matching currentTime */
  currentPoint: TelemetryPoint | null;
  /** Alias for currentPoint */
  activePoint: TelemetryPoint | null;
  /** All samples in the currently active telemetry chunk */
  samples: TelemetryPoint[];
  /** Raw TelemetryWindow response object from the API */
  telemetryWindow: TelemetryWindow | undefined;

  // --- React Query Status ---
  /** True while the active chunk is loading for the first time */
  isLoading: boolean;
  /** True while any background fetch is in progress */
  isFetching: boolean;
  /** True if fetching the telemetry chunk encountered an error */
  isError: boolean;
  /** Error object if fetch failed */
  error: ApiError | Error | null;
  /** Refetch function for the current chunk */
  refetch: () => void;

  // --- Playback Controls ---
  /** Whether the timeline is currently playing */
  isPlaying: boolean;
  /** Set playing status */
  setIsPlaying: (playing: boolean | ((prev: boolean) => boolean)) => void;
  /** Start playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Toggle play/pause */
  togglePlay: () => void;
  /** Current playback speed multiplier (e.g. 1, 2, 5, 10, 60) */
  playbackSpeed: number;
  /** Set playback speed multiplier */
  setPlaybackSpeed: (speed: number) => void;
}

/**
 * Custom React hook for scrubbing and replaying vehicle telemetry.
 *
 * Manages `currentTime` (0 to 86,400s), calculates the active 600-second window,
 * fetches chunks on demand via TanStack Query with `staleTime: Infinity`,
 * prefetches adjacent chunks for smooth scrubbing, and computes the active telemetry point.
 *
 * @example
 * ```tsx
 * const {
 *   currentTime,
 *   setCurrentTime,
 *   activePoint,
 *   isPlaying,
 *   togglePlay,
 * } = useTripReplay({ tripId: 1 });
 * ```
 */
export function useTripReplay(
  tripIdOrOptions: number | null | undefined | UseTripReplayOptions
): UseTripReplayReturn {
  const options: UseTripReplayOptions =
    typeof tripIdOrOptions === 'object' && tripIdOrOptions !== null
      ? tripIdOrOptions
      : { tripId: tripIdOrOptions };

  const {
    tripId,
    duration = DEFAULT_DURATION,
    initialTime = 0,
    chunkSize = CHUNK_SIZE,
    autoPlay = false,
    initialPlaybackSpeed = 1,
  } = options;

  // 1. Clamp helper to ensure time stays strictly within [0, duration]
  const clampTime = useCallback(
    (time: number): number => {
      if (Number.isNaN(time)) return 0;
      return Math.max(0, Math.min(duration, time));
    },
    [duration]
  );

  // 2. Playback state
  const [currentTime, setCurrentTimeState] = useState<number>(() =>
    clampTime(initialTime)
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(autoPlay);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(initialPlaybackSpeed);

  // Safe setter with clamping and updater function support
  const setCurrentTime = useCallback(
    (action: number | ((prev: number) => number)) => {
      setCurrentTimeState((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        return clampTime(next);
      });
    },
    [clampTime]
  );

  // 3. Window calculation (e.g. 0-600, 600-1200)
  const chunkIndex = Math.floor(currentTime / chunkSize);
  const fromT = chunkIndex * chunkSize;
  const toT = Math.min(fromT + chunkSize, duration);

  // 4. Fetch telemetry chunk via TanStack Query
  const queryClient = useQueryClient();

  const query = useQuery<TelemetryWindow, ApiError>({
    queryKey: ['telemetry', tripId, chunkIndex],
    queryFn: () => {
      if (!tripId) {
        throw new Error('Trip ID is required to fetch telemetry');
      }
      return fetchTelemetry(tripId, fromT, toT);
    },
    enabled: typeof tripId === 'number' && tripId > 0,
    // Telemetry historical data never changes: cache permanently
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30, // 30 minutes cache retention
  });

  // 5. Intelligent prefetching of adjacent chunks for buttery-smooth scrubbing
  useEffect(() => {
    if (typeof tripId !== 'number' || tripId <= 0) return;

    // Prefetch next chunk
    const nextChunkIndex = chunkIndex + 1;
    const nextFromT = nextChunkIndex * chunkSize;
    if (nextFromT < duration) {
      const nextToT = Math.min(nextFromT + chunkSize, duration);
      queryClient.prefetchQuery({
        queryKey: ['telemetry', tripId, nextChunkIndex],
        queryFn: () => fetchTelemetry(tripId, nextFromT, nextToT),
        staleTime: Infinity,
      });
    }

    // Prefetch previous chunk if scrubbing backward
    const prevChunkIndex = chunkIndex - 1;
    if (prevChunkIndex >= 0) {
      const prevFromT = prevChunkIndex * chunkSize;
      const prevToT = Math.min(prevFromT + chunkSize, duration);
      queryClient.prefetchQuery({
        queryKey: ['telemetry', tripId, prevChunkIndex],
        queryFn: () => fetchTelemetry(tripId, prevFromT, prevToT),
        staleTime: Infinity,
      });
    }
  }, [tripId, chunkIndex, chunkSize, duration, queryClient]);

  // 6. Find current active point matching currentTime
  const activePoint = useMemo<TelemetryPoint | null>(() => {
    const samples = query.data?.samples;
    if (!samples || samples.length === 0) return null;

    const targetT = Math.floor(currentTime);

    // Fast O(1) path: contiguous 1 Hz data where index = targetT - fromT
    const directIdx = targetT - fromT;
    if (
      directIdx >= 0 &&
      directIdx < samples.length &&
      samples[directIdx]?.t === targetT
    ) {
      return samples[directIdx];
    }

    // Binary search for exact match or closest previous point (t <= targetT)
    let low = 0;
    let high = samples.length - 1;
    let closestBefore: TelemetryPoint | null = null;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const sample = samples[mid];
      if (sample.t === targetT) {
        return sample;
      }
      if (sample.t < targetT) {
        closestBefore = sample;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return closestBefore ?? samples[0] ?? null;
  }, [query.data?.samples, currentTime, fromT]);

  // 7. Playback animation loop
  const isPlayingRef = useRef(isPlaying);
  const playbackSpeedRef = useRef(playbackSpeed);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (!isPlaying) return;

    let lastTimestamp = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const deltaSec = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      setCurrentTimeState((prev) => {
        const nextTime = prev + deltaSec * playbackSpeedRef.current;
        if (nextTime >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return nextTime;
      });

      if (isPlayingRef.current) {
        frameId = requestAnimationFrame(tick);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, duration]);

  // 8. Control actions
  const seekTo = useCallback(
    (time: number) => {
      setCurrentTime(time);
    },
    [setCurrentTime]
  );

  const stepForward = useCallback(
    (seconds = 1) => {
      setCurrentTime((prev) => prev + seconds);
    },
    [setCurrentTime]
  );

  const stepBackward = useCallback(
    (seconds = 1) => {
      setCurrentTime((prev) => prev - seconds);
    },
    [setCurrentTime]
  );

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((prev) => !prev), []);

  return {
    currentTime,
    duration,
    setCurrentTime,
    seekTo,
    stepForward,
    stepBackward,

    chunkIndex,
    fromT,
    toT,
    chunkSize,

    currentPoint: activePoint,
    activePoint,
    samples: query.data?.samples ?? [],
    telemetryWindow: query.data,

    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,

    isPlaying,
    setIsPlaying,
    play,
    pause,
    togglePlay,
    playbackSpeed,
    setPlaybackSpeed,
  };
}

export default useTripReplay;
