import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../shared/components/Screen';
import { Card, SectionHeading } from '../../../core/design-system/components';
import { colors, moduleColors, spacing, typography } from '../../../app/theme/tokens';

const MODULES = [
  { key: 'move', title: 'Move', desc: 'Plan your journey' },
  { key: 'health', title: 'Health', desc: 'Your health timeline' },
  { key: 'finance', title: 'Finance', desc: 'Spending overview' },
  { key: 'work', title: 'Work', desc: 'Tasks and projects' },
];

const QUICK_ACTIONS = ['Plan my day', 'Best commute', 'Review spending'];

// HM-01 Home dashboard — daily intelligence overview.
// Insight cards appear only when real authorized data exists.
export default function HomeScreen() {
  return (
    <Screen title="Good morning" subtitle="Your day, intelligently connected.">
      {/* Persistent assistant entry point */}
      <Card style={styles.aiCard}>
        <Text style={styles.aiLabel}>NEXORA AI · READY</Text>
        <Text style={[typography.body, { color: colors.textSecondary, marginTop: 6 }]}>
          What would you like to get done?
        </Text>
        <View style={styles.chipRow}>
          {QUICK_ACTIONS.map(a => (
            <View key={a} style={styles.chip}>
              <Text style={{ color: colors.accentPrimary, fontSize: 13 }}>{a}</Text>
            </View>
          ))}
        </View>
      </Card>

      <SectionHeading title="Your modules" action="See all" />
      <View style={styles.grid}>
        {MODULES.map(m => (
          <Card key={m.key} style={styles.moduleCard}>
            <View
              style={[styles.dot, { backgroundColor: moduleColors[m.key as keyof typeof moduleColors] }]}
            />
            <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{m.title}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
              {m.desc}
            </Text>
          </Card>
        ))}
      </View>

      <SectionHeading title="For you today" />
      <Card>
        <Text style={{ color: colors.textSecondary }}>
          Your personalized insights appear here when useful data is available.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  aiCard: { marginBottom: spacing.l },
  aiLabel: { color: colors.accentPrimary, fontSize: 11, letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginTop: spacing.m },
  chip: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginBottom: spacing.l },
  moduleCard: { flexGrow: 1, flexBasis: '47%' },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: spacing.s },
});
