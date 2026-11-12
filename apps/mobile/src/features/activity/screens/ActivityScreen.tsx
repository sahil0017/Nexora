import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavMapCanvas, QuickReportHazardKind } from '../../../shared/components/NavMapCanvas';
import { QuickSettingsSheet } from '../../../shared/components/QuickSettingsSheet';
import {
  Card,
  EmptyState,
  PrimaryButton,
  SectionHeading,
  SegmentedControl,
} from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { colors, spacing, typography } from '../../../app/theme/tokens';
import { digitalTwinApi, modeLabel, moveApi, moveDataApi } from '../../../core/api/move';
import { DigitalTwinOverviewCard } from '../../move/components/DigitalTwinOverviewCard';
import { UrbanSimulatorCard } from '../../move/components/UrbanSimulatorCard';
import { useMe } from '../../../core/auth/useMe';
import { useLocation } from '../../../core/location/useLocation';

const HAZARD_TYPES = [
  { key: 'pothole', label: 'Pothole' },
  { key: 'waterlogging', label: 'Waterlogging' },
  { key: 'blocked_lane', label: 'Blocked lane' },
  { key: 'damaged_road', label: 'Damaged road' },
] as const;

const LENSES = [
  { key: 'all', label: 'Overview' },
  { key: 'twin', label: 'Digital Twin' },
  { key: 'traffic', label: 'Traffic & H3' },
  { key: 'transit', label: 'Transit' },
  { key: 'hazards', label: 'Hazards' },
] as const;

const WEATHER_OPTS = ['clear', 'rain', 'peak'] as const;
const HORIZONS = [
  { key: '15', label: '+15m' },
  { key: '30', label: '+30m' },
  { key: '60', label: '+60m' },
] as const;

const sevColor = (s: string) =>
  s === 'critical' || s === 'high' ? colors.statusDanger : s === 'medium' ? colors.statusWarning : colors.textSecondary;

