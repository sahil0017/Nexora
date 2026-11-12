import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { NavMapCanvas, MapManeuver, QuickReportHazardKind } from '../../../shared/components/NavMapCanvas';
import { QuickSettingsSheet } from '../../../shared/components/QuickSettingsSheet';
import { DepartureOptimizerCard } from '../components/DepartureOptimizerCard';
import { RouteComparisonMatrix } from '../components/RouteComparisonMatrix';
import { ExplainableRoutePanel } from '../components/ExplainableRoutePanel';
import { PostTripSummaryCard } from '../components/PostTripSummaryCard';
import {
  Card,
  Input,
  PrimaryButton,
  SectionHeading,
  SegmentedControl,
} from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, radii, spacing } from '../../../app/theme/tokens';
import {
  ActiveTrip,
  MODE_OPTIONS,
  MeaningfulRouteChange,
  OptimizeFor,
  Place,
  RouteAlternative,
  RouteContextPayload,
  TripSummary,
  digitalTwinApi,
  formatDuration,
  modeLabel,
  moveApi,
  moveDataApi,
} from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';
import { useLocation } from '../../../core/location/useLocation';
import { useNavPreferences } from '../../../core/state/useNavPreferences';

const GOALS: Array<{ key: OptimizeFor; label: string }> = [
  { key: 'FASTEST', label: 'Fastest' },
  { key: 'RELIABILITY', label: 'Reliable' },
  { key: 'BALANCED', label: 'Balanced' },
  { key: 'CHEAPEST', label: 'Cheapest' },
];

