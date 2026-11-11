import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, PrimaryButton } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { colors, spacing } from '../../../app/theme/tokens';
import { formatDuration, modeLabel, type TripSummary } from '../../../core/api/move';

export function PostTripSummaryCard({
  destinationName,
  mode,
  summary,
  rated,
  onRate,
  onFinish,
  onDismiss,
}: {
  destinationName: string;
  mode: string;
  summary: TripSummary;
  rated: number | null;
  onRate: (stars: number) => void;
  onFinish: () => void;
  onDismiss: () => void;
}) {
  const savedMin = Math.max(0, Math.round(summary.time_saved_seconds / 60));
  const actualMin = Math.max(1, Math.round(summary.actual_duration_seconds / 60));
  const baseMin = Math.max(actualMin, Math.round(summary.baseline_duration_seconds / 60));

  return (
    <Card variant="featured" style={{ gap: spacing.s }}>
      <View style={styles.between}>
        <StatusPill
          label={savedMin > 0 ? `SAVED ${savedMin} MIN` : 'JOURNEY COMPLETE'}
          tone={savedMin > 0 ? 'success' : 'info'}
        />
        <TouchableOpacity onPress={onDismiss}>
          <Text style={{ color: colors.textMuted, fontWeight: '800' }}>✕</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.title}>{destinationName}</Text>
      <Text style={styles.sub}>
        Completed via {modeLabel(mode)} · {(summary.distance_meters / 1000).toFixed(1)} km
      </Text>

      <View style={styles.metricsGrid}>
        <View style={styles.metricCell}>
          <Text style={styles.metricVal}>{formatDuration(summary.actual_duration_seconds)}</Text>
          <Text style={styles.metricLbl}>Actual</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCell}>
          <Text style={[styles.metricVal, { color: colors.accentBright }]}>
            {savedMin > 0 ? `-${savedMin}m` : 'On time'}
          </Text>
          <Text style={styles.metricLbl}>vs Peak Car ({baseMin}m)</Text>
        </View>
        <View style={styles.metricDivider} />
        <View style={styles.metricCell}>
          <Text style={styles.metricVal}>
            {summary.co2_saved_grams >= 100
              ? `${(summary.co2_saved_grams / 1000).toFixed(1)} kg`
              : `₹${Math.round(summary.estimated_cost_inr)}`}
          </Text>
          <Text style={styles.metricLbl}>
            {summary.co2_saved_grams >= 100 ? 'CO₂ saved' : 'Est. cost'}
          </Text>
        </View>
      </View>

      {summary.insights.length > 0 && (
        <View style={styles.insightsBox}>
          <Text style={styles.insightsHeader}>AFTER TRAVEL · JOURNEY INSIGHTS</Text>
          {summary.insights.map((ins, i) => (
            <Text key={i} style={styles.insightLine}>
              • {ins}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.sub}>Rate ETA accuracy to train NEXORA's online learner:</Text>
      {rated ? (
        <Text style={{ color: colors.statusSuccess, fontWeight: '700', fontSize: 13 }}>
          ✓ Rated {rated}/5 ★ — personal mobility profile updated!
        </Text>
      ) : (
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map(star => (
            <Chip key={star} label={`${star} ★`} onPress={() => onRate(star)} />
          ))}
        </View>
      )}

      <PrimaryButton title="🏁 Finish & Save Insights" variant="nav" onPress={onFinish} />
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  sub: { color: colors.textSecondary, fontSize: 12.5 },
  metricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  metricCell: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: 1, height: 30, backgroundColor: colors.borderSubtle },
  metricVal: { color: colors.routeCyan, fontSize: 17, fontWeight: '900' },
  metricLbl: { color: colors.textSecondary, fontSize: 10.5, fontWeight: '600', textAlign: 'center' },
  insightsBox: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  insightsHeader: { color: colors.routeCyan, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  insightLine: { color: colors.textPrimary, fontSize: 12.5, lineHeight: 18 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
});
