import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Truck, LogOut, ShieldCheck, UserCheck, ChevronRight } from 'lucide-react';
import {
  CurrentUser,
  getStoredUser,
  clearStoredAuth,
  getCurrentUser,
  Vehicle,
  Trip,
} from './api';
import LoginForm from './components/LoginForm';
import VehicleList from './components/VehicleList';
import TripReplayView from './components/TripReplayView';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(() =>
    getStoredUser()
  );
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);

  useEffect(() => {
    // Validate session on mount if token exists
    const stored = getStoredUser();
    if (stored) {
      getCurrentUser()
        .then((user) => setCurrentUser(user))
        .catch(() => {
          clearStoredAuth();
          setCurrentUser(null);
        });
    }
  }, []);

  const queryClient = useQueryClient();

  const handleLogout = useCallback(() => {
    clearStoredAuth();
    queryClient.clear();
    setCurrentUser(null);
    setSelectedVehicle(null);
    setSelectedTrip(null);
  }, [queryClient]);

  useEffect(() => {
    const onUnauthorized = () => {
      handleLogout();
    };
    window.addEventListener('auth:unauthorized', onUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', onUnauthorized);
  }, [handleLogout]);

  const handleSelectTrip = (vehicle: Vehicle, trip: Trip) => {
    setSelectedVehicle(vehicle);
    setSelectedTrip(trip);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/30">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white text-base">
                  Waypoint
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  Fleet MVP
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-none mt-0.5">
                Telemetry & Replay
              </p>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <div className="flex items-center gap-1.5 justify-end text-xs font-semibold text-slate-200">
                  {currentUser.role === 'PLATFORM_STAFF' ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>{currentUser.email}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {currentUser.role === 'PLATFORM_STAFF'
                    ? 'Platform Staff'
                    : `Carrier ID #${currentUser.carrier_id}`}
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!currentUser ? (
          <div className="pt-6 sm:pt-12">
            <LoginForm onSuccess={(user) => setCurrentUser(user)} />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 border border-slate-800/80 px-4 py-2.5 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setSelectedTrip(null);
                  setSelectedVehicle(null);
                }}
                className={`hover:text-white transition-colors ${
                  !selectedVehicle ? 'text-indigo-400 font-bold' : ''
                }`}
              >
                Fleet Vehicles
              </button>

              {selectedVehicle && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  <button
                    type="button"
                    onClick={() => setSelectedTrip(null)}
                    className={`hover:text-white transition-colors ${
                      !selectedTrip ? 'text-indigo-400 font-bold' : ''
                    }`}
                  >
                    Vehicle {selectedVehicle.plate}
                  </button>
                </>
              )}

              {selectedTrip && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
                  <span className="text-amber-400 font-bold">
                    Trip #{selectedTrip.id} Replay (24h)
                  </span>
                </>
              )}
            </div>

            {/* View Switching: Trip Replay vs Vehicle List */}
            {selectedTrip ? (
              <TripReplayView
                tripId={selectedTrip.id}
                vehiclePlate={selectedVehicle?.plate}
                vehicleModel={selectedVehicle?.model}
                onClose={() => setSelectedTrip(null)}
              />
            ) : (
              <VehicleList
                selectedVehicleId={selectedVehicle?.id ?? null}
                onSelectVehicle={(vehicle) => setSelectedVehicle(vehicle)}
                onSelectTrip={handleSelectTrip}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