// AC-01 Interactive Live Radar & Telemetry Activity screen.
export default function ActivityScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;

  const [lens, setLens] = useState<(typeof LENSES)[number]['key']>('all');
  const [weather, setWeather] = useState<(typeof WEATHER_OPTS)[number]>('clear');
  const [horizonMin, setHorizonMin] = useState<(typeof HORIZONS)[number]['key']>('30');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [focusedMode, setFocusedMode] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [radarFullScreen, setRadarFullScreen] = useState(false);
  const [radarTraceOn, setRadarTraceOn] = useState(true);

  const loc = useLocation({
    watch: radarFullScreen,
    traceEnabled: radarFullScreen && radarTraceOn,
    distanceIntervalM: 5,
    timeIntervalMs: 3000,
  });

  const spatialRadarQuery = useQuery({
    queryKey: ['spatial-radar-activity', loc.point ? Math.round(loc.point.latitude * 200) : null, loc.point ? Math.round(loc.point.longitude * 200) : null],
    queryFn: () => moveDataApi.spatialRadar(loc.point!, 2500),
    enabled: !!loc.point && radarFullScreen,
    refetchInterval: 12_000,
    retry: 0,
  });

  const insights = useQuery({
    queryKey: ['commute-insights', userId],
    queryFn: () => moveDataApi.insights(userId!),
    enabled: !!userId,
    retry: 0,
  });
  const hazards = useQuery({
    queryKey: ['hazards-nearby', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.nearbyHazards(loc.point!, 5000),
    enabled: !!loc.point,
    retry: 0,
  });
  const demand = useQuery({
    queryKey: ['zone-demand', loc.point?.latitude, loc.point?.longitude, weather],
    queryFn: () => moveApi.predictDemand(loc.point!, weather),
    enabled: !!loc.point,
    retry: 0,
  });
  const trafficSegs = useQuery({
    queryKey: ['traffic-segments', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.trafficSegments(loc.point!, 3000),
    enabled: !!loc.point,
    retry: 0,
  });
  const trafficForecast = useQuery({
    queryKey: ['traffic-predictions', horizonMin],
    queryFn: () => moveApi.trafficPredictions(['seg-1', 'seg-2'], Number(horizonMin)),
    retry: 0,
  });
  const anomalies = useQuery({
    queryKey: ['traffic-anomalies', weather],
    queryFn: () => moveApi.trafficAnomalies(['seg-1', 'seg-2', 'seg-3'], weather),
    retry: 0,
  });
  const cityEvents = useQuery({
    queryKey: ['active-city-events', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.activeEvents(loc.point),
    retry: 0,
  });
  const stops = useQuery({
    queryKey: ['transit-stops', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => moveApi.nearbyStops(loc.point!, 1500),
    enabled: !!loc.point,
    retry: 0,
  });
  const departures = useQuery({
    queryKey: ['transit-departures', selectedStopId],
    queryFn: () => moveApi.transitDepartures(selectedStopId!),
    enabled: !!selectedStopId,
    retry: 0,
  });
  const hotspots = useQuery({
    queryKey: ['h3-hotspots', loc.point?.latitude, loc.point?.longitude],
    queryFn: () =>
      moveApi.discoverHotspots([
        { latitude: loc.point!.latitude, longitude: loc.point!.longitude, speed_mps: 4.5 },
        { latitude: loc.point!.latitude + 0.001, longitude: loc.point!.longitude + 0.001, speed_mps: 3.8 },
        { latitude: loc.point!.latitude + 0.002, longitude: loc.point!.longitude, speed_mps: 4.1 },
      ]),
    enabled: !!loc.point,
    retry: 0,
  });
  const reportHazard = useMutation({
    mutationFn: (cat: (typeof HAZARD_TYPES)[number]['key']) =>
      moveApi.reportHazard({
        user_id: userId,
        latitude: loc.point!.latitude,
        longitude: loc.point!.longitude,
        hint_category: cat,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hazards-nearby'] });
      qc.invalidateQueries({ queryKey: ['intelligence-status'] });
    },
  });
  const status = useQuery({
    queryKey: ['intelligence-status'],
    queryFn: moveApi.intelligenceStatus,
    refetchInterval: 30_000,
    retry: 0,
  });

  const digitalTwin = useQuery({
    queryKey: ['digital-twin-state', loc.point?.latitude, loc.point?.longitude, weather],
    queryFn: () => digitalTwinApi.state(loc.point!, weather),
    enabled: !!loc.point,
    retry: 0,
  });

  const privacyStatus = useQuery({
    queryKey: ['privacy-status'],
    queryFn: digitalTwinApi.privacyStatus,
    retry: 0,
  });

  const runSimulation = useMutation({
    mutationFn: (vars: {
      intervention_type: 'car_free_zone' | 'signal_retime' | 'transit_boost' | 'speed_calming' | 'bus_lane';
      intensity_pct: number;
    }) =>
      digitalTwinApi.simulate({
        latitude: loc.point!.latitude,
        longitude: loc.point!.longitude,
        intervention_type: vars.intervention_type,
        intensity_pct: vars.intensity_pct,
      }),
  });

  const reportAnimal = useMutation({
    mutationFn: () =>
      digitalTwinApi.reportAnimalSighting({
        latitude: loc.point!.latitude,
        longitude: loc.point!.longitude,
        species_group: 'stray_cattle_or_dog',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digital-twin-state'] }),
  });

  const observeRoadMemory = useMutation({
    mutationFn: (condition_type: string) =>
      digitalTwinApi.observeRoadMemory({
        latitude: loc.point!.latitude,
        longitude: loc.point!.longitude,
        condition_type,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['digital-twin-state'] }),
  });

  const sendAnonymousPing = useMutation({
    mutationFn: () =>
      digitalTwinApi.sendPrivacyTelemetry([
        {
          latitude: loc.point!.latitude,
          longitude: loc.point!.longitude,
          ephemeral_token: `eph-${Date.now()}`,
        },
      ]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy-status'] }),
  });

  const refreshing = insights.isRefetching || hazards.isRefetching || status.isRefetching || demand.isRefetching || digitalTwin.isRefetching;
  const refetchAll = () => {
    insights.refetch();
    hazards.refetch();
    demand.refetch();
    trafficSegs.refetch();
    stops.refetch();
    status.refetch();
    digitalTwin.refetch();
    privacyStatus.refetch();
  };

  const rawZone = demand.data?.zones?.[0];
  const rawForecast = demand.data?.forecasts?.[0];
  const zoneHorizon = rawZone?.horizons?.[0];
  const zone = rawZone
    ? {
        h3_index: rawZone.h3_index,
        predicted_demand: zoneHorizon?.predicted_demand ?? rawZone.predicted_demand ?? 0,
        surge_pressure: zoneHorizon?.surge_pressure ?? rawZone.surge_pressure ?? 1,
        transport_availability: zoneHorizon?.transport_availability ?? rawZone.transport_availability ?? 0,
        model_version: demand.data?.model_version ?? 'tft-prophet-xgb-v1',
      }
    : rawForecast
    ? {
        h3_index: rawForecast.h3_index,
        predicted_demand: rawForecast.predicted_demand_idx * 100,
        surge_pressure: rawForecast.surge_pressure,
        transport_availability: rawForecast.transport_avail_score,
        model_version: rawForecast.model_version ?? demand.data?.model_version ?? 'fallback',
      }
    : null;
  const i = insights.data;
  const modes = Object.entries(i?.mode_breakdown ?? {}).sort((a, b) => b[1] - a[1]);
  const total = modes.reduce((n, [, c]) => n + c, 0);
  const top = modes[0];

  const showSection = (key: 'commute' | 'hazards' | 'traffic' | 'transit' | 'twin') =>
    lens === 'all' || lens === key;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.m, paddingBottom: spacing.xl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.navBlue} />}>
        <View style={styles.topRow}>
          <TouchableOpacity
            onPress={() => (nav.canGoBack() ? nav.goBack() : nav.getParent()?.goBack())}
            style={styles.backBtn}
            accessibilityLabel="Back to Nexora">
            <Text style={styles.backText}>← Nexora</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.hudBtn}>
            <Text style={styles.hudBtnText}>⚙ HUD</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.screenTitle, { color: colors.textPrimary }]}>Live Radar</Text>
            <Text style={[typography.body, { color: colors.textSecondary, marginTop: 2 }]}>
              Mobility telemetry, demand & hazards
            </Text>
          </View>
        </View>

        {/* Live Radar Map */}
        <FadeIn>
          <NavMapCanvas
            origin={loc.point}
            hazards={hazards.data?.hazards ?? []}
            trafficSegments={trafficSegs.data?.segments ?? []}
            transitStops={stops.data?.stops ?? []}
            tracePoints={loc.tracePoints}
            liveHeadingDeg={loc.headingDeg}
            liveSpeedKmph={loc.speedKmph}
            accuracyM={loc.accuracyM}
            tracedDistanceM={loc.tracedDistanceM}
            tracingActive={radarTraceOn && loc.isWatching}
            onToggleTracing={() => setRadarTraceOn(v => !v)}
            onClearTrace={loc.clearTrace}
            spatialRadar={spatialRadarQuery.data}
            onQuickReportHazard={(kind: QuickReportHazardKind) => {
              if (!loc.point) return;
              if (kind === 'animal_crossing') {
                reportAnimal.mutate();
              } else if (kind === 'pothole' || kind === 'waterlogging') {
                observeRoadMemory.mutate(kind);
              } else {
                reportHazard.mutate(kind);
              }
            }}
            reportBusy={reportAnimal.isPending || observeRoadMemory.isPending || reportHazard.isPending}
            fullScreen={radarFullScreen}
            onToggleFullScreen={() => setRadarFullScreen(v => !v)}
            height={195}
            onOpenSettings={() => setSettingsOpen(true)}
            onRecenter={loc.refresh}
            onSelectStop={st => {
              setSelectedStopId(st.id);
              setLens('transit');
            }}
          />
        </FadeIn>

        <View style={{ marginVertical: spacing.m }}>
          <SegmentedControl compact options={[...LENSES]} value={lens} onChange={setLens} />
        </View>

        <FadeIn>
          <Card style={styles.between}>
            {status.isError ? (
              <StatusPill label="AI ENGINE · OFFLINE" tone="danger" />
            ) : status.data ? (
              <StatusPill
                label={status.data.brain_reachable ? 'AI ENGINE · LEARNING LIVE' : 'AI ENGINE · BASIC MODE'}
                tone={status.data.brain_reachable ? 'success' : 'warning'}
              />
            ) : (
              <Skeleton height={12} width={160} />
            )}
            <TouchableOpacity onPress={refetchAll}>
              <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>↻ Refresh</Text>
            </TouchableOpacity>
          </Card>
        </FadeIn>

        {showSection('twin') && loc.point && (
          <>
            <SectionHeading title="City Digital Twin & Urban Simulator" />
            <FadeIn>
              <DigitalTwinOverviewCard
                twin={digitalTwin.data}
                privacy={privacyStatus.data}
                loading={digitalTwin.isLoading}
                submittingAction={reportAnimal.isPending || observeRoadMemory.isPending || sendAnonymousPing.isPending}
                onReportAnimal={() => reportAnimal.mutate()}
                onReinforceRoadMemory={cond => observeRoadMemory.mutate(cond)}
                onContributePrivacyPing={() => sendAnonymousPing.mutate()}
              />
              <UrbanSimulatorCard
                result={runSimulation.data}
                running={runSimulation.isPending}
                onSimulate={(intervention_type, intensity_pct) =>
                  runSimulation.mutate({ intervention_type, intensity_pct })
                }
              />
            </FadeIn>
          </>
        )}

        {showSection('commute') && (
          <>
            <SectionHeading title="Your commute analytics" />
            <FadeIn index={1}>
              <Card>
                {insights.isLoading || me.isLoading ? (
                  <Skeleton height={40} />
                ) : insights.isError || !i ? (
                  <Text style={{ color: colors.textSecondary }}>Commute insights are unavailable right now.</Text>
                ) : i.completed_trips === 0 ? (
                  <EmptyState title="No completed trips yet" hint="Start & finish a route to unlock mode analytics." />
                ) : (
                  <>
                    <View style={styles.stats}>
                      <Stat label="Trips" value={String(i.completed_trips)} />
                      <Stat label="Avg time" value={`${Math.round(i.avg_duration_minutes)} min`} />
                      <Stat
                        label="Time saved"
                        value={`${Math.round(i.total_time_saved_minutes ?? Math.max(8, i.completed_trips * 4))}m`}
                      />
                      {i.avg_rating != null && <Stat label="Accuracy" value={`${i.avg_rating.toFixed(1)}★`} />}
                    </View>
                    {(i.peak_avoidance_pct != null || i.avg_reliability_pct != null) && (
                      <View style={styles.commuteMetaRow}>
                        {i.peak_avoidance_pct != null && (
                          <StatusPill label={`${Math.round(i.peak_avoidance_pct)}% PEAK AVOIDED`} tone="success" />
                        )}
                        {i.avg_reliability_pct != null && (
                          <StatusPill label={`${Math.round(i.avg_reliability_pct)}% ON-TIME`} tone="info" />
                        )}
                      </View>
                    )}
                    {top && (
                      <Text style={{ color: colors.textSecondary, marginTop: spacing.m, fontSize: 13 }}>
                        Primary mode: {modeLabel(top[0])} ({Math.round((top[1] / total) * 100)}% of trips).
                      </Text>
                    )}
                    {i.personalized_tip ? (
                      <Text style={{ color: colors.routeCyan, marginTop: 4, fontSize: 12.5, fontWeight: '600' }}>
                        ✨ {i.personalized_tip}
                      </Text>
                    ) : null}
                    {modes.map(([m, c]) => {
                      const active = focusedMode === m;
                      return (
                        <Tappable
                          key={m}
                          onPress={() => setFocusedMode(active ? null : m)}
                          style={{ marginTop: spacing.s }}>
                          <View style={styles.between}>
                            <Text style={[styles.sub, active && { color: colors.textPrimary, fontWeight: '700' }]}>
                              {modeLabel(m)}
                            </Text>
                            <Text style={styles.sub}>
                              {c} trip{c > 1 ? 's' : ''} ({Math.round((c / total) * 100)}%)
                            </Text>
                          </View>
                          <View style={styles.track}>
                            <View
                              style={[
                                styles.fill,
                                { width: `${(c / total) * 100}%`, backgroundColor: active ? colors.routeCyan : colors.navBlue },
                              ]}
                            />
                          </View>
                        </Tappable>
                      );
                    })}
                  </>
                )}
              </Card>
            </FadeIn>
          </>
        )}

        {showSection('hazards') && (
          <>
            <SectionHeading title="Road hazards & reporting" />
            <FadeIn index={2}>
              <Card style={{ gap: spacing.s }}>
                {!loc.point ? (
                  <Tappable onPress={loc.refresh}>
                    <Text style={{ color: colors.statusWarning }}>
                      {loc.loading ? 'Locating you…' : 'Enable GPS to see nearby road hazards — tap to retry.'}
                    </Text>
                  </Tappable>
                ) : hazards.isLoading ? (
                  <Skeleton height={14} />
                ) : hazards.isError ? (
                  <Text style={{ color: colors.textSecondary }}>Hazard data is unavailable right now.</Text>
                ) : hazards.data!.hazards.length === 0 ? (
                  <Text style={{ color: colors.textSecondary }}>No hazards reported within 5 km.</Text>
                ) : (
                  hazards.data!.hazards.map((h, idx) => (
                    <View key={idx} style={styles.between}>
                      <Text style={{ color: colors.textPrimary, textTransform: 'capitalize', fontWeight: '600' }}>
                        ⚠ {h.hazard_type.replace(/_/g, ' ')}
                      </Text>
                      <Text style={{ color: sevColor(h.severity), fontWeight: '700', textTransform: 'capitalize' }}>
                        {h.severity}
                      </Text>
                    </View>
                  ))
                )}
                {loc.point && (
                  <View style={{ marginTop: spacing.s, gap: spacing.s }}>
                    <Text style={styles.sub}>Tap to report hazard at current GPS pin:</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                      {HAZARD_TYPES.map(ht => (
                        <Chip key={ht.key} label={`+ ${ht.label}`} onPress={() => reportHazard.mutate(ht.key)} />
                      ))}
                    </View>
                    {reportHazard.isSuccess && (
                      <Text style={{ color: colors.statusSuccess, fontSize: 12.5, fontWeight: '700' }}>
                        ✓ Verified by {reportHazard.data.hazard_type.replace(/_/g, ' ')} detector.
                      </Text>
                    )}
                  </View>
                )}
              </Card>
            </FadeIn>
          </>
        )}

        {showSection('traffic') && (
          <>
            <SectionHeading title="Zone demand & weather simulator" />
            <FadeIn index={3}>
              <Card style={{ gap: spacing.s }}>
                <View style={{ flexDirection: 'row', gap: spacing.s }}>
                  {WEATHER_OPTS.map(w => (
                    <Chip key={w} label={w} active={weather === w} onPress={() => setWeather(w)} />
                  ))}
                </View>
                {demand.isFetching ? (
                  <Skeleton height={36} />
                ) : zone ? (
                  <>
                    <View style={styles.stats}>
                      <Stat label="Demand" value={String(Math.round(zone.predicted_demand))} />
                      <Stat label="Surge" value={`${zone.surge_pressure.toFixed(2)}x`} />
                      <Stat label="Transit avail." value={`${Math.round(zone.transport_availability * 100)}%`} />
                    </View>
                    <Text style={styles.sub}>
                      H3 Cell: {zone.h3_index} · Model: {zone.model_version}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.sub}>Demand forecast awaits GPS coordinates.</Text>
                )}
              </Card>
            </FadeIn>

            <SectionHeading title="STGCN traffic & horizon forecast" />
            <FadeIn index={4}>
              <Card style={{ gap: spacing.s }}>
                <SegmentedControl compact options={[...HORIZONS]} value={horizonMin} onChange={setHorizonMin} />
                {trafficSegs.data?.segments?.length ? (
                  trafficSegs.data.segments.slice(0, 3).map(seg => (
                    <View key={seg.segment_id} style={styles.between}>
                      <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{seg.segment_id}</Text>
                      <Text style={styles.sub}>
                        {Math.round(seg.current_speed_kmph)} km/h · {seg.congestion_level}
                      </Text>
                    </View>
                  ))
                ) : null}
                {trafficForecast.isFetching ? (
                  <Skeleton height={16} />
                ) : trafficForecast.data?.predictions?.length ? (
                  trafficForecast.data.predictions.map(p => (
                    <View key={p.segment_id} style={styles.between}>
                      <Text style={{ color: colors.textPrimary }}>
                        {p.segment_id} (+{horizonMin}m)
                      </Text>
                      <Text style={{ color: colors.routeCyan, fontWeight: '700' }}>
                        {Math.round(p.speed_kph)} km/h ({p.model_version})
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.sub}>Loading road segment telemetry…</Text>
                )}
                {hotspots.data?.hotspots?.length ? (
                  <Text style={[styles.sub, { marginTop: 4 }]}>
                    Active H3 Hotspot: {hotspots.data.hotspots[0].h3_index} ·{' '}
                    {hotspots.data.hotspots[0].severity ??
                      `${Math.round((hotspots.data.hotspots[0].congestion_score ?? 0) * 100)}% congestion`}
                    {hotspots.data.hotspots[0].avg_speed_kph != null
                      ? ` (${hotspots.data.hotspots[0].avg_speed_kph.toFixed(1)} km/h)`
                      : ''}
                  </Text>
                ) : null}
              </Card>
            </FadeIn>

            <SectionHeading title="Traffic anomalies & event alerts" />
            <FadeIn index={5}>
              <Card style={{ gap: spacing.s }}>
                <View style={styles.between}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>Corridor anomaly monitor</Text>
                  <StatusPill
                    label={
                      (anomalies.data?.active_anomaly_count ?? 0) > 0
                        ? `${anomalies.data?.active_anomaly_count} ANOMALIES`
                        : 'CORRIDOR NOMINAL'
                    }
                    tone={(anomalies.data?.active_anomaly_count ?? 0) > 0 ? 'warning' : 'success'}
                  />
                </View>

                {anomalies.data?.anomalies?.filter(a => a.is_anomaly).slice(0, 3).map((a, idx) => (
                  <View key={`${a.segment_id}-${idx}`} style={styles.anomalyBox}>
                    <View style={styles.between}>
                      <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 13 }}>
                        ⚠ {a.segment_id} · {a.severity.toUpperCase()}
                      </Text>
                      <Text style={{ color: colors.statusWarning, fontSize: 12, fontWeight: '800' }}>
                        -{Math.round(a.speed_drop_pct)}% speed (z={a.z_score.toFixed(1)})
                      </Text>
                    </View>
                    <Text style={styles.sub}>{a.cause_hint}</Text>
                  </View>
                )) ?? (
                  <Text style={styles.sub}>
                    EWMA residual monitor active · no abnormal slowdowns detected right now.
                  </Text>
                )}

                {cityEvents.data?.events?.length ? (
                  <View style={{ gap: 6, marginTop: 4 }}>
                    <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 13 }}>
                      Active city events ({cityEvents.data.events.length})
                    </Text>
                    {cityEvents.data.events.slice(0, 3).map((ev, idx) => (
                      <View key={`${ev.event_id ?? ev.title}-${idx}`} style={styles.anomalyBox}>
                        <View style={styles.between}>
                          <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 13 }}>{ev.title}</Text>
                          <StatusPill label={ev.category.toUpperCase()} tone="info" />
                        </View>
                        <Text style={styles.sub}>
                          {ev.advisory}
                          {ev.road_delay_multiplier
                            ? ` · +${Math.round((ev.road_delay_multiplier - 1) * 100)}% corridor delay`
                            : ''}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.sub}>No major public or stadium events impacting corridors nearby.</Text>
                )}
              </Card>
            </FadeIn>
          </>
        )}

        {showSection('transit') && (
          <>
            <SectionHeading title="Nearby metro & bus stops" />
            <FadeIn index={5}>
              <Card style={{ gap: spacing.s }}>
                {!loc.point ? (
                  <Text style={styles.sub}>Enable location to view nearby stops.</Text>
                ) : stops.isLoading ? (
                  <Skeleton height={14} />
                ) : stops.data?.stops?.length ? (
                  stops.data.stops.slice(0, 5).map(st => {
                    const isSelected = selectedStopId === st.id;
                    return (
                      <View key={st.id} style={styles.stopBox}>
                        <Tappable onPress={() => setSelectedStopId(isSelected ? null : st.id)} style={styles.between}>
                          <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>{st.name}</Text>
                          <Text style={{ color: colors.navBlue, fontSize: 12, fontWeight: '700' }}>
                            {st.mode.toUpperCase()} · {isSelected ? 'Hide ▲' : 'Departures ▼'}
                          </Text>
                        </Tappable>
                        {isSelected && departures.isFetching && <Skeleton height={14} width={160} />}
                        {isSelected && departures.data && (
                          <View style={{ marginTop: 8, gap: 6 }}>
                            <Text style={styles.sub}>Next departures ({departures.data.freshness}):</Text>
                            {departures.data.departures.slice(0, 3).map((d, idx) => (
                              <View key={idx} style={styles.between}>
                                <Text style={{ color: colors.textPrimary, fontSize: 13 }}>
                                  {d.route_id} → {d.headsign}
                                </Text>
                                <Text style={{ color: d.is_realtime ? colors.statusSuccess : colors.textSecondary, fontSize: 12 }}>
                                  {d.is_realtime ? '● Live' : 'Scheduled'}
                                </Text>
                              </View>
                            ))}
                            <PrimaryButton
                              title="Plan route via Navigate HUD"
                              variant="secondary"
                              onPress={() => nav.navigate('Navigate')}
                            />
                          </View>
                        )}
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.sub}>No stops indexed in range yet.</Text>
                )}
              </Card>
            </FadeIn>
          </>
        )}
      </ScrollView>

      <QuickSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={{ color: colors.routeCyan, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Text style={styles.sub}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  backText: { color: colors.statusInfo, fontSize: 12.5, fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.m },
  hudBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  hudBtnText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sub: { color: colors.textSecondary, fontSize: 12.5 },
  track: { height: 7, borderRadius: 4, backgroundColor: colors.bgElevated, marginTop: 4, overflow: 'hidden' },
  fill: { height: 7, borderRadius: 4 },
  stopBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 12,
  },
  commuteMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: spacing.s,
  },
  anomalyBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
});
