import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../../app/theme/tokens';
import { Card, PrimaryButton } from '../../../core/design-system/components';
import { Chip, StatusPill } from '../../../core/design-system/motion';
import { UrbanSimulationResult } from '../../../core/api/move';

type InterventionType = 'signal_retime' | 'car_free_zone' | 'transit_boost' | 'speed_calming' | 'bus_lane';

const INTERVENTIONS: Array<{ key: InterventionType; label: string }> = [
  { key: 'signal_retime', label: 'Signal Retime' },
  { key: 'car_free_zone', label: 'Car-Free Zone' },
  { key: 'transit_boost', label: 'Transit Boost' },
  { key: 'speed_calming', label: 'Speed Calming' },
  { key: 'bus_lane', label: 'Bus Lane' },
];

const INTENSITIES = [20, 35, 50, 75] as const;

type Props = {
  result?: UrbanSimulationResult;
  running?: boolean;
  onSimulate: (intervention: InterventionType, intensityPct: number) => void;
};

export function UrbanSimulatorCard({ result, running, onSimulate }: Props) {
  const [intervention, setIntervention] = useState<InterventionType>('signal_retime');
  const [intensity, setIntensity] = useState<number>(35);

  const fmtDelta = (val: number, unit: string) => `${val > 0 ? '+' : ''}${val}${unit}`;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>PILLAR 10 · URBAN WHAT-IF SANDBOX</Text>
          <Text style={styles.title}>Simulate City Intervention</Text>
        </View>
        <StatusPill tone="info" label={`${intensity}% intensity`} />
      </View>

      <View style={styles.chipRow}>
        {INTERVENTIONS.map(opt => (
          <Chip
            key={opt.key}
            label={opt.label}
            active={intervention === opt.key}
            onPress={() => setIntervention(opt.key)}
          />
        ))}
      </View>

      <View style={styles.chipRow}>
        <Text style={styles.label}>Intervention Strength:</Text>
        {INTENSITIES.map(val => (
          <Chip
            key={val}
            label={`${val}%`}
            active={intensity === val}
            onPress={() => setIntensity(val)}
          />
        ))}
      </View>

      <PrimaryButton
        title={running ? 'Running Counterfactual Twin…' : 'Run Urban Simulation'}
        onPress={() => onSimulate(intervention, intensity)}
        disabled={running}
        loading={running}
      />

      {result ? (
        <View style={styles.resultBox}>
          <Text style={styles.summary}>{result.net_impact_summary}</Text>
          <View style={styles.deltaGrid}>
            <DeltaTile
              label="Corridor Speed"
              value={fmtDelta(result.deltas.speed_delta_kph, ' km/h')}
              positive={result.deltas.speed_delta_kph >= 0}
            />
            <DeltaTile
              label="Walk Safety"
              value={fmtDelta(result.deltas.pedestrian_safety_delta, ' pts')}
              positive={result.deltas.pedestrian_safety_delta >= 0}
            />
            <DeltaTile
              label="Crowd Load"
              value={fmtDelta(result.deltas.crowd_delta_pct, '%')}
              positive={result.deltas.crowd_delta_pct <= 0}
            />
            <DeltaTile
              label="CO₂ Cut"
              value={`-${result.deltas.co2_reduction_pct}%`}
              positive={result.deltas.co2_reduction_pct > 0}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function DeltaTile({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileVal, { color: positive ? colors.statusSuccess : colors.statusWarning }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.m, gap: spacing.s },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { ...typography.label, color: colors.accentBright, fontSize: 10 },
  title: { ...typography.sectionHeading, color: colors.textPrimary },
  label: { ...typography.label, color: colors.textSecondary, alignSelf: 'center', marginRight: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  resultBox: {
    marginTop: spacing.xs,
    backgroundColor: colors.bgPrimary,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.s,
    gap: spacing.s,
  },
  summary: { ...typography.label, color: colors.textPrimary, lineHeight: 17 },
  deltaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: {
    width: '48%',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.button,
    padding: spacing.xs,
  },
  tileLabel: { ...typography.label, color: colors.textMuted, fontSize: 10.5 },
  tileVal: { ...typography.sectionHeading, fontSize: 15, marginTop: 2 },
});
