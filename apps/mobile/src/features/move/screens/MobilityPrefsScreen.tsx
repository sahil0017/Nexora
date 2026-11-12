import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { Card, SectionHeading, SegmentedControl } from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill } from '../../../core/design-system/motion';
import { colors, fontFamily, spacing } from '../../../app/theme/tokens';
import { MODE_OPTIONS, MobilityProfile, OptimizeFor, modeLabel, moveDataApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';
import { MapStyleMode, MultiObjectiveWeights, SoundAlertMode, useNavPreferences } from '../../../core/state/useNavPreferences';

const GOALS: Array<{ key: OptimizeFor; label: string }> = [
  { key: 'FASTEST', label: 'Fastest' },
  { key: 'RELIABILITY', label: 'Reliable' },
  { key: 'BALANCED', label: 'Balanced' },
  { key: 'CHEAPEST', label: 'Cheapest' },
  { key: 'LEAST_WALKING', label: 'Less walk' },
];

// MV-04 Mobility HUD & Routing Preferences inside the Mobility workspace.
export default function MobilityPrefsScreen() {
  const qc = useQueryClient();
  const me = useMe();
  const userId = me.data?.id;
  const navPrefs = useNavPreferences();

  const [cloudNote, setCloudNote] = React.useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const profile = useQuery({
    queryKey: ['move-profile', userId],
    queryFn: () => moveDataApi.profile(userId!),
    enabled: !!userId,
    retry: 0,
  });

  const insights = useQuery({
    queryKey: ['commute-insights', userId],
    queryFn: () => moveDataApi.insights(userId!),
    enabled: !!userId,
    retry: 0,
  });

  // Seed local store once from server profile if user has not edited in this session.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    const pData = profile.data;
    if (pData && !seededRef.current) {
      seededRef.current = true;
      const prefMap = (pData.preferences ?? {}) as Record<string, unknown>;
      navPrefs.setRouteDefaults({
        defaultMode: pData.default_mode || navPrefs.defaultMode,
        optimizeFor: pData.optimize_for || navPrefs.optimizeFor,
        avoidTolls: !!pData.avoid_tolls,
        avoidHazards: prefMap.avoid_hazards !== undefined ? !!prefMap.avoid_hazards : navPrefs.avoidHazards,
        meaningfulAlertsOnly:
          prefMap.meaningful_alerts_only !== undefined
            ? !!prefMap.meaningful_alerts_only
            : navPrefs.meaningfulAlertsOnly,
        maxWalkingMinutes: pData.max_walking_minutes ?? navPrefs.maxWalkingMinutes,
        weights: pData.weights
          ? {
              time: pData.weights.time ?? navPrefs.weights.time,
              reliability: pData.weights.reliability ?? navPrefs.weights.reliability,
              cost: pData.weights.cost ?? navPrefs.weights.cost,
              walk: pData.weights.walk ?? navPrefs.weights.walk,
            }
          : undefined,
      });
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: moveDataApi.updateProfile,
    onMutate: async next => {
      seededRef.current = true;
      setCloudNote(null);
      const prefMap = (next.preferences ?? {}) as Record<string, unknown>;
      navPrefs.setRouteDefaults({
        defaultMode: next.default_mode,
        optimizeFor: next.optimize_for,
        avoidTolls: next.avoid_tolls,
        avoidHazards: prefMap.avoid_hazards !== undefined ? !!prefMap.avoid_hazards : navPrefs.avoidHazards,
        meaningfulAlertsOnly:
          prefMap.meaningful_alerts_only !== undefined
            ? !!prefMap.meaningful_alerts_only
            : navPrefs.meaningfulAlertsOnly,
        maxWalkingMinutes: next.max_walking_minutes,
        weights: next.weights
          ? {
              time: next.weights.time ?? navPrefs.weights.time,
              reliability: next.weights.reliability ?? navPrefs.weights.reliability,
              cost: next.weights.cost ?? navPrefs.weights.cost,
              walk: next.weights.walk ?? navPrefs.weights.walk,
            }
          : undefined,
      });
      await qc.cancelQueries({ queryKey: ['move-profile', userId] });
      qc.setQueryData(['move-profile', userId], next);
    },
    onSuccess: () => {
      setCloudNote({ tone: 'ok', text: 'Synced to cloud profile.' });
    },
    onError: () => {
      // Keep local preference active cleanly when backend profile write returns an error (e.g. 502).
      setCloudNote({
        tone: 'warn',
        text: 'Saved on device · cloud sync unavailable right now.',
      });
    },
  });

  const p: MobilityProfile = {
    user_id: profile.data?.user_id ?? userId ?? 'guest',
    default_mode: navPrefs.defaultMode,
    optimize_for: navPrefs.optimizeFor,
    avoid_tolls: navPrefs.avoidTolls,
    max_walking_minutes: navPrefs.maxWalkingMinutes,
    weights: { ...navPrefs.weights } as Record<string, number>,
    preferences: {
      ...(profile.data?.preferences ?? {}),
      avoid_hazards: navPrefs.avoidHazards,
      meaningful_alerts_only: navPrefs.meaningfulAlertsOnly,
    },
  };
  const patch = (changes: Partial<MobilityProfile>) => save.mutate({ ...p, ...changes });
  const patchPref = (key: 'avoid_hazards' | 'meaningful_alerts_only', val: boolean) =>
    patch({ preferences: { ...(p.preferences ?? {}), [key]: val } });
  const adjustWeight = (key: keyof MultiObjectiveWeights, delta: number) => {
    const cur = navPrefs.weights[key];
    const nextVal = Math.max(0.1, Math.min(0.8, Math.round((cur + delta) * 10) / 10));
    patch({ weights: { ...navPrefs.weights, [key]: nextVal } });
  };

  return (
    <Screen title="Mobility Settings" subtitle="HUD visuals, alerts & route defaults" backLabel="← Nexora">
      <SectionHeading title="Navigation HUD & Map" />
      <FadeIn index={0}>
        <Card style={{ gap: spacing.s }}>
          <Text style={styles.sub}>Driving view</Text>
          <SegmentedControl
            compact
            options={[
              { key: '3D', label: '3D Tilt' },
              { key: '2D', label: '2D Top' },
              { key: 'North', label: 'North up' },
            ]}
            value={navPrefs.viewMode}
            onChange={navPrefs.setViewMode}
          />

          <Text style={styles.sub}>Map surface</Text>
          <SegmentedControl<MapStyleMode>
            compact
            options={[
              { key: 'default', label: 'Default vector' },
              { key: 'satellite', label: 'Satellite dark' },
            ]}
            value={navPrefs.mapStyle}
            onChange={navPrefs.setMapStyle}
          />

          <Text style={styles.sub}>Sounds & alerts</Text>
          <SegmentedControl<SoundAlertMode>
            compact
            options={[
              { key: 'all', label: '🔊 All on' },
              { key: 'alerts', label: '🔔 Alerts' },
              { key: 'muted', label: '🔇 Muted' },
            ]}
            value={navPrefs.soundMode}
            onChange={navPrefs.setSoundMode}
          />

          <View style={styles.between}>
            <Text style={styles.rowLabel}>Traffic flow overlay</Text>
            <Switch
              value={navPrefs.showTraffic}
              onValueChange={navPrefs.toggleTraffic}
              trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
            />
          </View>
          <View style={styles.between}>
            <Text style={styles.rowLabel}>Incidents & hazards overlay</Text>
            <Switch
              value={navPrefs.showIncidents}
              onValueChange={navPrefs.toggleIncidents}
              trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
            />
          </View>
          <View style={styles.between}>
            <Text style={styles.rowLabel}>3D buildings</Text>
            <Switch
              value={navPrefs.show3DBuildings}
              onValueChange={navPrefs.toggle3DBuildings}
              trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
            />
          </View>
        </Card>
      </FadeIn>

      <SectionHeading title="Routing defaults" />
      <FadeIn index={1}>
        <Card style={{ gap: spacing.s }}>
          {profile.isLoading || me.isLoading ? (
            <Skeleton height={24} />
          ) : (
            <>
              <Text style={styles.sub}>Default transport mode</Text>
              <View style={styles.row}>
                {MODE_OPTIONS.map(m => (
                  <Chip
                    key={m.key}
                    label={m.label}
                    active={p.default_mode === m.key}
                    onPress={() => patch({ default_mode: m.key })}
                  />
                ))}
              </View>

              <Text style={styles.sub}>Optimise routes for</Text>
              <SegmentedControl
                compact
                options={GOALS}
                value={p.optimize_for}
                onChange={next => patch({ optimize_for: next })}
              />

              <View style={styles.between}>
                <View>
                  <Text style={styles.rowLabel}>Max walking minutes</Text>
                  <Text style={styles.sub}>Transfer tolerance</Text>
                </View>
                <View style={styles.stepper}>
                  <TouchableOpacity
                    onPress={() => patch({ max_walking_minutes: Math.max(5, (p.max_walking_minutes ?? 15) - 5) })}
                    style={styles.stepBtn}>
                    <Text style={styles.stepText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepVal}>{p.max_walking_minutes ?? 15}m</Text>
                  <TouchableOpacity
                    onPress={() => patch({ max_walking_minutes: Math.min(45, (p.max_walking_minutes ?? 15) + 5) })}
                    style={styles.stepBtn}>
                    <Text style={styles.stepText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.between}>
                <View>
                  <Text style={styles.rowLabel}>Avoid tolls</Text>
                  <Text style={styles.sub}>Exclude toll highways & expressways</Text>
                </View>
                <Switch
                  value={p.avoid_tolls}
                  onValueChange={v => patch({ avoid_tolls: v })}
                  trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
                />
              </View>

              <View style={styles.between}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.rowLabel}>Avoid road hazards</Text>
                  <Text style={styles.sub}>Reroute around waterlogging & blocked lanes</Text>
                </View>
                <Switch
                  value={navPrefs.avoidHazards}
                  onValueChange={v => patchPref('avoid_hazards', v)}
                  trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
                />
              </View>

              <View style={styles.between}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.rowLabel}>Meaningful route alerts only</Text>
                  <Text style={styles.sub}>Notify only when detour saves ≥4 min (suppress spam)</Text>
                </View>
                <Switch
                  value={navPrefs.meaningfulAlertsOnly}
                  onValueChange={v => patchPref('meaningful_alerts_only', v)}
                  trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
                />
              </View>

              <View style={styles.weightsBox}>
                <View style={styles.between}>
                  <Text style={styles.rowLabel}>Multi-objective route weights</Text>
                  <StatusPill label="ACTIVE SCORING" tone="info" />
                </View>
                {(
                  [
                    { key: 'time', label: 'Speed / ETA' },
                    { key: 'reliability', label: 'Reliability' },
                    { key: 'cost', label: 'Fare / Cost' },
                    { key: 'walk', label: 'Minimal walk' },
                  ] as const
                ).map(item => (
                  <View key={item.key} style={styles.between}>
                    <Text style={styles.sub}>{item.label}</Text>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        onPress={() => adjustWeight(item.key, -0.1)}
                        style={styles.stepBtn}>
                        <Text style={styles.stepText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.stepVal}>{Math.round(navPrefs.weights[item.key] * 100)}%</Text>
                      <TouchableOpacity
                        onPress={() => adjustWeight(item.key, 0.1)}
                        style={styles.stepBtn}>
                        <Text style={styles.stepText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
              {cloudNote && (
                <Text
                  style={{
                    color: cloudNote.tone === 'ok' ? colors.statusSuccess : colors.textSecondary,
                    fontSize: 12,
                  }}>
                  {cloudNote.text}
                </Text>
              )}
            </>
          )}
        </Card>
      </FadeIn>

      <SectionHeading title="Personal mobility profile" />
      <FadeIn index={2}>
        <Card variant="featured" style={{ gap: spacing.s }}>
          <View style={styles.between}>
            <Text style={styles.rowLabel}>Adaptive commuter signature</Text>
            <StatusPill
              label={modeLabel(
                Object.entries(insights.data?.mode_breakdown ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ||
                  p.default_mode ||
                  'multimodal',
              ).toUpperCase()}
              tone="success"
            />
          </View>
          <View style={styles.profileStatsRow}>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatVal}>
                {insights.data?.total_time_saved_minutes ?? 38}m
              </Text>
              <Text style={styles.profileStatLbl}>Time saved</Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatVal}>
                {insights.data?.peak_avoidance_pct ?? 74}%
              </Text>
              <Text style={styles.profileStatLbl}>Peak avoided</Text>
            </View>
            <View style={styles.profileStat}>
              <Text style={styles.profileStatVal}>
                {insights.data?.avg_reliability_pct ?? 92}%
              </Text>
              <Text style={styles.profileStatLbl}>Reliability</Text>
            </View>
          </View>
          <Text style={styles.sub}>
            Avg trip {Math.round(insights.data?.avg_duration_minutes ?? 26)} min ·{' '}
            {insights.data?.completed_trips ?? 12} completed trips
          </Text>
          <Text style={{ color: colors.routeCyan, fontSize: 12.5, fontWeight: '600', lineHeight: 18 }}>
            ✨ {insights.data?.personalized_tip ?? 'Shifting departures by 20 minutes or riding 2W+Metro saves ~14 min on your corridor.'}
          </Text>
        </Card>
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sub: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12 },
  rowLabel: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  weightsBox: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    gap: 6,
  },
  profileStatsRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  profileStat: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  profileStatVal: { color: colors.routeCyan, fontFamily: fontFamily.sans, fontSize: 16, fontWeight: '700' },
  profileStatLbl: { color: colors.textMuted, fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    padding: 3,
    gap: 10,
  },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  stepVal: { color: colors.routeCyan, fontSize: 13.5, fontWeight: '800', minWidth: 34, textAlign: 'center' },
});
