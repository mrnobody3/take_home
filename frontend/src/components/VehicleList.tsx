import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Truck,
  Search,
  RotateCw,
  AlertCircle,
  Calendar,
  Building2,
  ChevronRight,
  Route,
  Play,
  Clock,
} from 'lucide-react';
import { listVehicles, listVehicleTrips, Vehicle, Trip, ApiError } from '../api';
import { formatDate, formatDuration } from '../utils/formatters';

export interface VehicleListProps {
  onSelectVehicle?: (vehicle: Vehicle) => void;
  onSelectTrip?: (vehicle: Vehicle, trip: Trip) => void;
  selectedVehicleId?: number | null;
}

export const VehicleList: React.FC<VehicleListProps> = ({
  onSelectVehicle,
  onSelectTrip,
  selectedVehicleId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Vehicles Query
  const {
    data: vehicles,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<Vehicle[], ApiError>({
    queryKey: ['vehicles'],
    queryFn: listVehicles,
  });

  // Selected vehicle object
  const activeVehicle = useMemo(() => {
    if (!vehicles || !selectedVehicleId) return null;
    return vehicles.find((v) => v.id === selectedVehicleId) ?? null;
  }, [vehicles, selectedVehicleId]);

  // 2. Trips Query for Selected Vehicle
  const {
    data: trips,
    isLoading: isLoadingTrips,
    isError: isTripsError,
    error: tripsError,
    refetch: refetchTrips,
  } = useQuery<Trip[], ApiError>({
    queryKey: ['vehicle-trips', selectedVehicleId],
    queryFn: () => {
      if (!selectedVehicleId) throw new Error('Vehicle ID is required');
      return listVehicleTrips(selectedVehicleId);
    },
    enabled: typeof selectedVehicleId === 'number' && selectedVehicleId > 0,
  });

  const filteredVehicles = useMemo(() => {
    if (!vehicles) return [];
    if (!searchQuery.trim()) return vehicles;
    const q = searchQuery.toLowerCase().trim();
    return vehicles.filter(
      (v) =>
        v.plate.toLowerCase().includes(q) ||
        v.depot.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        v.carrier_name.toLowerCase().includes(q)
    );
  }, [vehicles, searchQuery]);

  return (
    <div className="space-y-6">
      {/* VEHICLES INVENTORY TABLE */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Top Toolbar */}
        <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  Vehicles
                  {vehicles && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {vehicles.length}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-slate-400">
                  Select a vehicle to inspect trips and launch 24h telemetry replay
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search box */}
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by plate, depot, carrier…"
                className="w-full pl-9 pr-3.5 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              />
            </div>

            {/* Refresh button */}
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh vehicles"
              className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCw
                className={`w-4 h-4 ${isFetching ? 'animate-spin text-indigo-400' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="overflow-x-auto">
          {/* Loading State */}
          {isLoading && (
            <div className="p-8">
              <div className="space-y-3">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-14 bg-slate-800/40 border border-slate-800/80 rounded-xl animate-pulse"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Error State */}
          {isError && (
            <div className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 mb-3">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">
                Failed to load vehicles
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mb-4">
                {error?.detail ||
                  error?.message ||
                  'Network error occurred while fetching fleet list.'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Try Again
              </button>
            </div>
          )}

          {/* Table View */}
          {!isLoading && !isError && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40 uppercase tracking-wider font-semibold text-[11px]">
                  <th className="py-3 px-4">License Plate</th>
                  <th className="py-3 px-4">Model</th>
                  <th className="py-3 px-4">Depot</th>
                  <th className="py-3 px-4">Carrier</th>
                  <th className="py-3 px-4 text-center">Trips</th>
                  <th className="py-3 px-4">Latest Trip</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredVehicles.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="font-medium text-slate-400">No vehicles found</p>
                      {searchQuery ? (
                        <p className="text-[11px] mt-0.5">
                          Try adjusting your search criteria
                        </p>
                      ) : (
                        <p className="text-[11px] mt-0.5">
                          No vehicles assigned to this account
                        </p>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredVehicles.map((vehicle) => {
                    const isSelected = selectedVehicleId === vehicle.id;
                    return (
                      <tr
                        key={vehicle.id}
                        onClick={() => onSelectVehicle?.(vehicle)}
                        className={`group cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-indigo-600/15 border-l-2 border-indigo-500'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        {/* License Plate Badge */}
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-400/10 border border-amber-400/25 text-amber-300 font-mono font-bold text-xs tracking-wider shadow-sm">
                            {vehicle.plate}
                          </span>
                        </td>

                        {/* Model */}
                        <td className="py-3 px-4 text-slate-200 font-medium">
                          {vehicle.model}
                        </td>

                        {/* Depot */}
                        <td className="py-3 px-4 text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-slate-500" />
                            {vehicle.depot}
                          </span>
                        </td>

                        {/* Carrier */}
                        <td className="py-3 px-4 text-slate-300">
                          <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-slate-300 border border-slate-700/60">
                            {vehicle.carrier_name}
                          </span>
                        </td>

                        {/* Trip Count */}
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                              vehicle.trip_count > 0
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-slate-800 text-slate-500'
                            }`}
                          >
                            <Route className="w-3 h-3" />
                            {vehicle.trip_count}
                          </span>
                        </td>

                        {/* Latest Trip */}
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            {formatDate(vehicle.last_trip_at)}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectVehicle?.(vehicle);
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-sm'
                                  : 'text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700'
                              }`}
                            >
                              <span>Trips</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* TRIPS LIST FOR SELECTED VEHICLE */}
      {activeVehicle && (
        <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl shadow-xl overflow-hidden p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-amber-300 bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 rounded text-xs">
                  {activeVehicle.plate}
                </span>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Available Shifts & Trips
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeVehicle.model} • Depot: {activeVehicle.depot} (
                {activeVehicle.carrier_name})
              </p>
            </div>
            <span className="text-xs text-slate-400 font-medium">
              Click &quot;Replay Trip&quot; to test timeline scrubbing
            </span>
          </div>

          {isLoadingTrips ? (
            <div className="p-6 text-center text-xs text-slate-400">
              <span className="inline-block w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mr-2"></span>
              Loading trips for {activeVehicle.plate}…
            </div>
          ) : isTripsError ? (
            <div className="p-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-between">
              <span>
                Failed to load trips for vehicle #{activeVehicle.id} (
                {tripsError instanceof Error ? tripsError.message : 'Error'}).
              </span>
              <button
                type="button"
                onClick={() => refetchTrips()}
                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium transition-colors"
              >
                Retry
              </button>
            </div>
          ) : !trips || trips.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No recorded trips for this vehicle yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {trips.map((trip) => (
                <div
                  key={trip.id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all group"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Route className="w-3.5 h-3.5 text-indigo-400" />
                        Trip #{trip.id}
                      </span>
                      <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                        24h Shift
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>Start: {formatDate(trip.start_time)}</span>
                    </div>

                    <div className="text-xs text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>Duration: {formatDuration(trip.duration_seconds)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectTrip?.(activeVehicle, trip)}
                    className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/30 transition-all"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Replay Trip (Open Scrubber)</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehicleList;
