import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import { useQuery } from '@tanstack/react-query';
import {
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Rewind,
  Navigation,
  Gauge,
  Fuel,
  Clock,
  Layers,
  Crosshair,
  BarChart2,
  Activity,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  RotateCw,
} from 'lucide-react';
import { useTripReplay, ZOOM_LEVELS } from '../hooks/useTripReplay';
import { fetchTripSummary, TelemetryWindow, ApiError } from '../api';
import {
  formatSeconds,
  formatSpeed,
  formatFuel,
  formatCoordinates,
} from '../utils/formatters';

export interface TripReplayViewProps {
  /** ID of the trip being replayed */
  tripId: number;
  /** Optional vehicle license plate for display header */
  vehiclePlate?: string;
  /** Optional vehicle model */
  vehicleModel?: string;
  /** Optional callback to close or return to vehicle list */
  onClose?: () => void;
}

/** Custom glowing Leaflet marker icon for vehicle position */
const vehicleMarkerIcon = L.divIcon({
  className: 'custom-vehicle-marker-wrapper',
  html: `
    <div style="
      width: 28px;
      height: 28px;
      background: #4f46e5;
      border: 3px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.9), 0 2px 8px rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    ">
      <div style="width: 8px; height: 8px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/** Start of window pin icon */
const startMarkerIcon = L.divIcon({
  className: 'start-marker-icon',
  html: `
    <div style="
      width: 12px;
      height: 12px;
      background: #10b981;
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
    "></div>
  `,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

/** Subcomponent to synchronize map view with vehicle coordinate when followMode is active */
const MapController: React.FC<{
  center: [number, number] | null;
  bounds: [number, number][] | null;
  follow: boolean;
}> = ({ center, bounds, follow }) => {
  const map = useMap();
  const lastChunkRef = useRef<string | null>(null);

  // Recenter map on active coordinate when follow is enabled
  useEffect(() => {
    if (follow && center) {
      map.panTo(center, { animate: true, duration: 0.25 });
    }
  }, [center, follow, map]);

  // Fit bounds when a new chunk arrives
  useEffect(() => {
    if (bounds && bounds.length > 1) {
      const boundsKey = `${bounds[0][0]},${bounds[0][1]}-${bounds[bounds.length - 1][0]}`;
      if (lastChunkRef.current !== boundsKey && !follow) {
        lastChunkRef.current = boundsKey;
        const latLngBounds = L.latLngBounds(bounds.map(([lat, lon]) => [lat, lon]));
        map.fitBounds(latLngBounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  }, [bounds, follow, map]);

  return null;
};

export const TripReplayView: React.FC<TripReplayViewProps> = ({
  tripId,
  vehiclePlate,
  vehicleModel,
  onClose,
}) => {
  const TOTAL_DURATION = 86400; // 24 hours
  const CHUNK_SIZE = 600; // 10 minutes default

  // 1. Core Scrubbing & Window Hook with Zoom & Debounce
  const {
    currentTime,
    setCurrentTime,
    duration,
    chunkIndex,
    totalChunks,
    fromT,
    toT,
    zoomLevel,
    setZoomLevel,
    zoomIn,
    zoomOut,
    activePoint,
    samples,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    isPlaying,
    togglePlay,
    seekTo,
    stepForward,
    stepBackward,
    playbackSpeed,
    setPlaybackSpeed,
  } = useTripReplay({
    tripId,
    duration: TOTAL_DURATION,
    chunkSize: CHUNK_SIZE,
  });

  // 2. Fetch Macro-level 24h Summary Telemetry (downsampled step=30, ~2880 points)
  const {
    data: summaryData,
    isLoading: isSummaryLoading,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<TelemetryWindow, ApiError>({
    queryKey: ['telemetry-summary', tripId],
    queryFn: () => fetchTripSummary(tripId, TOTAL_DURATION, 30),
    staleTime: Infinity,
    enabled: typeof tripId === 'number' && tripId > 0,
  });

  const [followVehicle, setFollowVehicle] = useState(true);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const summaryChartContainerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);

  // Responsive chart width measurement
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setChartWidth(Math.floor(entry.contentRect.width));
      }
    });

    observer.observe(el);
    setChartWidth(el.clientWidth || 800);

    return () => observer.disconnect();
  }, []);

  // --- Detailed Chunk Speed Chart (uPlot) ---
  const chunkUPlotData = useMemo<uPlot.AlignedData>(() => {
    if (samples.length === 0) {
      return [
        [fromT, toT],
        [0, 0],
      ];
    }
    const x = samples.map((s) => s.t);
    const y = samples.map((s) => s.speed_kph);
    return [x, y];
  }, [samples, fromT, toT]);

  const chunkUPlotOptions = useMemo<uPlot.Options>(() => {
    return {
      width: chartWidth,
      height: 140,
      cursor: {
        drag: { x: false, y: false },
        sync: { key: 'replay' },
      },
      scales: {
        x: {
          time: false,
          min: fromT,
          max: toT,
        },
        y: {
          auto: true,
          range: [0, 110],
        },
      },
      series: [
        {
          label: 'Time',
          value: (_u, v) =>
            v != null ? `${formatSeconds(v)} (${Math.round(v)}s)` : '--',
        },
        {
          label: 'Speed',
          stroke: '#6366f1',
          width: 2,
          fill: 'rgba(99, 102, 241, 0.15)',
          value: (_u, v) => (v != null ? formatSpeed(v) : '--'),
        },
      ],
      axes: [
        {
          stroke: '#94a3b8',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#334155', width: 1 },
          font: '10px Inter, sans-serif',
          values: (_u, vals) => vals.map((v) => `${Math.round(v)}s`),
        },
        {
          stroke: '#94a3b8',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#334155', width: 1 },
          font: '10px Inter, sans-serif',
          values: (_u, vals) => vals.map((v) => `${v}`),
        },
      ],
    };
  }, [chartWidth, fromT, toT]);

  // --- 24-Hour Summary Overview Chart (uPlot) ---
  const summaryUPlotData = useMemo<uPlot.AlignedData>(() => {
    const summarySamples = summaryData?.samples;
    if (!summarySamples || summarySamples.length === 0) {
      return [
        [0, TOTAL_DURATION],
        [0, 0],
      ];
    }
    const x = summarySamples.map((s) => s.t);
    const y = summarySamples.map((s) => s.speed_kph);
    return [x, y];
  }, [summaryData, TOTAL_DURATION]);

  const summaryUPlotOptions = useMemo<uPlot.Options>(() => {
    return {
      width: chartWidth,
      height: 90,
      cursor: {
        drag: { x: false, y: false },
      },
      scales: {
        x: {
          time: false,
          min: 0,
          max: TOTAL_DURATION,
        },
        y: {
          auto: true,
          range: [0, 110],
        },
      },
      series: [
        {
          label: 'Day Time',
          value: (_u, v) => (v != null ? `${formatSeconds(v)}` : '--'),
        },
        {
          label: '24h Speed',
          stroke: '#a855f7',
          width: 1.5,
          fill: 'rgba(168, 85, 247, 0.12)',
          value: (_u, v) => (v != null ? formatSpeed(v) : '--'),
        },
      ],
      axes: [
        {
          stroke: '#94a3b8',
          grid: { stroke: '#1e293b', width: 1 },
          ticks: { stroke: '#334155', width: 1 },
          font: '10px Inter, sans-serif',
          values: (_u, vals) => vals.map((v) => `${Math.round(v / 3600)}h`),
        },
        {
          show: false,
        },
      ],
    };
  }, [chartWidth, TOTAL_DURATION]);

  // Handle click on the summary chart to jump timeline
  const handleSummaryClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetT = Math.floor(ratio * TOTAL_DURATION);
    seekTo(targetT);
  };

  // Map coordinates
  const polylineCoords = useMemo<[number, number][]>(() => {
    return samples.map((s) => [s.lat, s.lon]);
  }, [samples]);

  const activeCoord = useMemo<[number, number] | null>(() => {
    if (!activePoint) return null;
    return [activePoint.lat, activePoint.lon];
  }, [activePoint]);

  // Default fallback center: Amsterdam delivery zone (from fleet-sample.json)
  const defaultCenter: [number, number] = useMemo(() => {
    if (activeCoord) return activeCoord;
    if (polylineCoords.length > 0) return polylineCoords[0];
    return [52.3702, 4.8952];
  }, [activeCoord, polylineCoords]);

  // Calculate window position percentages on the 24h summary timeline
  const windowLeftPct = (fromT / TOTAL_DURATION) * 100;
  const windowWidthPct = Math.min(
    100 - windowLeftPct,
    ((toT - fromT) / TOTAL_DURATION) * 100
  );
  const needlePct = Math.min(100, Math.max(0, (currentTime / TOTAL_DURATION) * 100));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col space-y-4 p-5">
      {/* 1. Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
              title="Return to vehicle list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="p-2.5 bg-indigo-600/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                Trip Replay #{tripId}
              </h2>
              {vehiclePlate && (
                <span className="font-mono text-xs font-bold text-amber-300 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded">
                  {vehiclePlate}
                </span>
              )}
              {vehicleModel && (
                <span className="text-xs text-slate-400 hidden sm:inline">
                  • {vehicleModel}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Scrubbing 24h trip with bidirectional zoom & TanStack Query caching
            </p>
          </div>
        </div>

        {/* Telemetry quick badges */}
        <div className="flex items-center gap-3">
          {/* Speed Gauge */}
          <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-xl">
            <Gauge className="w-4 h-4 text-indigo-400" />
            <div>
              <div className="text-[10px] text-slate-500 font-semibold uppercase leading-none">
                Speed
              </div>
              <div className="text-xs font-mono font-bold text-indigo-300">
                {formatSpeed(activePoint?.speed_kph)}
              </div>
            </div>
          </div>

          {/* Fuel Level */}
          <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-xl">
            <Fuel className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] text-slate-500 font-semibold uppercase leading-none">
                Fuel
              </div>
              <div className="text-xs font-mono font-bold text-emerald-300">
                {formatFuel(activePoint?.fuel_pct)}
              </div>
            </div>
          </div>

          {/* Active Time */}
          <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-xl">
            <Clock className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-[10px] text-slate-500 font-semibold uppercase leading-none">
                Current Time
              </div>
              <div className="text-xs font-mono font-bold text-amber-300">
                {formatSeconds(currentTime)}
              </div>
            </div>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* 2. 24-HOUR OVERVIEW / SUMMARY GRAPH */}
      <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-2 font-semibold text-purple-300">
            <BarChart2 className="w-3.5 h-3.5 text-purple-400" />
            <span>24-Hour Trip Overview (Summary) — Click anywhere to jump</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            {isSummaryLoading ? (
              <span className="text-purple-400 animate-pulse">Loading summary…</span>
            ) : isSummaryError ? (
              <span className="text-rose-400">Failed to load summary</span>
            ) : (
              <span>{summaryData?.samples.length ?? 0} points (step=30)</span>
            )}
          </div>
        </div>

        {/* Summary Chart with Highlight Window Overlay */}
        <div
          ref={summaryChartContainerRef}
          onClick={handleSummaryClick}
          className="w-full h-[95px] overflow-hidden rounded-lg bg-slate-900/60 border border-slate-800/50 relative cursor-pointer group"
          title="Click to jump to that timestamp in the 24-hour day"
        >
          {isSummaryError ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-rose-400 gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Failed to load 24h summary (
                {summaryError instanceof Error ? summaryError.message : 'Error'}).
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void refetchSummary();
                }}
                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium"
              >
                Retry
              </button>
            </div>
          ) : isSummaryLoading ? (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
              <span className="w-3 h-3 rounded-full border-2 border-purple-400 border-t-transparent animate-spin mr-2"></span>
              Loading 24h summary overview…
            </div>
          ) : (
            <>
              <UplotReact options={summaryUPlotOptions} data={summaryUPlotData} />

              {/* Highlight box representing the active zoomed window */}
              <div
                style={{
                  left: `${windowLeftPct}%`,
                  width: `${Math.max(0.5, windowWidthPct)}%`,
                }}
                className="absolute top-0 bottom-0 bg-indigo-500/25 border-x-2 border-indigo-400 pointer-events-none transition-all duration-100"
              />

              {/* Exact playhead cursor needle on the 24h timeline */}
              <div
                style={{ left: `${needlePct}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)] pointer-events-none"
              />
            </>
          )}
        </div>
      </div>

      {/* 3. TIMELINE SCRUBBER & CONTROLS */}
      <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-amber-300">
              {formatSeconds(currentTime)}
            </span>
            <span className="text-slate-500">/</span>
            <span className="font-mono text-xs">{formatSeconds(duration)}</span>
            <span className="text-[11px] font-mono text-slate-500">
              ({Math.floor(currentTime)}s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-indigo-400 font-medium">
              <Layers className="w-3 h-3" />
              Window #{chunkIndex + 1}/{totalChunks} ({fromT}s – {toT}s)
            </span>
            {isFetching && (
              <span className="text-[11px] text-amber-400 animate-pulse font-medium flex items-center gap-1">
                <RotateCw className="w-3 h-3 animate-spin" />
                Fetching window…
              </span>
            )}
          </div>
        </div>

        {/* Scrubber Range Slider (0 to 86400) */}
        <div className="space-y-1">
          <div className="relative flex items-center py-1">
            <input
              type="range"
              min={0}
              max={TOTAL_DURATION}
              step={1}
              value={Math.floor(currentTime)}
              onChange={(e) => setCurrentTime(Number(e.target.value))}
              className="w-full h-2.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              title={`Scrub position: ${formatSeconds(currentTime)} (${Math.floor(currentTime)}s)`}
            />
          </div>

          {/* Quick jump timestamp marks */}
          <div className="flex justify-between text-[10px] text-slate-500 font-mono px-1">
            <button
              type="button"
              onClick={() => seekTo(0)}
              className="hover:text-indigo-400 transition-colors"
            >
              00:00 (Start)
            </button>
            <button
              type="button"
              onClick={() => seekTo(21600)}
              className="hover:text-indigo-400 transition-colors"
            >
              06:00
            </button>
            <button
              type="button"
              onClick={() => seekTo(43200)}
              className="text-amber-400 font-bold hover:text-amber-300 transition-colors bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20"
              title="Jump to midday (43,200s)"
            >
              12:00 (Midday)
            </button>
            <button
              type="button"
              onClick={() => seekTo(64800)}
              className="hover:text-indigo-400 transition-colors"
            >
              18:00
            </button>
            <button
              type="button"
              onClick={() => seekTo(86400)}
              className="hover:text-indigo-400 transition-colors"
            >
              24:00 (End)
            </button>
          </div>
        </div>

        {/* Playback Buttons, Speeds & Quick Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            {/* Rewind 10s */}
            <button
              type="button"
              onClick={() => stepBackward(10)}
              title="Rewind 10s"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <Rewind className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
              type="button"
              onClick={togglePlay}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all shadow-md ${
                isPlaying
                  ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/20'
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
              }`}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>

            {/* Fast Forward 10s */}
            <button
              type="button"
              onClick={() => stepForward(10)}
              title="Fast Forward 10s"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors"
            >
              <FastForward className="w-4 h-4" />
            </button>

            {/* Reset to Start */}
            <button
              type="button"
              onClick={() => seekTo(0)}
              title="Reset to 0s"
              className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>

          {/* Speed Multipliers */}
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 p-1 rounded-lg">
            <span className="text-[11px] text-slate-500 px-1.5 font-medium">Speed:</span>
            {[1, 2, 5, 10, 30, 60].map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setPlaybackSpeed(spd)}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                  playbackSpeed === spd
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. CURRENT WINDOW SPEED CHART (uPlot - 1 Hz with Zoom) */}
      <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
          <div className="flex items-center gap-2 font-semibold text-slate-300">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Speed Profile — Window ({fromT}s – {toT}s at 1 Hz)
            </span>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
              <span className="text-[10px] text-slate-500 font-semibold px-1.5 uppercase">
                Zoom:
              </span>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoomLevel <= 60}
                title="Zoom in (narrower window)"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setZoomLevel(level)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    zoomLevel === level
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {level < 3600 ? `${level / 60}m` : '1h'}
                </button>
              ))}
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoomLevel >= 3600}
                title="Zoom out (wider window)"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {samples.length} points
            </span>
          </div>
        </div>

        {/* Chart View with Error Handling & Persistent Samples */}
        <div
          ref={chartContainerRef}
          className="w-full h-[145px] overflow-hidden flex items-center justify-center rounded-lg bg-slate-900/50 border border-slate-800/40 relative"
        >
          {isError ? (
            <div className="text-xs text-rose-400 flex items-center gap-2 p-4">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Failed to load telemetry window (
                {error instanceof Error ? error.message : 'Error'}).
              </span>
              <button
                type="button"
                onClick={() => refetch()}
                className="ml-2 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          ) : isLoading && samples.length === 0 ? (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></span>
              Loading telemetry window…
            </div>
          ) : (
            <>
              <UplotReact options={chunkUPlotOptions} data={chunkUPlotData} />
              {isFetching && (
                <div className="absolute top-2 right-2 bg-slate-900/85 backdrop-blur border border-slate-700/80 px-2 py-0.5 rounded-full text-[10px] text-amber-300 flex items-center gap-1 pointer-events-none shadow">
                  <RotateCw className="w-2.5 h-2.5 animate-spin" />
                  Updating window…
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 5. REACT-LEAFLET MAP INTEGRATION */}
      <div className="bg-slate-950/90 border border-slate-800/80 rounded-xl overflow-hidden space-y-2 p-3">
        <div className="flex items-center justify-between text-xs px-1 pb-1">
          <div className="flex items-center gap-2 font-semibold text-slate-300">
            <Navigation className="w-3.5 h-3.5 text-indigo-400" />
            <span>Delivery Route Map (Current Window Polyline)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Follow Vehicle Toggle */}
            <button
              type="button"
              onClick={() => setFollowVehicle((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                followVehicle
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>{followVehicle ? 'Auto-follow ON' : 'Auto-follow OFF'}</span>
            </button>

            {activeCoord && (
              <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                {formatCoordinates(activeCoord[0], activeCoord[1])}
              </span>
            )}
          </div>
        </div>

        {/* Map Container */}
        <div className="w-full h-[380px] rounded-lg overflow-hidden border border-slate-800 relative z-0">
          <MapContainer
            center={defaultCenter}
            zoom={14}
            scrollWheelZoom={true}
            className="w-full h-full"
          >
            {/* OpenStreetMap Dark CartoDB Tiles */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Sync map pan/zoom with active position */}
            <MapController
              center={activeCoord}
              bounds={polylineCoords}
              follow={followVehicle}
            />

            {/* Polyline of points in the current window */}
            {polylineCoords.length > 0 && (
              <Polyline
                positions={polylineCoords}
                pathOptions={{
                  color: '#4f46e5',
                  weight: 4,
                  opacity: 0.85,
                  lineJoin: 'round',
                  lineCap: 'round',
                }}
              />
            )}

            {/* Chunk start marker */}
            {polylineCoords.length > 0 && (
              <Marker position={polylineCoords[0]} icon={startMarkerIcon}>
                <Popup>
                  <div className="text-xs font-sans text-slate-900">
                    <div className="font-bold">Window Start</div>
                    <div>t = {fromT}s</div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Active Vehicle Coordinate Marker */}
            {activeCoord && (
              <Marker position={activeCoord} icon={vehicleMarkerIcon}>
                <Popup>
                  <div className="text-xs font-sans text-slate-900 space-y-1">
                    <div className="font-bold text-indigo-700">
                      {vehiclePlate || `Trip #${tripId}`}
                    </div>
                    <div>
                      t = {activePoint?.t}s ({formatSeconds(currentTime)})
                    </div>
                    <div>Speed: {formatSpeed(activePoint?.speed_kph)}</div>
                    <div>Fuel: {formatFuel(activePoint?.fuel_pct)}</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {formatCoordinates(activeCoord[0], activeCoord[1])}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
      </div>
    </div>
  );
};

export default TripReplayView;
