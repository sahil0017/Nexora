import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radii, spacing, typography } from '../../../app/theme/tokens';
import { Card } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { DigitalTwinState, PrivacyStatus } from '../../../core/api/move';

type Props = {
  twin?: DigitalTwinState;
  privacy?: PrivacyStatus;
  loading?: boolean;
  onReportAnimal?: () => void;
  onReinforceRoadMemory?: (condition: string) => void;
  onContributePrivacyPing?: () => void;
  submittingAction?: boolean;
};

const gradeTone = (grade: string): 'success' | 'info' | 'warning' | 'danger' => {
  if (grade === 'A') return 'success';
  if (grade === 'B') return 'info';
  if (grade === 'C') return 'warning';
  return 'danger';
};

const riskTone = (level: string): 'success' | 'warning' | 'danger' => {
  if (level === 'high') return 'danger';
  if (level === 'moderate') return 'warning';
  return 'success';
};

export function DigitalTwinOverviewCard({
  twin,
  privacy,
  loading,
  onReportAnimal,
  onReinforceRoadMemory,
  onContributePrivacyPing,
  submittingAction,
}: Props) {
  if (loading && !twin) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>City Mobility Pulse</Text>
        <Text style={styles.muted}>Syncing live area mobility conditions…</Text>
      </Card>
    );
  }
  if (!twin) return null;

  const humanPct = Math.round((twin.cross_domain?.human_crowd_density ?? 0) * 100);
  const vehPct = Math.round((twin.cross_domain?.vehicle_congestion_index ?? 0) * 100);
  const aniPct = Math.round((twin.cross_domain?.animal_conflict_index ?? 0) * 100);

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>CITY MOBILITY PULSE</Text>
          <Text style={styles.title}>Area Movement Overview</Text>
        </View>
        <StatusPill
          tone={twin.system_health_index >= 75 ? 'success' : twin.system_health_index >= 55 ? 'warning' : 'danger'}
          label={`Score ${Math.round(twin.system_health_index)}/100`}
        />
      </View>

      <Text style={styles.subText}>
        Primary pattern:{' '}
        <Text style={styles.highlight}>{(twin.cross_domain?.dominant_interaction ?? 'balanced').replace(/_/g, ' ')}</Text>
      </Text>

      {/* Activity meters */}
      <View style={styles.meterBlock}>
        <MeterRow label="Pedestrian & Crowd" pct={humanPct} color={colors.routeCyan} />
        <MeterRow label="Vehicle Load" pct={vehPct} color={colors.navBlue} />
        <MeterRow label="Roadside Hazard Risk" pct={aniPct} color={colors.statusWarning} />
      </View>

      {/* Crowd Forecast Horizons */}
      {(twin.crowd_intelligence?.forecasts ?? []).length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming Crowd Forecast</Text>
          <View style={styles.horizonRow}>
            {twin.crowd_intelligence.forecasts.slice(0, 3).map(f => (
              <View key={f.horizon_minutes} style={styles.horizonPill}>
                <Text style={styles.horizonLabel}>+{f.horizon_minutes}m</Text>
                <Text style={styles.horizonVal}>{Math.round(f.predicted_crowd_density * 100)}%</Text>
                <Text style={styles.horizonRisk}>{f.bottleneck_risk}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Pedestrian Safety & Roadside Alerts */}
      <View style={styles.safetyGrid}>
        <View style={styles.safetyBox}>
          <View style={styles.safetyTop}>
            <Text style={styles.safetyLabel}>Walk Safety</Text>
            <StatusPill
              tone={gradeTone(twin.pedestrian_safety?.safety_grade ?? 'B')}
              label={`Grade ${twin.pedestrian_safety?.safety_grade ?? 'B'} · ${Math.round(twin.pedestrian_safety?.walk_safety_score ?? 0)}`}
            />
          </View>
          <Text style={styles.safetyHint} numberOfLines={2}>
            {twin.pedestrian_safety?.recommendation ?? 'Use well-lit crossings.'}
          </Text>
        </View>

        <View style={styles.safetyBox}>
          <View style={styles.safetyTop}>
            <Text style={styles.safetyLabel}>Animal Crossing</Text>
            <StatusPill
              tone={riskTone(twin.animal_conflict?.risk_level ?? 'low')}
              label={`${(twin.animal_conflict?.risk_level ?? 'low').toUpperCase()} · ${Math.round((twin.animal_conflict?.conflict_risk_score ?? 0) * 100)}%`}
            />
          </View>
          <Text style={styles.safetyHint} numberOfLines={2}>
            {twin.animal_conflict?.mitigation_advice ?? 'Low corridor crossing risk.'}
          </Text>
          {onReportAnimal ? (
            <View style={{ marginTop: spacing.xs }}>
              <Chip
                label={submittingAction ? 'Logging…' : 'Report Animal Crossing'}
                onPress={onReportAnimal}
              />
            </View>
          ) : null}
        </View>
      </View>

      {/* Road Memory Network */}
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>
            Road Conditions ({(twin.road_memory_nodes ?? []).length} active)
          </Text>
          <StatusPill tone="info" label="Community Verified" />
        </View>
        {(twin.road_memory_nodes ?? []).length === 0 ? (
          <Text style={styles.muted}>No active road anomalies reported along this corridor.</Text>
        ) : (
          (twin.road_memory_nodes ?? []).slice(0, 3).map(n => (
            <View key={n.node_id} style={styles.memoryRow}>
              <Text style={styles.memoryText}>
                {n.condition_type.replace(/_/g, ' ')} · {n.observation_count} reports ({Math.round(n.confidence * 100)}% confidence)
              </Text>
              <StatusPill tone={n.quorum_verified ? 'success' : 'warning'} label={n.quorum_verified ? 'Verified' : 'Pending'} />
            </View>
          ))
        )}
        {onReinforceRoadMemory ? (
          <View style={styles.chipRow}>
            <Chip label="+ Log Waterlogging" onPress={() => onReinforceRoadMemory('waterlogging')} />
            <Chip label="+ Log Pothole" onPress={() => onReinforceRoadMemory('pothole')} />
          </View>
        ) : null}
      </View>

      {/* Privacy Shield */}
      <View style={styles.privacyBar}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.privacyText}>Privacy Shield Active</Text>
            <Text style={styles.privacyMeta}>
              {privacy
                ? 'Location updates are anonymized before sharing.'
                : 'No personal identifiers stored.'}
            </Text>
          </View>
          {onContributePrivacyPing ? (
            <Chip
              label={submittingAction ? 'Sending…' : 'Share Update'}
              onPress={onContributePrivacyPing}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

function MeterRow({ label, pct, color }: { label: string; pct: number; color: string }) {
  const safePct = Math.max(4, Math.min(100, pct));
  return (
    <View style={styles.meterRow}>
      <View style={styles.meterLabels}>
        <Text style={styles.meterName}>{label}</Text>
        <Text style={styles.meterPct}>{pct}%</Text>
      </View>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${safePct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.m, gap: spacing.s },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  kicker: { ...typography.caption, color: colors.routeCyan, fontWeight: '700', letterSpacing: 0.6 },
  title: { ...typography.sectionHeading, color: colors.textPrimary, marginTop: 2 },
  subText: { fontFamily: fontFamily.sans, fontSize: 12, color: colors.textSecondary },
  highlight: { color: colors.textPrimary, fontWeight: '600', textTransform: 'capitalize' },
  muted: { fontFamily: fontFamily.sans, fontSize: 12, color: colors.textMuted },
  meterBlock: { gap: spacing.xs, marginTop: spacing.xs },
  meterRow: { gap: 4 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meterName: { fontFamily: fontFamily.medium, color: colors.textSecondary, fontSize: 11.5 },
  meterPct: { fontFamily: fontFamily.medium, color: colors.textPrimary, fontSize: 11.5, fontWeight: '600' },
  meterTrack: { height: 7, borderRadius: 4, backgroundColor: colors.bgPrimary, overflow: 'hidden' },
  meterFill: { height: 7, borderRadius: 4 },
  section: { gap: spacing.s, marginTop: spacing.xs },
  sectionTitle: { fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textPrimary, fontWeight: '600' },
  horizonRow: { flexDirection: 'row', gap: spacing.s },
  horizonPill: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
  },
  horizonLabel: { ...typography.caption, color: colors.textMuted },
  horizonVal: { fontFamily: fontFamily.sans, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  horizonRisk: { ...typography.caption, color: colors.routeCyan, textTransform: 'capitalize' },
  safetyGrid: { gap: spacing.s, marginTop: spacing.xs },
  safetyBox: {
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 10,
    gap: 6,
  },
  safetyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: spacing.s },
  safetyLabel: { fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textPrimary, fontWeight: '600' },
  safetyHint: { fontFamily: fontFamily.sans, color: colors.textSecondary, fontSize: 11.5, lineHeight: 16 },
  memoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.button,
  },
  memoryText: { fontFamily: fontFamily.sans, fontSize: 12, color: colors.textPrimary, textTransform: 'capitalize', flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  privacyBar: {
    marginTop: spacing.xs,
    padding: 10,
    borderRadius: radii.button,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  privacyText: { fontFamily: fontFamily.medium, color: colors.accentBright, fontSize: 11.5, fontWeight: '600' },
  privacyMeta: { fontFamily: fontFamily.sans, color: colors.textSecondary, fontSize: 11 },
});
