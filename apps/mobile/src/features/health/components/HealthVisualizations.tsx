import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, moduleColors, radii, spacing } from '../../../app/theme/tokens';

const HEALTH_TEAL = moduleColors.health;

/**
 * Compact column sparkline for sleep index trends, live motion waveforms, or sensor quality history.
 */
export function SparklineChart({
  values,
  height = 56,
  color = HEALTH_TEAL,
  unit = '',
  emptyLabel = 'No readings yet',
  labels,
}: {
  values: number[];
  height?: number;
  color?: string;
  unit?: string;
  emptyLabel?: string;
  labels?: string[];
}) {
  if (!values.length) {
    return (
      <View style={[styles.emptyChart, { height }]}>
        <Text style={styles.emptyChartText}>{emptyLabel}</Text>
      </View>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1e-4);

  return (
    <View style={styles.sparkWrap}>
      <View style={[styles.sparkBars, { height }]}>
        {values.map((v, idx) => {
          const norm = values.length === 1 ? 0.65 : 0.22 + ((v - min) / span) * 0.78;
          const isLatest = idx === values.length - 1;
          return (
            <View key={idx} style={styles.sparkCol}>
              <View
                style={[
                  styles.sparkBar,
                  {
                    height: Math.max(6, Math.round(norm * (height - 8))),
                    backgroundColor: isLatest ? color : `${color}66`,
                    borderColor: isLatest ? color : 'transparent',
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
      <View style={styles.sparkFooter}>
        <Text style={styles.sparkRange}>
          Min {min.toFixed(2)}
          {unit}
        </Text>
        {labels && labels.length > 0 ? (
          <Text style={styles.sparkRange}>{labels[labels.length - 1]}</Text>
        ) : null}
        <Text style={[styles.sparkRange, { color }]}>
          Latest {values[values.length - 1].toFixed(2)}
          {unit}
        </Text>
      </View>
    </View>
  );
}

/**
 * Horizontal progress/gauge bar with label, formatted value, and color-coded fill.
 */
export function HealthMetricBar({
  label,
  valueLabel,
  progress,
  color = HEALTH_TEAL,
  subtitle,
}: {
  label: string;
  valueLabel: string;
  progress: number; // 0..1
  color?: string;
  subtitle?: string;
}) {
  const clamped = Math.max(0.04, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <View style={styles.metricBarWrap}>
      <View style={styles.rowBetween}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={[styles.metricValue, { color }]}>{valueLabel}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(clamped * 100)}%`, backgroundColor: color }]} />
      </View>
      {subtitle ? <Text style={styles.metricSub}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * Visualizes a research estimate with its [ciLow, ciHigh] confidence band on a normalized scale.
 */
export function SleepConfidenceRangeBar({
  value,
  ciLow,
  ciHigh,
  minScale = 0.8,
  maxScale = 2.2,
  unit = '',
}: {
  value: number;
  ciLow: number;
  ciHigh: number;
  minScale?: number;
  maxScale?: number;
  unit?: string;
}) {
  const span = Math.max(0.1, maxScale - minScale);
  const toPct = (v: number) => Math.max(0, Math.min(100, ((v - minScale) / span) * 100));
  const lowPct = toPct(ciLow);
  const highPct = toPct(ciHigh);
  const valPct = toPct(value);
  const bandWidth = Math.max(4, highPct - lowPct);

  return (
    <View style={styles.ciWrap}>
      <View style={styles.ciTrack}>
        <View style={[styles.ciBand, { left: `${lowPct}%`, width: `${bandWidth}%` }]} />
        <View style={[styles.ciDot, { left: `${Math.max(2, Math.min(96, valPct))}%` }]} />
      </View>
      <View style={styles.sparkFooter}>
        <Text style={styles.sparkRange}>
          Low {ciLow.toFixed(2)}
          {unit}
        </Text>
        <Text style={[styles.sparkRange, { color: HEALTH_TEAL, fontWeight: '700' }]}>
          Estimate {value.toFixed(2)}
          {unit}
        </Text>
        <Text style={styles.sparkRange}>
          High {ciHigh.toFixed(2)}
          {unit}
        </Text>
      </View>
    </View>
  );
}

/**
 * Stacked horizontal bar illustrating Deep Sleep (N3), Light/REM, and Wake/Fragmentation share.
 */
export function SleepArchitectureBar({
  deepFraction,
  fragmentationIndex,
}: {
  deepFraction: number; // e.g. 0.24
  fragmentationIndex: number; // e.g. 0.11
}) {
  const deep = Math.max(0.05, Math.min(0.6, deepFraction));
  const wake = Math.max(0.03, Math.min(0.45, fragmentationIndex));
  const light = Math.max(0.1, 1 - deep - wake);

  return (
    <View style={styles.archWrap}>
      <View style={styles.archBar}>
        <View style={[styles.archSeg, { flex: deep, backgroundColor: HEALTH_TEAL }]} />
        <View style={[styles.archSeg, { flex: light, backgroundColor: colors.navBlue }]} />
        <View style={[styles.archSeg, { flex: wake, backgroundColor: colors.statusWarning }]} />
      </View>
      <View style={styles.legendRow}>
        <LegendDot color={HEALTH_TEAL} label={`Deep ${Math.round(deep * 100)}%`} />
        <LegendDot color={colors.navBlue} label={`Light/REM ${Math.round(light * 100)}%`} />
        <LegendDot color={colors.statusWarning} label={`Wake ${Math.round(wake * 100)}%`} />
      </View>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/**
 * Paired comparison bars for Predicted Sleep Estimate vs Clinical 3T MRI Reference.
 */
export function StudyAgreementBars({
  predicted,
  reference,
  maxItems = 6,
}: {
  predicted: number[];
  reference: number[];
  maxItems?: number;
}) {
  const count = Math.min(predicted.length, reference.length, maxItems);
  if (count === 0) return null;
  const all = [...predicted.slice(0, count), ...reference.slice(0, count)];
  const maxVal = Math.max(...all, 1.8);

  return (
    <View style={styles.studyWrap}>
      <View style={styles.legendRow}>
        <LegendDot color={HEALTH_TEAL} label="Sleep Estimate" />
        <LegendDot color={colors.accentBright} label="3T MRI Scan" />
      </View>
      <View style={{ gap: 8, marginTop: 6 }}>
        {Array.from({ length: count }).map((_, i) => {
          const p = predicted[i];
          const r = reference[i];
          return (
            <View key={i} style={styles.studyRow}>
              <Text style={styles.studyIdx}>#{i + 1}</Text>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.studyTrack}>
                  <View
                    style={[
                      styles.studyBar,
                      { width: `${Math.round((p / maxVal) * 100)}%`, backgroundColor: HEALTH_TEAL },
                    ]}
                  />
                </View>
                <View style={styles.studyTrack}>
                  <View
                    style={[
                      styles.studyBar,
                      { width: `${Math.round((r / maxVal) * 100)}%`, backgroundColor: colors.accentBright },
                    ]}
                  />
                </View>
              </View>
              <Text style={styles.studyVals}>
                {p.toFixed(2)} / {r.toFixed(2)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export type ModalityStatusItem = {
  key: string;
  label: string;
  status: 'live' | 'connected' | 'off';
  detail: string;
};

/**
 * 2x2 visual status grid for physical & wearable sensor channels.
 */
export function SensorModalityMatrix({ items }: { items: ModalityStatusItem[] }) {
  return (
    <View style={styles.matrixGrid}>
      {items.map(item => {
        const dotColor =
          item.status === 'live'
            ? colors.statusSuccess
            : item.status === 'connected'
              ? HEALTH_TEAL
              : colors.textMuted;
        return (
          <View key={item.key} style={styles.matrixCell}>
            <View style={styles.matrixTop}>
              <View style={[styles.dot, { backgroundColor: dotColor }]} />
              <Text style={styles.matrixLabel} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
            <Text style={styles.matrixDetail} numberOfLines={1}>
              {item.detail}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyChart: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChartText: { fontFamily: fontFamily.sans, fontSize: 12, color: colors.textMuted },
  sparkWrap: { gap: 6 },
  sparkBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 2,
    borderRadius: radii.card,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sparkCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  sparkBar: {
    width: '100%',
    maxWidth: 18,
    borderRadius: 4,
    borderWidth: 1,
  },
  sparkFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sparkRange: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.textMuted },
  metricBarWrap: { gap: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textSecondary },
  metricValue: { fontFamily: fontFamily.mono, fontSize: 12, fontWeight: '700' },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  fill: { height: '100%', borderRadius: 999 },
  metricSub: { fontFamily: fontFamily.sans, fontSize: 11, color: colors.textMuted },
  ciWrap: { gap: 6 },
  ciTrack: {
    height: 14,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    position: 'relative',
    justifyContent: 'center',
  },
  ciBand: {
    position: 'absolute',
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(45, 212, 191, 0.35)',
  },
  ciDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: HEALTH_TEAL,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginLeft: -6,
  },
  archWrap: { gap: 8 },
  archBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 999,
    overflow: 'hidden',
    gap: 2,
  },
  archSeg: { height: '100%' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontFamily: fontFamily.sans, fontSize: 11.5, color: colors.textSecondary },
  studyWrap: { gap: 4 },
  studyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  studyIdx: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.textMuted, width: 22 },
  studyTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  studyBar: { height: '100%', borderRadius: 999 },
  studyVals: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.textSecondary, width: 72, textAlign: 'right' },
  matrixGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  matrixCell: {
    width: '48%',
    padding: spacing.s,
    borderRadius: radii.card,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 3,
  },
  matrixTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  matrixLabel: { fontFamily: fontFamily.medium, fontSize: 12.5, fontWeight: '600', color: colors.textPrimary, flex: 1 },
  matrixDetail: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.textSecondary },
});
