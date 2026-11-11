import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../../app/theme/tokens';
import { Card } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { DigitalTwinState, PrivacyStatus } from '../../../core/api/move';

type Props = {
  twin?: DigitalTwinState;
  privacy?: PrivacyStatus;
  loading?: boolean;
  onReportAnimal?: () => void;
  onReinforceRoadMemory?: (condition: string) => void;
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
  submittingAction,
}: Props) {
  if (loading && !twin) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>City Movement Digital Twin</Text>
        <Text style={styles.muted}>Syncing H3 cross-domain state (humans, vehicles, animals)…</Text>
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
          <Text style={styles.kicker}>12-PILLAR CITY DIGITAL TWIN</Text>
          <Text style={styles.title}>Cross-Domain Movement State</Text>
        </View>
        <StatusPill
          tone={twin.system_health_index >= 75 ? 'success' : twin.system_health_index >= 55 ? 'warning' : 'danger'}
          label={`Health ${Math.round(twin.system_health_index)}/100`}
        />
      </View>

      <Text style={styles.subText}>
        H3 Cell {twin.h3_index} · Dominant:{' '}
        <Text style={styles.highlight}>{(twin.cross_domain?.dominant_interaction ?? 'balanced').replace(/_/g, ' ')}</Text>
      </Text>

      {/* Cross-domain tensor meters */}
      <View style={styles.meterBlock}>
        <MeterRow label="Humans & Crowd" pct={humanPct} color={colors.routeCyan} />
        <MeterRow label="Vehicle Load" pct={vehPct} color={colors.navBlue} />
        <MeterRow label="Animal Conflict" pct={aniPct} color={colors.statusWarning} />
      </View>

      {/* Crowd Forecast Horizons */}
      {(twin.crowd_intelligence?.forecasts ?? []).length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Predictive Crowd Horizons</Text>
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

      {/* Pedestrian Safety & Animal Conflict */}
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
            <Text style={styles.safetyLabel}>Animal Conflict</Text>
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
            Road Memory Network ({(twin.road_memory_nodes ?? []).length} active nodes)
          </Text>
          <StatusPill tone="info" label="Bayesian Quorum" />
        </View>
        {(twin.road_memory_nodes ?? []).length === 0 ? (
          <Text style={styles.muted}>No decaying road anomalies in this 5 km corridor.</Text>
        ) : (
          (twin.road_memory_nodes ?? []).slice(0, 3).map(n => (
            <View key={n.node_id} style={styles.memoryRow}>
              <Text style={styles.memoryText}>
                {n.condition_type.replace(/_/g, ' ')} · {n.observation_count}x obs ({Math.round(n.confidence * 100)}% conf)
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
        <Text style={styles.privacyText}>
          Privacy Shield: k ≥ {privacy?.k_threshold ?? 3} anonymity · Laplace ε={privacy?.epsilon_budget ?? 1.0} DP
        </Text>
        <Text style={styles.privacyMeta}>
          {privacy ? `${privacy.total_cells_published} pub / ${privacy.total_cells_suppressed} suppressed` : 'No PII stored'}
        </Text>
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
  kicker: { ...typography.label, color: colors.routeCyan, fontSize: 10 },
  title: { ...typography.sectionHeading, color: colors.textPrimary },
  subText: { ...typography.label, color: colors.textSecondary },
  highlight: { color: colors.textPrimary, fontWeight: '700' },
  muted: { ...typography.label, color: colors.textMuted },
  meterBlock: { gap: spacing.xs, marginTop: spacing.xs },
  meterRow: { gap: 3 },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  meterName: { ...typography.label, color: colors.textSecondary, fontSize: 11.5 },
  meterPct: { ...typography.label, color: colors.textPrimary, fontSize: 11.5 },
  meterTrack: { height: 7, borderRadius: 4, backgroundColor: colors.bgPrimary, overflow: 'hidden' },
  meterFill: { height: 7, borderRadius: 4 },
  section: { gap: spacing.xs, marginTop: spacing.xs },
  sectionTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  horizonRow: { flexDirection: 'row', gap: spacing.xs },
  horizonPill: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xs,
    alignItems: 'center',
  },
  horizonLabel: { ...typography.label, color: colors.textMuted, fontSize: 10 },
  horizonVal: { ...typography.sectionHeading, color: colors.textPrimary, fontSize: 16 },
  horizonRisk: { ...typography.label, color: colors.routeCyan, fontSize: 10, textTransform: 'capitalize' },
  safetyGrid: { gap: spacing.xs, marginTop: spacing.xs },
  safetyBox: {
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.s,
    gap: 4,
  },
  safetyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  safetyLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  safetyHint: { ...typography.label, color: colors.textSecondary, fontSize: 11.5 },
  memoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgPrimary,
    padding: spacing.xs,
    borderRadius: radii.button,
  },
  memoryText: { ...typography.label, color: colors.textPrimary, textTransform: 'capitalize', flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  privacyBar: {
    marginTop: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  privacyText: { ...typography.label, color: colors.accentBright, fontSize: 11 },
  privacyMeta: { ...typography.label, color: colors.textSecondary, fontSize: 10.5 },
});
