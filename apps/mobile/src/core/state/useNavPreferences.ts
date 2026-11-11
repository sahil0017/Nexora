import { create } from 'zustand';
import type { OptimizeFor } from '../api/move';

export type MapViewMode = '3D' | '2D' | 'North';
export type SoundAlertMode = 'all' | 'alerts' | 'muted';
export type MapStyleMode = 'default' | 'satellite';

export interface MultiObjectiveWeights {
  time: number;
  reliability: number;
  cost: number;
  walk: number;
}

export interface NavPreferencesState {
  viewMode: MapViewMode;
  soundMode: SoundAlertMode;
  mapStyle: MapStyleMode;
  showIncidents: boolean;
  showTraffic: boolean;
  show3DBuildings: boolean;
  showWeather: boolean;
  defaultMode: string;
  optimizeFor: OptimizeFor;
  avoidTolls: boolean;
  avoidHazards: boolean;
  meaningfulAlertsOnly: boolean;
  maxWalkingMinutes: number;
  weights: MultiObjectiveWeights;
  setViewMode: (viewMode: MapViewMode) => void;
  setSoundMode: (soundMode: SoundAlertMode) => void;
  setMapStyle: (mapStyle: MapStyleMode) => void;
  toggleIncidents: () => void;
  toggleTraffic: () => void;
  toggle3DBuildings: () => void;
  toggleWeather: () => void;
  setRouteDefaults: (patch: {
    defaultMode?: string;
    optimizeFor?: OptimizeFor;
    avoidTolls?: boolean;
    avoidHazards?: boolean;
    meaningfulAlertsOnly?: boolean;
    maxWalkingMinutes?: number;
    weights?: MultiObjectiveWeights;
  }) => void;
}

/** Persistent in-session navigation, HUD, and routing preferences backing QuickSettingsSheet, MobilityPrefsScreen, and JourneyPlannerScreen. */
export const useNavPreferences = create<NavPreferencesState>(set => ({
  viewMode: '3D',
  soundMode: 'all',
  mapStyle: 'default',
  showIncidents: true,
  showTraffic: true,
  show3DBuildings: true,
  showWeather: false,
  defaultMode: 'car',
  optimizeFor: 'FASTEST',
  avoidTolls: false,
  avoidHazards: true,
  meaningfulAlertsOnly: true,
  maxWalkingMinutes: 15,
  weights: { time: 0.4, reliability: 0.3, cost: 0.2, walk: 0.1 },
  setViewMode: viewMode => set({ viewMode }),
  setSoundMode: soundMode => set({ soundMode }),
  setMapStyle: mapStyle => set({ mapStyle }),
  toggleIncidents: () => set(s => ({ showIncidents: !s.showIncidents })),
  toggleTraffic: () => set(s => ({ showTraffic: !s.showTraffic })),
  toggle3DBuildings: () => set(s => ({ show3DBuildings: !s.show3DBuildings })),
  toggleWeather: () => set(s => ({ showWeather: !s.showWeather })),
  setRouteDefaults: patch => set(s => ({ ...s, ...patch })),
}));