const WINDOWS = [
  { key: '1', label: '1 hr window' },
  { key: '3', label: '3 hr window' },
  { key: '6', label: '6 hr window' },
] as const;

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// MV-02 Interactive Journey Planner & Turn-by-Turn Navigation HUD.
export default function JourneyPlannerScreen() {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;
  const navPrefs = useNavPreferences();

  const initialDest: Place | null = route.params?.destination ?? null;
  const [text, setText] = useState(initialDest?.name ?? '');
  const [dest, setDest] = useState<Place | null>(initialDest);

  React.useEffect(() => {
    const incoming: Place | undefined = route.params?.destination;
    if (incoming) {
      setDest(incoming);
      setText(incoming.name);
    }
  }, [route.params?.destination, route.params?.nonce]);
  const [stops, setStops] = useState<Place[]>([]);
  const [addingStop, setAddingStop] = useState(false);
  const [stopQuery, setStopQuery] = useState('');
  const [modes, setModes] = useState<string[]>([]);
  const [goal, setGoal] = useState<OptimizeFor>(navPrefs.optimizeFor);
  const [windowHrs, setWindowHrs] = useState<(typeof WINDOWS)[number]['key']>('3');
  const [expandedAltId, setExpandedAltId] = useState<string | null>(null);
  const [selectedAltId, setSelectedAltId] = useState<string | null>(null);
  const [routeViewMode, setRouteViewMode] = useState<'cards' | 'compare'>('cards');
  const [explainTarget, setExplainTarget] = useState<{ alt: RouteAlternative; ctx: RouteContextPayload } | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [fullScreenMap, setFullScreenMap] = useState(false);
  const [fsToolsExpanded, setFsToolsExpanded] = useState(false);
  const [traceRecording, setTraceRecording] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null);

  const loc = useLocation({
    watch: !!activeTrip || fullScreenMap,
    traceEnabled: traceRecording && (!!activeTrip || fullScreenMap),
    distanceIntervalM: 5,
    timeIntervalMs: 2500,
  });
  const [tripStartedMs, setTripStartedMs] = useState<number | null>(null);
  const [tripSyncNote, setTripSyncNote] = useState<string | null>(null);
  const [completedTripId, setCompletedTripId] = useState<string | null>(null);
  const [completedSummary, setCompletedSummary] = useState<{ summary: TripSummary; mode: string } | null>(null);
  const [dismissedChangeKeys, setDismissedChangeKeys] = useState<string[]>([]);
  const [lastAlertAtMs, setLastAlertAtMs] = useState<number>(0);
  const [simulatedDetour, setSimulatedDetour] = useState<MeaningfulRouteChange | null>(null);
  const [rated, setRated] = useState<number | null>(null);
  const [navStepIdx, setNavStepIdx] = useState(0);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [autoDrive, setAutoDrive] = useState(true);
  const [showPlannerDuringNav, setShowPlannerDuringNav] = useState(false);

  const q = useDebounced(text.trim());
  const sq = useDebounced(stopQuery.trim());

  const search = useQuery({
    queryKey: ['place-search', q, loc.point?.latitude, loc.point?.longitude, userId],
    queryFn: () => moveApi.searchPlaces(q, loc.point, userId),
    enabled: q.length >= 2 && !dest,
    retry: 0,
  });

  const stopSearch = useQuery({
    queryKey: ['stop-search', sq, loc.point?.latitude, loc.point?.longitude, userId],
    queryFn: () => moveApi.searchPlaces(sq, loc.point, userId),
    enabled: addingStop && sq.length >= 2,
    retry: 0,
  });

  const hazards = useQuery({
    queryKey: ['hazards-nearby', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.nearbyHazards(loc.point!),
    enabled: !!loc.point,
    retry: 0,
  });

  const traffic = useQuery({
    queryKey: ['traffic-segments', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.trafficSegments(loc.point!, 3000),
    enabled: !!loc.point,
    retry: 0,
  });

  const saved = useQuery({
    queryKey: ['saved-places', userId],
    queryFn: () => moveApi.listSavedPlaces(userId!),
    enabled: !!userId,
    retry: 0,
  });

  const advice = useMutation({ mutationFn: moveDataApi.recommendDeparture });

  const explainRoute = useMutation({
    mutationFn: (vars: { alt: RouteAlternative; ctx: RouteContextPayload }) =>
      moveApi.assistantQuery(
        `Why is ${modeLabel(vars.alt.mode)} route recommended for ${goal.toLowerCase()}?`,
        vars.ctx,
        loc.point,
      ),
  });

  const plan = useMutation({
    mutationFn: moveApi.planJourney,
    onSuccess: res => {
      setExplainTarget(null);
      if (res.alternatives?.length) {
        const first = res.alternatives[0];
        setSelectedAltId(first.route_id);
        setExpandedAltId(first.route_id);
        if (loc.point && dest) {
          advice.mutate({
            origin: loc.point,
            destination: { latitude: dest.latitude, longitude: dest.longitude },
            mode: first.mode.toLowerCase(),
            objective: goal,
            windowHours: Number(windowHrs),
          });
        }
      }
    },
  });

  const scrollToHud = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 60);
  };

  const activateNavigation = (trip: ActiveTrip, note: string | null) => {
    loc.clearTrace();
    setTraceRecording(true);
    setActiveTrip(trip);
    setTripStartedMs(Date.now());
    setTripSyncNote(note);
    setCompletedTripId(null);
    setCompletedSummary(null);
    setDismissedChangeKeys([]);
    setSimulatedDetour(null);
    setLastAlertAtMs(0);
    setRated(null);
    setNavStepIdx(0);
    setAutoDrive(true);
    setShowPlannerDuringNav(false);
    setMapExpanded(true);
    setFullScreenMap(true);
    setFsToolsExpanded(false);
    scrollToHud();
  };

  const startTrip = useMutation({
    mutationFn: async (vars: { routeId: string; mode: string }) => {
      setSelectedAltId(vars.routeId);
      const origin = loc.point ?? (dest ? { latitude: dest.latitude, longitude: dest.longitude } : { latitude: 0, longitude: 0 });
      return moveDataApi.startTrip({
        user_id: userId ?? '00000000-0000-0000-0000-000000000000',
        primary_mode: vars.mode.toLowerCase(),
        origin,
        destination: dest ? { latitude: dest.latitude, longitude: dest.longitude } : undefined,
      });
    },
    onSuccess: async t => {
      activateNavigation(t, null);
      if (loc.point) {
        await moveDataApi.batchLocations(t.id, [loc.point]).catch(() => undefined);
      }
    },
    onError: (_err, vars) => {
      // If cloud trip persistence returns an error (e.g. 502), launch active turn-by-turn HUD on device cleanly.
      const fallbackTrip: ActiveTrip = {
        id: `local-${Date.now()}`,
        user_id: userId ?? 'local-user',
        status: 'active',
        primary_mode: vars.mode.toLowerCase(),
        origin: loc.point ?? (dest ? { latitude: dest.latitude, longitude: dest.longitude } : { latitude: 0, longitude: 0 }),
        destination: dest ? { latitude: dest.latitude, longitude: dest.longitude } : undefined,
      };
      activateNavigation(fallbackTrip, 'On-device navigation active · cloud trip sync unavailable');
    },
  });

  const activeTripId = activeTrip?.id || activeTrip?.trip_id || '';
  const isCloudTrip = !!activeTripId && !activeTripId.startsWith('local-');

  const tripUpdates = useQuery({
    queryKey: ['trip-updates', activeTripId],
    queryFn: () => moveDataApi.tripUpdates(activeTripId),
    enabled: isCloudTrip && activeTrip?.status === 'active',
    refetchInterval: 10_000,
    retry: 0,
  });

  const spatialRadarQuery = useQuery({
    queryKey: ['spatial-radar', loc.point ? Math.round(loc.point.latitude * 200) : null, loc.point ? Math.round(loc.point.longitude * 200) : null],
    queryFn: () => moveDataApi.spatialRadar(loc.point!, 2500),
    enabled: !!loc.point && (fullScreenMap || !!activeTrip),
    refetchInterval: 12_000,
    retry: 0,
  });

  // Auto-flush live GPS breadcrumb samples to /locations:batch + Redis Spatial during active cloud trips
  const uploadedTraceIdxRef = useRef(0);
  React.useEffect(() => {
    uploadedTraceIdxRef.current = 0;
  }, [activeTripId]);

  React.useEffect(() => {
    if (!isCloudTrip || activeTrip?.status !== 'active') return;
    const pendingCount = loc.tracePoints.length - uploadedTraceIdxRef.current;
    if (pendingCount <= 0) return;

    const flush = () => {
      const batch = loc.tracePoints.slice(uploadedTraceIdxRef.current);
      if (batch.length === 0) return;
      uploadedTraceIdxRef.current = loc.tracePoints.length;
      moveDataApi
        .batchLocations(activeTripId, batch)
        .then(() => {
          tripUpdates.refetch();
          spatialRadarQuery.refetch();
        })
        .catch(() => undefined);
    };

    if (pendingCount >= 4) {
      flush();
      return;
    }
    const timer = setTimeout(flush, 7000);
    return () => clearTimeout(timer);
  }, [isCloudTrip, activeTrip?.status, activeTripId, loc.tracePoints]);

  const buildLocalSummary = (mode: string): TripSummary => {
    const distM = selectedAlt?.distance_meters ?? 6400;
    const elapsedS = tripStartedMs ? Math.max(240, Math.round((Date.now() - tripStartedMs) / 1000)) : selectedAlt?.duration_seconds ?? 960;
    const actualS = Math.min(elapsedS, selectedAlt?.duration_seconds ?? elapsedS);
    const baselineS = Math.max(actualS + 300, Math.round((distM / 5.4) * 1.15));
    const savedS = Math.max(0, baselineS - actualS);
    const carCO2 = Math.round((distM / 1000) * 145);
    const modeCO2 = selectedAlt?.co2_grams ?? Math.round((distM / 1000) * 40);
    return {
      actual_duration_seconds: actualS,
      baseline_duration_seconds: baselineS,
      time_saved_seconds: savedS,
      distance_meters: distM,
      estimated_cost_inr: selectedAlt?.estimated_cost.amount ?? 35,
      co2_saved_grams: Math.max(0, carCO2 - modeCO2),
      insights: [
        `Saved ${Math.max(1, Math.round(savedS / 60))} min vs peak solo-car baseline`,
        mode === 'metro' || mode === 'multimodal'
          ? 'Grade-separated rail bypassed arterial congestion hotspots'
          : 'Meaningful-only alerts suppressed minor corridor fluctuations',
      ],
    };
  };

  const completeTrip = useMutation({
    mutationFn: async (tripId: string) => {
      if (!tripId || tripId.startsWith('local-')) {
        return {
          ...activeTrip!,
          id: tripId || `local-${Date.now()}`,
          status: 'completed' as const,
        };
      }
      return moveDataApi.completeTrip(tripId);
    },
    onSuccess: t => {
      const doneId = t.id || t.trip_id || activeTripId;
      const mode = t.primary_mode || activeTrip?.primary_mode || 'car';
      setCompletedSummary({
        mode,
        summary: t.trip_summary ?? buildLocalSummary(mode),
      });
      setActiveTrip(null);
      setTripSyncNote(null);
      setCompletedTripId(doneId);
      setMapExpanded(false);
      setFullScreenMap(false);
      if (doneId && !doneId.startsWith('local-')) {
        qc.invalidateQueries({ queryKey: ['commute-insights', userId] });
      }
    },
    onError: (_err, tripId) => {
      const mode = activeTrip?.primary_mode || 'car';
      setCompletedSummary({ mode, summary: buildLocalSummary(mode) });
      setActiveTrip(null);
      setTripSyncNote(null);
      setCompletedTripId(tripId);
      setMapExpanded(false);
      setFullScreenMap(false);
    },
  });

  const syncTrip = useMutation({
    mutationFn: async (tripId: string) => {
      loc.refresh();
      if (!tripId || tripId.startsWith('local-')) {
        await Promise.all([hazards.refetch(), traffic.refetch()]);
        return activeTrip!;
      }
      if (loc.point) {
        await moveDataApi
          .batchLocations(tripId, [
            {
              ...loc.point,
              speed_mps: loc.speedMps,
              heading_degrees: loc.headingDeg,
              accuracy_meters: loc.accuracyM,
              recorded_at: new Date().toISOString(),
            },
          ])
          .catch(() => undefined);
      }
      spatialRadarQuery.refetch();
      return moveDataApi.getTrip(tripId);
    },
    onSuccess: t => {
      const tid = t.id || t.trip_id || activeTripId;
      setActiveTrip({ ...t, id: tid, trip_id: tid });
      if (tid && !tid.startsWith('local-')) tripUpdates.refetch();
    },
  });

  const quickReport = useMutation({
    mutationFn: (hint_category: 'pothole' | 'waterlogging' | 'blocked_lane' | 'damaged_road') =>
      moveApi.reportHazard({
        user_id: userId,
        latitude: loc.point!.latitude,
        longitude: loc.point!.longitude,
        hint_category,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hazards-nearby'] });
      spatialRadarQuery.refetch();
    },
  });

  const twinQuickReport = useMutation({
    mutationFn: async (kind: QuickReportHazardKind) => {
      if (!loc.point) return;
      if (kind === 'animal_crossing') {
        return digitalTwinApi.reportAnimalSighting({
          latitude: loc.point.latitude,
          longitude: loc.point.longitude,
          species_group: 'stray_cattle_or_dog',
          severity: 3,
        });
      }
      if (kind === 'pothole' || kind === 'waterlogging') {
        await digitalTwinApi
          .observeRoadMemory({
            latitude: loc.point.latitude,
            longitude: loc.point.longitude,
            condition_type: kind,
            severity: 3,
          })
          .catch(() => undefined);
      }
      return quickReport.mutateAsync(kind);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hazards-nearby'] }),
  });

  const handleQuickReport = (kind: QuickReportHazardKind) => {
    if (!loc.point) return;
    twinQuickReport.mutate(kind);
  };

  const sendFeedback = useMutation({
    mutationFn: async (rating: number) => {
      if (!completedTripId || completedTripId.startsWith('local-')) {
        return { feedback_id: `local-fb-${Date.now()}` };
      }
      return moveDataApi.submitFeedback({
        trip_id: completedTripId,
        user_id: userId!,
        rating,
        comment: `Rated ${rating}/5 from mobile app`,
      });
    },
    onSuccess: (_d, rating) => setRated(rating),
    onError: (_e, rating) => setRated(rating),
  });

  const alts = plan.data?.alternatives ?? [];
  const selectedAlt = alts.find(a => a.route_id === selectedAltId) ?? alts[0];
  const topMode = selectedAlt?.mode.toLowerCase();

  const handleAskExplain = (alt: RouteAlternative) => {
    const compared = alts.find(x => x.route_id !== alt.route_id);
    const ctx: RouteContextPayload = {
      mode: alt.mode,
      optimize_for: goal,
      duration_seconds: alt.eta_range_seconds?.p50 ?? alt.duration_seconds,
      p90_seconds: alt.eta_range_seconds?.p90,
      reliability_score: alt.reliability_score,
      cost_inr: alt.estimated_cost.amount,
      ...(compared
        ? {
            compared_mode: compared.mode,
            compared_duration_seconds: compared.eta_range_seconds?.p50 ?? compared.duration_seconds,
          }
        : {}),
    };
    setExplainTarget({ alt, ctx });
    explainRoute.mutate({ alt, ctx });
  };

  const adviseDeparture = (hrs = Number(windowHrs)) => {
    if (!loc.point || !dest) return;
    advice.mutate({
      origin: loc.point,
      destination: { latitude: dest.latitude, longitude: dest.longitude },
      mode: topMode ?? navPrefs.defaultMode ?? 'car',
      objective: goal,
      windowHours: hrs,
    });
  };

  const toggleMode = (k: string) =>
    setModes(cur => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]));

  const moveStop = (idx: number, dir: -1 | 1) => {
    setStops(prev => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const removeStop = (idx: number) => setStops(prev => prev.filter((_, i) => i !== idx));

  const canFind = !!loc.point && !!dest;
  const find = () => {
    if (!loc.point || !dest) return;
    plan.mutate({
      userId,
      origin: loc.point,
      destination: { latitude: dest.latitude, longitude: dest.longitude },
      modes,
      optimizeFor: goal,
      avoidTolls: navPrefs.avoidTolls,
      avoidHazards: navPrefs.avoidHazards,
      maxWalkingMinutes: navPrefs.maxWalkingMinutes,
      weights: navPrefs.weights as unknown as Record<string, number>,
    });
  };

  // Build turn-by-turn maneuver sequence & live telemetry for Active Navigation
  const baseTotalDistanceM =
    tripUpdates.data?.remaining_distance_meters ?? selectedAlt?.distance_meters ?? 6400;
  const baseTotalEtaSec =
    tripUpdates.data?.eta_range_seconds?.p50 ?? selectedAlt?.duration_seconds ?? 960;
  const p90TotalEtaSec =
    tripUpdates.data?.eta_range_seconds?.p90 ?? selectedAlt?.eta_range_seconds?.p90 ?? Math.round(baseTotalEtaSec * 1.18);

  const navSteps = React.useMemo(() => {
    const destName = dest?.name ?? 'Destination';
    const modeTag = modeLabel(activeTrip?.primary_mode ?? selectedAlt?.mode ?? 'car');
    const waypointSteps = stops.map((s, idx) => ({
      turnIcon: idx % 2 === 0 ? '↱' : '↰',
      instruction: `Via Stop ${idx + 1}: ${s.name}`,
      street: s.subtitle || `${s.name} Connector`,
      distanceM: Math.round(baseTotalDistanceM * 0.22),
      lanes: ['↑', '↑', '↱'],
      activeLaneIndex: 2,
    }));

    return [
      {
        turnIcon: '↑',
        instruction: `Continue on main ${modeTag.toLowerCase()} corridor`,
        street: `Toward ${stops[0]?.name ?? destName}`,
        distanceM: Math.max(250, Math.round(baseTotalDistanceM * 0.18)),
        lanes: ['↑', '↑', '↑', '↱'],
        activeLaneIndex: 1,
      },
      ...waypointSteps,
      {
        turnIcon: '↱',
        instruction: `Keep right onto expressway flyover`,
        street: `${destName} – Fast Corridor`,
        distanceM: Math.max(400, Math.round(baseTotalDistanceM * 0.42)),
        lanes: ['↑', '↑', '↱', '↱'],
        activeLaneIndex: 2,
      },
      {
        turnIcon: '↰',
        instruction: `Turn left onto ${destName} approach road`,
        street: `${destName} Sector Access`,
        distanceM: Math.max(180, Math.round(baseTotalDistanceM * 0.25)),
        lanes: ['↰', '↑', '↑'],
        activeLaneIndex: 0,
      },
      {
        turnIcon: '⚑',
        instruction: `Arrive at ${destName}`,
        street: `Destination ahead on right`,
        distanceM: 60,
        lanes: ['↑', '↱'],
        activeLaneIndex: 1,
      },
    ];
  }, [dest?.name, activeTrip?.primary_mode, selectedAlt?.mode, stops, baseTotalDistanceM]);

  const clampedStepIdx = Math.min(navStepIdx, Math.max(0, navSteps.length - 1));
  const currentStep = navSteps[clampedStepIdx];
  const nextStep = navSteps[clampedStepIdx + 1];
  const navProgress = navSteps.length > 1 ? clampedStepIdx / (navSteps.length - 1) : 0;

  // Auto-advance simulated turn-by-turn progress every 9s when autoDrive is enabled
  React.useEffect(() => {
    if (!activeTrip || !autoDrive) return;
    const timer = setInterval(() => {
      setNavStepIdx(prev => (prev < navSteps.length - 1 ? prev + 1 : 0));
    }, 9000);
    return () => clearInterval(timer);
  }, [activeTrip, autoDrive, navSteps.length]);

  const remainingFactor = Math.max(0.06, 1 - navProgress * 0.88);
  const activeDistanceM = Math.round(baseTotalDistanceM * remainingFactor);
  const liveEtaSec = Math.max(60, Math.round(baseTotalEtaSec * remainingFactor));
  const etaBufferMin = Math.max(1, Math.round(((p90TotalEtaSec - baseTotalEtaSec) * remainingFactor) / 60));

  const formatStepDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

  const activeManeuver: MapManeuver | null = activeTrip
    ? {
        turnIcon: currentStep.turnIcon,
        distanceLabel: formatStepDist(currentStep.distanceM),
        primaryStreet: currentStep.instruction,
        subtitle: `${currentStep.street} · ${tripUpdates.data?.traffic_freshness ?? 'Live GPS telemetry'}`,
        badge: modeLabel(activeTrip.primary_mode).toUpperCase(),
        lanes: currentStep.lanes,
        activeLaneIndex: currentStep.activeLaneIndex,
        nextTurnHint: nextStep ? `Then ${nextStep.turnIcon} ${nextStep.instruction}` : 'Final approach to destination',
      }
    : selectedAlt && dest
    ? {
        turnIcon: '↱',
        distanceLabel: formatDuration(selectedAlt.eta_range_seconds?.p50 ?? selectedAlt.duration_seconds),
        primaryStreet: `Head toward ${dest.name}`,
        subtitle:
          stops.length > 0
            ? `Via ${stops.map(s => s.name).join(' → ')}`
            : `${(selectedAlt.distance_meters / 1000).toFixed(1)} km · ${Math.round(selectedAlt.reliability_score * 100)}% reliable`,
        badge: modeLabel(selectedAlt.mode).toUpperCase(),
        lanes: ['↑', '↑', '↱'],
        activeLaneIndex: 2,
      }
    : null;

  const etaArrivalClock = new Date(Date.now() + liveEtaSec * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const simulatedSpeedKmph = activeTrip
    ? Math.max(18, Math.round(38 + Math.sin(clampedStepIdx * 1.7) * 11))
    : undefined;
  const reliabilityPct = Math.round((selectedAlt?.reliability_score ?? 0.92) * 100);

  // During travel: Anti-spam Meaningful Route Change engine
  const candidateRouteChange = tripUpdates.data?.route_change ?? simulatedDetour;
  const candidateSavedMin = candidateRouteChange
    ? Math.max(1, Math.round(candidateRouteChange.time_saved_seconds / 60))
    : 0;
  const routeChangeKey = candidateRouteChange
    ? `${candidateRouteChange.reason}:${candidateRouteChange.suggested_mode ?? ''}:${candidateRouteChange.time_saved_seconds}`
    : '';
  const cooldownActive =
    navPrefs.meaningfulAlertsOnly && lastAlertAtMs > 0 && Date.now() - lastAlertAtMs < 60_000;
  const activeRouteChange =
    candidateRouteChange &&
    candidateRouteChange.meaningful_change &&
    !dismissedChangeKeys.includes(routeChangeKey) &&
    (!navPrefs.meaningfulAlertsOnly || candidateSavedMin >= 4) &&
    !cooldownActive
      ? candidateRouteChange
      : null;
  const suppressedMinorCount = candidateRouteChange?.suppressed_minor_count ?? (navPrefs.meaningfulAlertsOnly ? 2 : 0);

  const dismissRouteChange = () => {
    if (routeChangeKey) {
      setDismissedChangeKeys(cur => [...cur, routeChangeKey]);
      setLastAlertAtMs(Date.now());
    }
    setSimulatedDetour(null);
  };

  const acceptRouteChange = () => {
    if (!activeRouteChange) return;
    const recMode = activeRouteChange.suggested_mode ?? 'metro';
    const savedMin = Math.max(1, Math.round(activeRouteChange.time_saved_seconds / 60));
    const altMatch = alts.find(a => a.mode.toLowerCase() === recMode.toLowerCase()) ?? selectedAlt;
    if (altMatch) setSelectedAltId(altMatch.route_id);
    if (activeTrip) {
      setActiveTrip({
        ...activeTrip,
        primary_mode: recMode.toLowerCase(),
      });
    }
    setTripSyncNote(`Switched to ${modeLabel(recMode)} · saves ${savedMin} min`);
    dismissRouteChange();
  };

  const triggerDetourSimulation = () => {
    const altBetter = alts.find(a => a.mode.toLowerCase() !== (activeTrip?.primary_mode ?? '').toLowerCase());
    const recMode = altBetter?.mode ?? (activeTrip?.primary_mode === 'metro' ? 'multimodal' : 'metro');
    setSimulatedDetour({
      meaningful_change: true,
      change_type: 'congestion_bypass',
      headline: `Detour via ${modeLabel(recMode)} saves 7 min`,
      reason: `Upstream congestion spike detected (+9 min delay). ${modeLabel(recMode)} saves 7 min with 93% reliability.`,
      time_saved_seconds: 420,
      confidence: 0.93,
      suggested_mode: recMode,
      suggested_label: modeLabel(recMode),
      suppressed_minor_count: suppressedMinorCount,
    });
  };

  return (
    <Screen
      scrollRef={scrollRef}
      title={activeTrip ? 'Active navigation' : 'Route & navigation'}
      subtitle={
        activeTrip
          ? `${modeLabel(activeTrip.primary_mode)} · Step ${clampedStepIdx + 1} of ${navSteps.length} toward ${dest?.name ?? 'destination'}`
          : dest
          ? `To ${dest.name}${stops.length ? ` · ${stops.length} stop${stops.length > 1 ? 's' : ''}` : ''}`
          : 'Manage stops, compare modes & drive'
      }
      backLabel="← Nexora"
      rightAction={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={() => setFullScreenMap(true)} style={styles.topPillBtn}>
            <Text style={styles.topPillText}>⤢ Fullscreen</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.topPillBtn}>
            <Text style={styles.topPillText}>⚙</Text>
          </TouchableOpacity>
        </View>
      }>
      {/* Interactive Navigation Map HUD (Embedded + Rapido-style Full-Screen Modal) */}
      <FadeIn index={0}>
        <NavMapCanvas
          origin={loc.point}
          stops={stops}
          destination={dest}
          hazards={hazards.data?.hazards ?? []}
          trafficSegments={traffic.data?.segments ?? []}
          tracePoints={loc.tracePoints}
          liveHeadingDeg={loc.headingDeg}
          accuracyM={loc.accuracyM}
          tracedDistanceM={loc.tracedDistanceM}
          tracingActive={traceRecording && (loc.isWatching || !!activeTrip || fullScreenMap)}
          onToggleTracing={() => setTraceRecording(v => !v)}
          onClearTrace={loc.clearTrace}
          onQuickReportHazard={handleQuickReport}
          reportBusy={quickReport.isPending || twinQuickReport.isPending}
          spatialRadar={spatialRadarQuery.data}
          maneuver={activeManeuver}
          roadLabel={
            activeTrip
              ? `${currentStep.street} → ${dest?.name ?? 'Destination'}`
              : dest
              ? `Route → ${dest.name}`
              : undefined
          }
          liveSpeedKmph={loc.speedKmph ?? simulatedSpeedKmph}
          progress={activeTrip ? 0.12 + navProgress * 0.82 : 0}
          voiceMuted={voiceMuted}
          onToggleVoice={() => setVoiceMuted(v => !v)}
          height={activeTrip ? (mapExpanded ? 360 : 280) : mapExpanded ? 320 : 220}
          fullScreen={fullScreenMap}
          onToggleFullScreen={() => setFullScreenMap(v => !v)}
          fullScreenOverlay={
            <View style={styles.rapidoDock}>
              {activeTrip ? (
                <>
                  {/* Drag Handle + Quick Summary Bar */}
                  <TouchableOpacity
                    onPress={() => setFsToolsExpanded(v => !v)}
                    activeOpacity={0.85}
                    style={styles.rapidoHeader}>
                    <View style={styles.rapidoHandle} />
                    <View style={styles.between}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rapidoEta}>
                          {formatDuration(liveEtaSec)}{' '}
                          <Text style={styles.rapidoArriveSub}>· Arrive {etaArrivalClock}</Text>
                        </Text>
                        <Text style={styles.rapidoMeta}>
                          {(activeDistanceM / 1000).toFixed(1)} km left · Traced {(loc.tracedDistanceM / 1000).toFixed(2)} km ({loc.tracePoints.length} pts) · {reliabilityPct}% (±{etaBufferMin}m)
                        </Text>
                      </View>
                      <View style={styles.rapidoExpandPill}>
                        <Text style={styles.rapidoExpandText}>
                          {fsToolsExpanded ? '▼ Less' : '▲ Drive Tools'}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Meaningful Detour Alert inside Fullscreen Driving Mode */}
                  {activeRouteChange && (
                    <View style={styles.rapidoDetourCard}>
                      <View style={styles.between}>
                        <StatusPill
                          label={`⚡ DETOUR · SAVES ${Math.max(1, Math.round(activeRouteChange.time_saved_seconds / 60))} MIN`}
                          tone="warning"
                        />
                        <TouchableOpacity onPress={dismissRouteChange}>
                          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '700' }}>Keep</Text>
                        </TouchableOpacity>
                      </View>
                      <Text style={{ color: colors.textPrimary, fontSize: 12.5 }}>{activeRouteChange.reason}</Text>
                      <PrimaryButton
                        title={`Switch to ${modeLabel(activeRouteChange.suggested_mode ?? 'metro')}`}
                        variant="nav"
                        onPress={acceptRouteChange}
                      />
                    </View>
                  )}

                  {/* Expandable Rapido-Style Quick Driving Controls + AI Route Explain + Mode Switch */}
                  {fsToolsExpanded && (
                    <View style={styles.rapidoToolsBox}>
                      <View style={styles.rapidoQuickRow}>
                        <TouchableOpacity
                          onPress={() => setNavStepIdx(i => Math.max(0, i - 1))}
                          style={styles.rapidoToolBtn}>
                          <Text style={styles.rapidoToolText}>◀ Prev turn</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setNavStepIdx(i => (i < navSteps.length - 1 ? i + 1 : 0))}
                          style={styles.rapidoToolBtn}>
                          <Text style={styles.rapidoToolText}>Next turn ▶</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setAutoDrive(v => !v)}
                          style={styles.rapidoToolBtn}>
                          <Text style={styles.rapidoToolText}>{autoDrive ? '⏸ Pause HUD' : '▶ Auto HUD'}</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.rapidoQuickRow}>
                        {selectedAlt && (
                          <TouchableOpacity
                            onPress={() => handleAskExplain(selectedAlt)}
                            style={styles.rapidoToolBtn}>
                            <Text style={[styles.rapidoToolText, { color: colors.routeCyan }]}>
                              {explainRoute.isPending ? '✨ Loading…' : '✨ Why route?'}
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          onPress={triggerDetourSimulation}
                          style={styles.rapidoToolBtn}>
                          <Text style={[styles.rapidoToolText, { color: '#FDE68A' }]}>⚡ Detour Check</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setTraceRecording(v => !v)}
                          style={styles.rapidoToolBtn}>
                          <Text style={styles.rapidoToolText}>
                            {traceRecording ? '● Tracing ON' : '⏸ Trace OFF'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {alts.length > 1 && (
                        <View style={styles.rapidoQuickRow}>
                          {alts.slice(0, 3).map(altOpt => {
                            const active = altOpt.route_id === selectedAlt?.route_id;
                            return (
                              <TouchableOpacity
                                key={altOpt.route_id}
                                onPress={() => {
                                  setSelectedAltId(altOpt.route_id);
                                  if (activeTrip) {
                                    setActiveTrip({ ...activeTrip, primary_mode: altOpt.mode.toLowerCase() });
                                  }
                                }}
                                style={[
                                  styles.rapidoToolBtn,
                                  active && { borderColor: colors.routeCyan, backgroundColor: 'rgba(42, 224, 196, 0.14)' },
                                ]}>
                                <Text style={styles.rapidoToolText} numberOfLines={1}>
                                  {modeLabel(altOpt.mode)} · {formatDuration(altOpt.duration_seconds)}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                      {explainTarget && explainRoute.data?.answer && (
                        <View style={styles.rapidoExplainCard}>
                          <View style={styles.between}>
                            <Text style={styles.rapidoExplainTitle}>✨ AI Route Explanation</Text>
                            <TouchableOpacity onPress={() => setExplainTarget(null)}>
                              <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                          <Text style={styles.rapidoExplainText}>{explainRoute.data.answer}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* Primary Bottom Ride Actions (just like Rapido live trip bar) */}
                  <View style={styles.rapidoBottomActions}>
                    <TouchableOpacity
                      onPress={() => setFullScreenMap(false)}
                      style={styles.rapidoMinimizeBtn}>
                      <Text style={styles.rapidoMinimizeText}>⤡ Planner</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => syncTrip.mutate(activeTripId)}
                      style={styles.rapidoSyncBtn}>
                      <Text style={styles.rapidoSyncText}>↻ Sync</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => completeTrip.mutate(activeTripId)}
                      style={styles.rapidoFinishBtn}>
                      <Text style={styles.rapidoFinishText}>
                        {completeTrip.isPending ? 'Finishing…' : '✓ Complete Ride'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.rapidoPreviewBar}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rapidoEta}>
                      {dest ? dest.name : 'Live OpenStreetMap Explorer'}
                    </Text>
                    <Text style={styles.rapidoMeta}>
                      {selectedAlt
                        ? `${formatDuration(selectedAlt.duration_seconds)} · ${(selectedAlt.distance_meters / 1000).toFixed(1)} km · ${modeLabel(selectedAlt.mode)}${loc.tracePoints.length > 0 ? ` · Traced ${(loc.tracedDistanceM / 1000).toFixed(2)} km` : ''}`
                        : `Live GPS Trace ${(loc.tracedDistanceM / 1000).toFixed(2)} km (${loc.tracePoints.length} pts) · Tap ⛽/⚡ pins`}
                    </Text>
                  </View>
                  {selectedAlt && (
                    <TouchableOpacity
                      onPress={() => startTrip.mutate({ routeId: selectedAlt.route_id, mode: selectedAlt.mode })}
                      style={styles.rapidoFinishBtn}>
                      <Text style={styles.rapidoFinishText}>➤ Start Ride</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => setFullScreenMap(false)}
                    style={styles.rapidoMinimizeBtn}>
                    <Text style={styles.rapidoMinimizeText}>⤡ Exit</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          }
          onOpenSettings={() => setSettingsOpen(true)}
          onAddStop={place => setStops(cur => [...cur, place])}
          onRecenter={loc.refresh}
        />
      </FadeIn>

      {/* Dedicated Mobile Active Navigation Cockpit */}
      {activeTrip && (
        <FadeIn index={1} style={{ marginTop: spacing.m, gap: spacing.m }}>
          {/* Primary Cockpit Telemetry Card */}
          <Card variant="nav" style={{ gap: spacing.m }}>
            {/* Top Status & Confidence Strip */}
            <View style={styles.between}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <StatusPill label={`LIVE · ${modeLabel(activeTrip.primary_mode).toUpperCase()}`} tone="success" />
                <View style={styles.confidenceBadge}>
                  <Text style={styles.confidenceBadgeText}>{reliabilityPct}% ON-TIME (±{etaBufferMin}m)</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TouchableOpacity onPress={() => setFullScreenMap(true)} style={styles.fsLaunchPill}>
                  <Text style={styles.fsLaunchText}>⤢ Fullscreen</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setAutoDrive(v => !v)}
                  style={[styles.simTogglePill, autoDrive && styles.simTogglePillActive]}>
                  <Text style={styles.simToggleText}>{autoDrive ? '● Auto-HUD' : '⏸ Paused'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 3-Column Big Cockpit Metrics: Arrival, Time Left, Distance Left */}
            <View style={styles.cockpitMetricsGrid}>
              <View style={styles.cockpitMetricBox}>
                <Text style={styles.cockpitMetricLabel}>ARRIVAL</Text>
                <Text style={styles.cockpitMetricPrimary}>{etaArrivalClock}</Text>
                <Text style={styles.cockpitMetricSub}>IST</Text>
              </View>
              <View style={styles.cockpitMetricDivider} />
              <View style={styles.cockpitMetricBox}>
                <Text style={styles.cockpitMetricLabel}>REMAINING</Text>
                <Text style={[styles.cockpitMetricPrimary, { color: colors.routeCyan }]}>
                  {formatDuration(liveEtaSec)}
                </Text>
                <Text style={styles.cockpitMetricSub}>
                  {tripUpdates.data?.traffic_freshness ?? 'Smooth flow'}
                </Text>
              </View>
              <View style={styles.cockpitMetricDivider} />
              <View style={styles.cockpitMetricBox}>
                <Text style={styles.cockpitMetricLabel}>DISTANCE</Text>
                <Text style={styles.cockpitMetricPrimary}>{(activeDistanceM / 1000).toFixed(1)} km</Text>
                <Text style={styles.cockpitMetricSub}>
                  {Math.round(navProgress * 100)}% complete
                </Text>
              </View>
            </View>

            {/* Route Progress Bar */}
            <View style={{ gap: 6 }}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.max(12, Math.round(navProgress * 100))}%` as any },
                  ]}
                />
              </View>
              <View style={styles.between}>
                <Text style={styles.progressCaption}>● Origin</Text>
                {stops.length > 0 && (
                  <Text style={styles.progressCaption}>
                    {stops.length} stop{stops.length > 1 ? 's' : ''} en route
                  </Text>
                )}
                <Text style={[styles.progressCaption, { color: colors.routeCyan }]}>
                  ⚑ {dest?.name ?? 'Destination'}
                </Text>
              </View>
            </View>

            {/* Turn-by-Turn Step Controls + GPS Sync + Exit */}
            <View style={styles.cockpitControlRow}>
              <TouchableOpacity
                onPress={() => {
                  setAutoDrive(false);
                  setNavStepIdx(i => Math.max(0, i - 1));
                }}
                disabled={clampedStepIdx === 0}
                style={[styles.stepCtrlBtn, clampedStepIdx === 0 && { opacity: 0.4 }]}>
                <Text style={styles.stepCtrlText}>◀ Prev</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  if (clampedStepIdx >= navSteps.length - 1) {
                    completeTrip.mutate(activeTripId);
                  } else {
                    setNavStepIdx(i => Math.min(navSteps.length - 1, i + 1));
                  }
                }}
                style={styles.nextStepBtn}>
                <Text style={styles.nextStepBtnText}>
                  {clampedStepIdx >= navSteps.length - 1 ? '🏁 Complete Trip' : 'Next Turn ▶'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => syncTrip.mutate(activeTripId)}
                style={styles.syncPill}
                accessibilityLabel="Sync GPS">
                <Text style={styles.syncText}>{syncTrip.isPending ? '…' : '⌖ Sync'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => completeTrip.mutate(activeTripId)}
                style={styles.endTripPill}
                accessibilityLabel="End trip">
                <Text style={styles.endTripText}>{completeTrip.isPending ? '…' : '✕ Exit'}</Text>
              </TouchableOpacity>
            </View>

            {tripSyncNote && (
              <Text style={{ color: colors.textSecondary, fontSize: 11.5 }}>{tripSyncNote}</Text>
            )}
          </Card>

          {/* Upcoming Maneuvers Step-by-Step Timeline Card */}
          <Card style={{ gap: spacing.s }}>
            <View style={styles.between}>
              <Text style={styles.mode}>Upcoming turns</Text>
              <Text style={styles.label}>Tap any step to preview</Text>
            </View>
            {navSteps.map((step, idx) => {
              const isCurrent = idx === clampedStepIdx;
              const isPassed = idx < clampedStepIdx;
              return (
                <TouchableOpacity
                  key={`${step.instruction}-${idx}`}
                  onPress={() => {
                    setAutoDrive(false);
                    setNavStepIdx(idx);
                  }}
                  style={[
                    styles.turnStepRow,
                    isCurrent && styles.turnStepRowActive,
                    isPassed && { opacity: 0.45 },
                  ]}>
                  <View style={[styles.turnStepBadge, isCurrent && styles.turnStepBadgeActive]}>
                    <Text style={styles.turnStepIcon}>{isPassed ? '✓' : step.turnIcon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.turnStepTitle, isCurrent && { color: colors.routeCyan }]} numberOfLines={1}>
                      {step.instruction}
                    </Text>
                    <Text style={styles.label} numberOfLines={1}>
                      {step.street}
                    </Text>
                  </View>
                  <Text style={styles.turnStepDist}>{formatStepDist(step.distanceM)}</Text>
                </TouchableOpacity>
              );
            })}
          </Card>

          {/* One-Tap Driver Safety & Live Hazard Radar */}
          <Card style={{ gap: 8 }}>
            <View style={styles.between}>
              <Text style={styles.stopPrimary}>Report live road hazard</Text>
              {quickReport.isSuccess && (
                <Text style={{ color: colors.statusSuccess, fontSize: 12, fontWeight: '700' }}>
                  ✓ Pinned to live radar
                </Text>
              )}
            </View>
            <View style={styles.hazardGrid}>
              {(
                [
                  { key: 'pothole', icon: '⚠', label: 'Pothole' },
                  { key: 'blocked_lane', icon: '🚧', label: 'Blocked lane' },
                  { key: 'waterlogging', icon: '🌊', label: 'Waterlogging' },
                  { key: 'damaged_road', icon: '🛠', label: 'Roadwork' },
                ] as const
              ).map(item => (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => quickReport.mutate(item.key)}
                  style={styles.hazardActionBtn}>
                  <Text style={styles.hazardActionIcon}>{item.icon}</Text>
                  <Text style={styles.hazardActionLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* During travel: Meaningful Route Change banner (anti-spam hysteresis) */}
          {activeRouteChange ? (
            <Card variant="featured" style={{ gap: 10, borderColor: 'rgba(245, 158, 11, 0.5)' }}>
              <View style={styles.between}>
                <StatusPill
                  label={`⚡ DETOUR · SAVES ${Math.max(1, Math.round(activeRouteChange.time_saved_seconds / 60))} MIN`}
                  tone="warning"
                />
                <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>
                  {suppressedMinorCount > 0 ? `${suppressedMinorCount} minor alerts suppressed` : 'High impact'}
                </Text>
              </View>
              <Text style={{ color: colors.textPrimary, fontSize: 13.5, lineHeight: 19, fontWeight: '600' }}>
                {activeRouteChange.reason}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title={`Switch to ${modeLabel(activeRouteChange.suggested_mode ?? 'metro')}`}
                    variant="nav"
                    onPress={acceptRouteChange}
                  />
                </View>
                <TouchableOpacity onPress={dismissRouteChange} style={styles.keepRouteBtn}>
                  <Text style={styles.keepRouteText}>Keep route</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ) : (
            <View style={styles.routeMonitorStrip}>
              <Text style={styles.routeMonitorText}>
                ● Corridor steady ·{' '}
                {navPrefs.meaningfulAlertsOnly
                  ? `Meaningful alerts only (${suppressedMinorCount} minor fluctuations muted)`
                  : 'All corridor updates enabled'}
              </Text>
              <TouchableOpacity onPress={triggerDetourSimulation}>
                <Text style={styles.routeMonitorAction}>Check detour</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Toggle Planner / Route Overview Drawer while Navigating */}
          <TouchableOpacity
            onPress={() => setShowPlannerDuringNav(v => !v)}
            style={styles.plannerDrawerToggle}>
            <Text style={styles.plannerDrawerToggleText}>
              {showPlannerDuringNav
                ? '▲ Hide route planner & stops'
                : `🗺 Edit stops or switch route (${alts.length || 1} option${alts.length === 1 ? '' : 's'}) ▼`}
            </Text>
          </TouchableOpacity>
        </FadeIn>
      )}

      {/* Post-Trip Time Saved & Journey Insights Card */}
      {completedTripId && completedSummary && (
        <FadeIn index={1} style={{ marginTop: spacing.m }}>
          <PostTripSummaryCard
            destinationName={dest?.name ?? 'Your destination'}
            mode={completedSummary.mode}
            summary={completedSummary.summary}
            rated={rated}
            onRate={star => sendFeedback.mutate(star)}
            onFinish={() => {
              setCompletedTripId(null);
              setCompletedSummary(null);
              setRated(null);
            }}
            onDismiss={() => {
              setCompletedTripId(null);
              setCompletedSummary(null);
            }}
          />
        </FadeIn>
      )}

      {/* Manage Stops & Planner Sections (collapsed by default during Active Navigation for zero clutter) */}
      {(!activeTrip || showPlannerDuringNav) && (
        <>
          <SectionHeading
            title="Manage stops"
            action={stops.length > 0 || dest ? 'Reset' : undefined}
            onActionPress={() => {
              setDest(null);
              setText('');
              setStops([]);
              setSelectedAltId(null);
            }}
          />
      <FadeIn index={1}>
        <Card style={{ gap: spacing.s }}>
          {/* Origin row */}
          <View style={styles.stopLineRow}>
            <View style={[styles.timelineDot, { backgroundColor: colors.navBlue }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.stopPrimary}>Current Location</Text>
              {loc.loading ? (
                <Skeleton height={12} width={140} />
              ) : loc.point ? (
                <Text style={styles.label}>
                  {loc.point.latitude.toFixed(4)}, {loc.point.longitude.toFixed(4)}
                </Text>
              ) : (
                <Tappable onPress={loc.refresh}>
                  <Text style={{ color: colors.statusWarning, fontSize: 12.5 }}>
                    {loc.error ?? 'Location unavailable'} — tap to retry
                  </Text>
                </Tappable>
              )}
            </View>
          </View>

          {/* Intermediate reorderable stops */}
          {stops.map((st, idx) => (
            <View key={`${st.name}-${idx}`} style={styles.stopLineRow}>
              <View style={[styles.timelineDot, { backgroundColor: colors.routeCyan }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.stopPrimary}>{st.name}</Text>
                <Text style={styles.label}>Stop {idx + 1}</Text>
              </View>
              <View style={styles.stopActions}>
                {idx > 0 && (
                  <TouchableOpacity onPress={() => moveStop(idx, -1)} style={styles.stopIconBtn}>
                    <Text style={styles.stopIconText}>↑</Text>
                  </TouchableOpacity>
                )}
                {idx < stops.length - 1 && (
                  <TouchableOpacity onPress={() => moveStop(idx, 1)} style={styles.stopIconBtn}>
                    <Text style={styles.stopIconText}>↓</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => removeStop(idx)} style={styles.stopIconBtn}>
                  <Text style={[styles.stopIconText, { color: colors.statusDanger }]}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          {/* Add stop inline composer */}
          {addingStop ? (
            <View style={styles.addStopBox}>
              <View style={styles.between}>
                <Text style={styles.label}>Search intermediate stop</Text>
                <TouchableOpacity onPress={() => { setAddingStop(false); setStopQuery(''); }}>
                  <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>Close</Text>
                </TouchableOpacity>
              </View>
              <Input
                value={stopQuery}
                onChangeText={setStopQuery}
                placeholder="Type waypoint / charger / station…"
                autoCorrect={false}
              />
              {stopSearch.isFetching && <Skeleton height={14} width={170} />}
              {stopSearch.data?.places?.slice(0, 4).map((p, i) => (
                <Tappable
                  key={`${p.latitude}-${p.longitude}-${i}`}
                  onPress={() => {
                    setStops(cur => [...cur, p]);
                    setAddingStop(false);
                    setStopQuery('');
                  }}
                  style={styles.result}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>+ {p.name}</Text>
                  {p.subtitle ? <Text style={styles.label}>{p.subtitle}</Text> : null}
                </Tappable>
              ))}
            </View>
          ) : (
            <TouchableOpacity onPress={() => setAddingStop(true)} style={styles.addStopBtn}>
              <Text style={styles.addStopText}>+ Add stop</Text>
            </TouchableOpacity>
          )}

          {/* Destination input */}
          <View style={styles.stopLineRow}>
            <View style={[styles.timelineDot, { backgroundColor: colors.accentBright }]} />
            <View style={{ flex: 1 }}>
              <Input
                value={dest ? dest.name : text}
                onChangeText={t => {
                  setDest(null);
                  setText(t);
                }}
                placeholder="Search destination…"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Saved places one-tap destination chips */}
          {!dest && saved.data && saved.data.places.length > 0 && q.length < 2 && (
            <View style={styles.row}>
              {saved.data.places.map(p => (
                <Chip
                  key={p.id}
                  label={`★ ${p.name}`}
                  onPress={() => {
                    setDest(p);
                    setText(p.name);
                  }}
                />
              ))}
            </View>
          )}

          {/* Destination search dropdown */}
          {!dest && q.length >= 2 && (
            <View style={{ gap: 2 }}>
              {search.isFetching && <Skeleton height={14} width={200} />}
              {search.isError && (
                <Text style={{ color: colors.statusDanger, fontSize: 13 }}>Place search is unavailable.</Text>
              )}
              {search.data?.places.length === 0 && !search.isFetching && (
                <Text style={styles.label}>No places found.</Text>
              )}
              {search.data?.places.map((p, i) => (
                <Tappable
                  key={`${p.latitude},${p.longitude},${i}`}
                  onPress={() => {
                    setDest(p);
                    setText(p.name);
                  }}
                  style={styles.result}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{p.name}</Text>
                  {p.subtitle ? <Text style={styles.label}>{p.subtitle}</Text> : null}
                </Tappable>
              ))}
            </View>
          )}
        </Card>
      </FadeIn>

      <SectionHeading title="Modes & priority" />
      <Text style={[styles.label, { marginBottom: spacing.s }]}>
        {modes.length ? 'Comparing selected modes' : 'Auto-mix active — tap modes to filter'}
      </Text>
      <View style={styles.row}>
        {MODE_OPTIONS.map(m => (
          <Chip key={m.key} label={m.label} active={modes.includes(m.key)} onPress={() => toggleMode(m.key)} />
        ))}
      </View>

      <View style={{ marginBottom: spacing.m }}>
        <SegmentedControl options={GOALS} value={goal} onChange={setGoal} />
      </View>

      <PrimaryButton
        title="Find routes"
        variant="nav"
        onPress={find}
        loading={plan.isPending}
        disabled={!canFind}
      />

      {/* Route Overview Results */}
      <View style={{ marginTop: spacing.l, gap: spacing.m }}>
        {plan.isPending && (
          <>
            <Card><Skeleton height={18} width={160} /><View style={{ height: 8 }} /><Skeleton height={12} /></Card>
            <Card><Skeleton height={18} width={140} /><View style={{ height: 8 }} /><Skeleton height={12} /></Card>
          </>
        )}
        {plan.isError && (
          <Card>
            <Text style={{ color: colors.statusDanger, fontWeight: '600' }}>Couldn't plan this journey</Text>
            <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{(plan.error as Error).message}</Text>
          </Card>
        )}

        {alts.length > 0 && (
          <View style={styles.overviewHeader}>
            <SectionHeading title="Route overview" />
            <SegmentedControl
              compact
              options={[
                { key: 'cards', label: 'Cards' },
                { key: 'compare', label: 'Compare' },
              ]}
              value={routeViewMode}
              onChange={setRouteViewMode}
            />
          </View>
        )}

        {/* Event-aware & Hazard intelligence notice strip */}
        {alts.length > 0 &&
          ((plan.data?.active_events?.length ?? 0) > 0 || (plan.data?.active_hazards ?? 0) > 0) && (
            <Card style={{ gap: 6, borderColor: 'rgba(245, 158, 11, 0.35)' }}>
              {plan.data?.active_events?.map((ev, idx) => (
                <View key={`${ev.event_id ?? ev.title}-${idx}`} style={styles.eventAlertRow}>
                  <StatusPill label="EVENT-AWARE" tone="warning" />
                  <Text style={styles.eventAlertText}>
                    {ev.title} ({ev.category}) ·{' '}
                    {ev.road_delay_multiplier
                      ? `+${Math.round((ev.road_delay_multiplier - 1) * 100)}% corridor delay buffered`
                      : ev.advisory}
                  </Text>
                </View>
              ))}
              {(plan.data?.active_hazards ?? 0) > 0 && (
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  ⚠ {plan.data?.active_hazards} active road hazard{(plan.data?.active_hazards ?? 0) > 1 ? 's' : ''} factored into ranking
                </Text>
              )}
            </Card>
          )}

        {alts.length > 0 && routeViewMode === 'compare' && (
          <RouteComparisonMatrix
            alternatives={alts}
            selectedId={selectedAlt?.route_id}
            onSelect={id => setSelectedAltId(id)}
            onAskExplain={handleAskExplain}
          />
        )}

        {routeViewMode === 'cards' &&
          alts.map((a, i) => {
            const expText = Array.isArray(a.explanation) ? a.explanation.join(' · ') : a.explanation;
            const p50 = a.eta_range_seconds?.p50 ?? a.duration_seconds;
            const p10 = a.eta_range_seconds?.p10 ?? Math.max(60, Math.round(p50 * 0.9));
            const p90 = a.eta_range_seconds?.p90;
            const ciLow = Math.max(1, Math.round((a.confidence_interval?.low_seconds ?? p10) / 60));
            const ciHigh = Math.max(
              ciLow + 1,
              Math.round((a.confidence_interval?.high_seconds ?? p90 ?? p50 * 1.15) / 60),
            );
            const isSelected = a.route_id === selectedAlt?.route_id;
            const isExpanded = expandedAltId === a.route_id;
            const isExplaining = explainTarget?.alt.route_id === a.route_id;

            return (
              <FadeIn key={a.route_id} index={i}>
                <Tappable onPress={() => setSelectedAltId(a.route_id)}>
                  <Card variant={isSelected ? 'featured' : 'default'} style={{ gap: 8 }}>
                    <View style={styles.between}>
                      <Text style={styles.mode}>
                        {a.mode_sequence && a.mode_sequence.length > 1
                          ? a.mode_sequence.map(modeLabel).join(' → ')
                          : modeLabel(a.mode)}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {a.reliability_breakdown?.tier ? (
                          <View style={styles.tierChip}>
                            <Text style={styles.tierChipText}>{a.reliability_breakdown.tier}</Text>
                          </View>
                        ) : null}
                        {i === 0 ? (
                          <StatusPill label="BEST MATCH" tone="success" />
                        ) : isSelected ? (
                          <StatusPill label="SELECTED" tone="warning" />
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.between}>
                      <View>
                        <Text style={styles.big}>
                          {formatDuration(p50)}
                          {p90 && p90 > p50 ? (
                            <Text style={{ fontSize: 13.5, color: colors.textSecondary, fontWeight: '500' }}>
                              {' '}
                              ({ciLow}–{ciHigh}m CI)
                            </Text>
                          ) : null}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => handleAskExplain(a)}
                          style={[styles.whyBtn, isExplaining && styles.whyBtnActive]}>
                          <Text style={styles.whyBtnText}>✨ Why?</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setExpandedAltId(isExpanded ? null : a.route_id)}
                          style={styles.detailToggle}>
                          <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>
                            {isExpanded ? 'Hide ▲' : 'Details ▼'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                      {(a.distance_meters / 1000).toFixed(1)} km · {a.estimated_cost.currency}{' '}
                      {Math.round(a.estimated_cost.amount)} · {Math.round(a.reliability_score * 100)}% reliable
                      {a.transfers ? ` · ${a.transfers} transfer${a.transfers > 1 ? 's' : ''}` : ''}
                      {a.co2_grams !== undefined ? ` · ${a.co2_grams}g CO₂` : ''}
                      {a.pedestrian_safety_score ? ` · Walk safety ${Math.round(a.pedestrian_safety_score)}/100` : ''}
                    </Text>

                    {a.legs && a.legs.length > 1 && (
                      <View style={styles.legPillsRow}>
                        {a.legs.map((leg, lIdx) => (
                          <View key={lIdx} style={styles.legPill}>
                            <Text style={styles.legPillText}>
                              {modeLabel(leg.mode)} · {Math.max(1, Math.round(leg.duration_seconds / 60))}m
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {isExpanded && (
                      <View style={styles.expandedDetails}>
                        {expText ? (
                          <Text style={{ color: colors.textPrimary, fontSize: 13, lineHeight: 19 }}>{expText}</Text>
                        ) : null}
                        {a.reliability_breakdown?.factors?.length ? (
                          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                            Reliability factors: {a.reliability_breakdown.factors.join(' · ')}
                          </Text>
                        ) : null}
                        {a.safety_advisories?.length ? (
                          <Text style={{ color: colors.statusWarning, fontSize: 12 }}>
                            Corridor safety: {a.safety_advisories.join(' · ')}
                          </Text>
                        ) : null}
                        <View style={styles.routeStrip}>
                          <Text style={styles.routeStripText}>
                            ● Current Location {stops.length ? `→ ${stops.map(s => s.name).join(' → ')}` : ''} → ⚑{' '}
                            {dest?.name}
                          </Text>
                        </View>
                      </View>
                    )}

                    <View style={{ marginTop: 4 }}>
                      <PrimaryButton
                        title={
                          activeTrip
                            ? isSelected
                              ? `Active · ${modeLabel(a.mode)}`
                              : `Switch to ${modeLabel(a.mode)}`
                            : `Drive · ${modeLabel(a.mode)}`
                        }
                        variant={activeTrip && isSelected ? 'secondary' : 'nav'}
                        onPress={() => startTrip.mutate({ routeId: a.route_id, mode: a.mode })}
                        loading={startTrip.isPending && startTrip.variables?.routeId === a.route_id}
                      />
                    </View>
                  </Card>
                </Tappable>
              </FadeIn>
            );
          })}

        {explainTarget && (
          <ExplainableRoutePanel
            modeLabelText={modeLabel(explainTarget.alt.mode)}
            loading={explainRoute.isPending}
            answer={explainRoute.data?.answer ?? explainRoute.data?.reply}
            explainability={explainRoute.data?.explainability}
            error={explainRoute.isError ? (explainRoute.error as Error).message : undefined}
            onClose={() => setExplainTarget(null)}
            onOpenCopilot={() =>
              nav.navigate('Assistant', {
                prompt: `Why is ${modeLabel(explainTarget.alt.mode)} recommended to ${dest?.name ?? 'my destination'}?`,
                routeContext: explainTarget.ctx,
                nonce: Date.now(),
              })
            }
          />
        )}

        {/* Dynamic Departure Optimizer Card */}
        {alts.length > 0 && (
          <DepartureOptimizerCard
            advice={advice.data}
            windowHrs={windowHrs}
            onChangeWindow={next => {
              setWindowHrs(next);
              adviseDeparture(Number(next));
            }}
            onRefresh={() => adviseDeparture()}
            loading={advice.isPending}
            error={advice.isError}
          />
        )}
      </View>
        </>
      )}

      <QuickSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topPillBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  topPillText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  label: { color: colors.textSecondary, fontSize: 12.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginBottom: spacing.s },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  confidenceBadge: {
    backgroundColor: 'rgba(42, 224, 196, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.35)',
  },
  confidenceBadgeText: { color: colors.routeCyan, fontSize: 10.5, fontWeight: '800' },
  simTogglePill: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  simTogglePillActive: {
    backgroundColor: 'rgba(29, 143, 225, 0.18)',
    borderColor: colors.navBlue,
  },
  simToggleText: { color: colors.textPrimary, fontSize: 11, fontWeight: '800' },
  cockpitMetricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cockpitMetricBox: { flex: 1, alignItems: 'center', gap: 2 },
  cockpitMetricDivider: { width: 1, height: 34, backgroundColor: colors.borderSubtle },
  cockpitMetricLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  cockpitMetricPrimary: { color: colors.textPrimary, fontSize: 18, fontWeight: '900' },
  cockpitMetricSub: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.routeCyan,
  },
  progressCaption: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  cockpitControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepCtrlBtn: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  stepCtrlText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  nextStepBtn: {
    flex: 1,
    backgroundColor: colors.navBlue,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextStepBtnText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '900' },
  turnStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  turnStepRowActive: {
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
    borderColor: 'rgba(29, 143, 225, 0.35)',
  },
  turnStepBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnStepBadgeActive: {
    backgroundColor: colors.navBlue,
  },
  turnStepIcon: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  turnStepTitle: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  turnStepDist: { color: colors.routeCyan, fontSize: 12, fontWeight: '800' },
  hazardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hazardActionBtn: {
    flex: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgElevated,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  hazardActionIcon: { fontSize: 15 },
  hazardActionLabel: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  plannerDrawerToggle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  plannerDrawerToggleText: { color: colors.navBlue, fontSize: 12.5, fontWeight: '800' },
  etaPillBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  etaArrival: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  etaMetrics: { color: colors.routeCyan, fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  syncPill: {
    backgroundColor: 'rgba(29, 143, 225, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  syncText: { color: colors.navBlue, fontSize: 12, fontWeight: '800' },
  endTripPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  endTripText: { color: colors.statusDanger, fontSize: 12, fontWeight: '800' },
  arrivedBadge: { color: colors.statusWarning, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  arrivedTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  stopLineRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 5 },
  stopPrimary: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  stopActions: { flexDirection: 'row', gap: 6 },
  stopIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopIconText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  addStopBtn: {
    alignSelf: 'flex-start',
    marginLeft: 22,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  addStopText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700' },
  addStopBox: {
    marginLeft: 22,
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.card,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  result: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  mode: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
  big: { color: colors.routeCyan, fontSize: 26, fontWeight: '800', marginTop: 2 },
  detailToggle: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  expandedDetails: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  routeStrip: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: 6,
  },
  routeStripText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  keepRouteBtn: {
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keepRouteText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '800' },
  routeMonitorStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 8,
  },
  routeMonitorText: { flex: 1, color: colors.textSecondary, fontSize: 11.5, fontWeight: '600' },
  routeMonitorAction: { color: colors.navBlue, fontSize: 11.5, fontWeight: '800' },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventAlertText: { flex: 1, color: colors.textPrimary, fontSize: 12.5, fontWeight: '600' },
  tierChip: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  tierChipText: { color: colors.statusSuccess, fontSize: 10.5, fontWeight: '800' },
  whyBtn: {
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(29, 143, 225, 0.35)',
  },
  whyBtnActive: {
    backgroundColor: 'rgba(42, 224, 196, 0.2)',
    borderColor: colors.routeCyan,
  },
  whyBtnText: { color: colors.routeCyan, fontSize: 12, fontWeight: '800' },
  legPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  legPill: {
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  legPillText: { color: colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  fsLaunchPill: {
    backgroundColor: 'rgba(15, 107, 78, 0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  fsLaunchText: { color: '#6EE7B7', fontSize: 11, fontWeight: '800' },
  rapidoDock: {
    backgroundColor: 'rgba(10, 16, 24, 0.98)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 10,
  },
  rapidoHeader: { gap: 8 },
  rapidoHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  rapidoEta: { color: colors.textPrimary, fontSize: 20, fontWeight: '900' },
  rapidoArriveSub: { color: colors.routeCyan, fontSize: 14, fontWeight: '700' },
  rapidoMeta: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  rapidoExpandPill: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  rapidoExpandText: { color: colors.routeCyan, fontSize: 11.5, fontWeight: '800' },
  rapidoDetourCard: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  rapidoToolsBox: { gap: 8 },
  rapidoQuickRow: { flexDirection: 'row', gap: 6 },
  rapidoToolBtn: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  rapidoToolText: { color: colors.textPrimary, fontSize: 11.5, fontWeight: '700' },
  rapidoBottomActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
  rapidoPreviewBar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rapidoMinimizeBtn: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rapidoMinimizeText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '800' },
  rapidoSyncBtn: {
    backgroundColor: 'rgba(29, 143, 225, 0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.navBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rapidoSyncText: { color: colors.routeCyan, fontSize: 12.5, fontWeight: '800' },
  rapidoFinishBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rapidoFinishText: { color: '#03120B', fontSize: 13.5, fontWeight: '900' },
  rapidoExplainCard: {
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.35)',
    gap: 4,
  },
  rapidoExplainTitle: { color: colors.routeCyan, fontSize: 11.5, fontWeight: '800' },
  rapidoExplainText: { color: colors.textPrimary, fontSize: 12, lineHeight: 17 },
});
