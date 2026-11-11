import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card, PrimaryButton, SegmentedControl } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { colors, spacing } from '../../../app/theme/tokens';
import type { DepartureAdvice, DepartureSlotPoint } from '../../../core/api/move';

const WINDOWS = [
  { key: '1', label: '1 hr' },
  { key: '3', label: '3 hr' },
  { key: '6', label: '6 hr' },
] as const;

type WindowKey = (typeof WINDOWS)[number]['key'];

export function DepartureOptimizerCard({
  advice,
  windowHrs,
  onChangeWindow,
  onRefresh,
  loading,
  error,
}: {
  advice?: DepartureAdvice;
  windowHrs: WindowKey;
  onChangeWindow: (next: WindowKey) => void;
  onRefresh: () => void;
  loading: boolean;
  error: boolean;
}) {
  const [inspectedIdx, setInspectedIdx] = useState<number | null>(null);
  const series = advice?.slot_series ?? [];
  const maxDur = Math.max(1, ...series.map(s => s.duration_minutes));
  const inspectedSlot: DepartureSlotPoint | undefined =
    inspectedIdx !== null ? series[inspectedIdx] : undefined;

  const fmtClock = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const congestionColor = (level: string, isOptimal?: boolean) => {
    if (isOptimal) return colors.accentBright;
    if (level === 'heavy') return colors.statusDanger;
    if (level === 'moderate') return colors.statusWarning;
    return colors.routeCyan;
  };

  return (
    <Card variant="featured" style={{ gap: spacing.s }}>
      <View style={styles.between}>
        <View>
          <Text style={styles.eyebrow}>BEFORE TRAVEL · DYNAMIC DEPARTURE OPTIMIZER</Text>
          <Text style={styles.title}>Best time to leave</Text>
        </View>
        {(advice?.time_saved_vs_now_minutes ?? 0) > 0 ? (
          <StatusPill label={`SAVE ${advice!.time_saved_vs_now_minutes} MIN`} tone="success" />
        ) : advice ? (
          <StatusPill label="LEAVE NOW" tone="info" />
        ) : null}
      </View>

      <SegmentedControl
        compact
        options={[...WINDOWS]}
        value={windowHrs}
        onChange={next => {
          setInspectedIdx(null);
          onChangeWindow(next);
        }}
      />

      {advice ? (
        <>
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.heroClock}>{fmtClock(advice.recommended_departure)}</Text>
              <Text style={styles.sub}>
                Arrive ~{fmtClock(advice.predicted_arrival)} · {advice.predicted_duration_minutes} min
              </Text>
            </View>
            <View style={styles.confBox}>
              <Text style={styles.confVal}>{Math.round(advice.arrival_confidence * 100)}%</Text>
              <Text style={styles.confLbl}>ON-TIME</Text>
            </View>
          </View>

          {series.length > 0 && (
            <View style={styles.chartBox}>
              <View style={styles.between}>
                <Text style={styles.chartHint}>Congestion & ETA across departure window</Text>
                <Text style={styles.chartHint}>Tap bar</Text>
              </View>
              <View style={styles.barsRow}>
                {series.map((slot, idx) => {
                  const hPct = Math.max(26, Math.round((slot.duration_minutes / maxDur) * 100));
                  const active = inspectedIdx === idx;
                  const barColor = congestionColor(slot.congestion_level, slot.is_optimal);
                  return (
                    <TouchableOpacity
                      key={slot.departure}
                      onPress={() => setInspectedIdx(active ? null : idx)}
                      style={styles.barCol}
                      activeOpacity={0.8}>
                      <Text style={styles.barDur}>{slot.duration_minutes}m</Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              height: `${hPct}%` as any,
                              backgroundColor: barColor,
                              borderWidth: slot.is_optimal || active ? 1.5 : 0,
                              borderColor: '#FFFFFF',
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.barTime,
                          slot.is_optimal && { color: colors.accentBright, fontWeight: '800' },
                        ]}>
                        {slot.is_optimal ? '★' : slot.is_now ? 'Now' : fmtClock(slot.departure)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {inspectedSlot && (
                <View style={styles.inspectPill}>
                  <Text style={styles.inspectText}>
                    Depart {fmtClock(inspectedSlot.departure)} → Arrive {fmtClock(inspectedSlot.arrival)} ·{' '}
                    {inspectedSlot.duration_minutes}m (p90 {inspectedSlot.p90_minutes}m) ·{' '}
                    {Math.round(inspectedSlot.arrival_confidence * 100)}% confident
                  </Text>
                </View>
              )}
            </View>
          )}

          {advice.reason ? <Text style={styles.reason}>{advice.reason}</Text> : null}

          {advice.active_events && advice.active_events.length > 0 && (
            <View style={styles.eventBanner}>
              <Text style={styles.eventText}>
                📅 Event-aware: {advice.active_events[0].title}
              </Text>
            </View>
          )}
        </>
      ) : error ? (
        <Text style={{ color: colors.statusDanger, fontSize: 13 }}>Couldn't get departure advice.</Text>
      ) : null}

      <PrimaryButton
        title={advice ? 'Recalculate departure curve' : 'Find best departure time'}
        variant="secondary"
        onPress={onRefresh}
        loading={loading}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  eyebrow: { color: colors.routeCyan, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: colors.textPrimary, fontWeight: '800', fontSize: 16, marginTop: 2 },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  heroClock: { color: colors.routeCyan, fontSize: 28, fontWeight: '900' },
  sub: { color: colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  confBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  confVal: { color: colors.accentBright, fontSize: 18, fontWeight: '900' },
  confLbl: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  chartBox: {
    backgroundColor: colors.bgPrimary,
    borderRadius: 14,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  chartHint: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, height: 96 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barDur: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  barTrack: {
    width: '100%',
    maxWidth: 26,
    height: 58,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: { width: '100%', borderRadius: 8 },
  barTime: { color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  inspectPill: {
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inspectText: { color: colors.textPrimary, fontSize: 11.5, fontWeight: '600' },
  reason: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 18 },
  eventBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.32)',
  },
  eventText: { color: colors.statusWarning, fontSize: 11.5, fontWeight: '700' },
});
