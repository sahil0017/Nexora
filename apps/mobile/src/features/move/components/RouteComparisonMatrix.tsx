import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { colors, spacing } from '../../../app/theme/tokens';
import { formatDuration, modeLabel, type RouteAlternative } from '../../../core/api/move';

export function RouteComparisonMatrix({
  alternatives,
  selectedId,
  onSelect,
  onAskExplain,
}: {
  alternatives: RouteAlternative[];
  selectedId?: string | null;
  onSelect: (routeId: string) => void;
  onAskExplain: (alt: RouteAlternative) => void;
}) {
  if (alternatives.length === 0) return null;
  const shown = alternatives.slice(0, 3);

  const bestTimeId = [...shown].sort((a, b) => a.duration_seconds - b.duration_seconds)[0]?.route_id;
  const bestRelId = [...shown].sort((a, b) => b.reliability_score - a.reliability_score)[0]?.route_id;
  const bestCostId = [...shown].sort((a, b) => a.estimated_cost.amount - b.estimated_cost.amount)[0]?.route_id;

  const ScoreBar = ({ label, val, color }: { label: string; val: number; color: string }) => (
    <View style={{ gap: 2 }}>
      <View style={styles.between}>
        <Text style={styles.barLbl}>{label}</Text>
        <Text style={styles.barVal}>{val}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(8, Math.min(100, val))}%` as any, backgroundColor: color }]} />
      </View>
    </View>
  );

  return (
    <Card style={{ gap: spacing.s }}>
      <View style={styles.between}>
        <View>
          <Text style={styles.eyebrow}>SIDE-BY-SIDE ROUTE COMPARISON</Text>
          <Text style={styles.title}>Multi-objective trade-offs</Text>
        </View>
        <StatusPill label={`${shown.length} OPTIONS`} tone="info" />
      </View>

      <View style={styles.colsRow}>
        {shown.map((alt, idx) => {
          const isSel = alt.route_id === selectedId;
          const p50 = alt.eta_range_seconds?.p50 ?? alt.duration_seconds;
          const p90 = alt.eta_range_seconds?.p90 ?? Math.round(p50 * 1.2);
          const ci = alt.confidence_interval;
          const obj = alt.objective_scores;
          const badges: string[] = [];
          if (idx === 0) badges.push('★ Top');
          if (alt.route_id === bestTimeId) badges.push('Fastest');
          if (alt.route_id === bestRelId) badges.push('Reliable');
          if (alt.route_id === bestCostId) badges.push('Lowest ₹');

          return (
            <TouchableOpacity
              key={alt.route_id}
              onPress={() => onSelect(alt.route_id)}
              activeOpacity={0.85}
              style={[styles.colCard, isSel && styles.colCardActive]}>
              <Text style={styles.modeTitle} numberOfLines={1}>
                {alt.mode_sequence && alt.mode_sequence.length > 1
                  ? alt.mode_sequence.map(modeLabel).join('→')
                  : modeLabel(alt.mode)}
              </Text>
              <Text style={styles.badgeText} numberOfLines={1}>
                {badges.slice(0, 2).join(' · ') || 'Alternative'}
              </Text>

              <Text style={styles.etaBig}>{formatDuration(p50)}</Text>
              <Text style={styles.ciText}>
                CI {Math.round((ci?.low_seconds ?? p50 * 0.9) / 60)}–{Math.round(p90 / 60)}m ({ci?.certainty_label ?? 'Calibrated'})
              </Text>

              <View style={styles.kvBlock}>
                <Text style={styles.kvLine}>
                  Reliability: <Text style={styles.kvBold}>{Math.round(alt.reliability_score * 100)}%</Text>
                </Text>
                <Text style={styles.kvLine}>
                  Cost: <Text style={styles.kvBold}>₹{Math.round(alt.estimated_cost.amount)}</Text>
                </Text>
                <Text style={styles.kvLine}>
                  Walk: <Text style={styles.kvBold}>{Math.round(alt.walking_minutes)}m</Text> · {alt.transfers} xfer
                </Text>
                {alt.co2_grams !== undefined && (
                  <Text style={styles.kvLine}>
                    CO₂: <Text style={styles.kvBold}>{(alt.co2_grams / 1000).toFixed(1)} kg</Text>
                  </Text>
                )}
              </View>

              {obj && (
                <View style={{ gap: 4, marginTop: 4 }}>
                  <ScoreBar label="Time" val={obj.time_score} color={colors.routeCyan} />
                  <ScoreBar label="Rel." val={obj.reliability_score} color={colors.accentBright} />
                  <ScoreBar label="Cost" val={obj.cost_score} color={colors.navBlue} />
                </View>
              )}

              <TouchableOpacity onPress={() => onAskExplain(alt)} style={styles.whyBtn}>
                <Text style={styles.whyText}>✨ Why?</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: colors.routeCyan, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, marginTop: 2 },
  colsRow: { flexDirection: 'row', gap: 8 },
  colCard: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  colCardActive: {
    borderColor: colors.navBlue,
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
  },
  modeTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '800' },
  badgeText: { color: colors.accentBright, fontSize: 10, fontWeight: '800' },
  etaBig: { color: colors.routeCyan, fontSize: 18, fontWeight: '900', marginTop: 2 },
  ciText: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  kvBlock: { gap: 2, marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  kvLine: { color: colors.textSecondary, fontSize: 11 },
  kvBold: { color: colors.textPrimary, fontWeight: '700' },
  barLbl: { color: colors.textMuted, fontSize: 9.5, fontWeight: '700' },
  barVal: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '800' },
  track: { height: 4, borderRadius: 4, backgroundColor: colors.bgPrimary, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  whyBtn: {
    marginTop: 6,
    backgroundColor: colors.bgPrimary,
    borderRadius: 999,
    paddingVertical: 5,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  whyText: { color: colors.navBlue, fontSize: 11, fontWeight: '800' },
});
