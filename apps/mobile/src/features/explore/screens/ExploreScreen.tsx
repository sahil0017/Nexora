import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../shared/components/Screen';
import { Card, EmptyState, SectionHeading } from '../../../core/design-system/components';
import { colors, moduleColors, spacing } from '../../../app/theme/tokens';

const CATALOG = [
  { key: 'move', title: 'Move', desc: 'Routes, traffic, transit' },
  { key: 'health', title: 'Health', desc: 'Reports and health insights' },
  { key: 'finance', title: 'Finance', desc: 'Budgets and spending' },
  { key: 'work', title: 'Work', desc: 'Tasks and automation' },
];

// EX-01 Explore — module discovery. Enable/Open actions ship in M1.
export default function ExploreScreen() {
  return (
    <Screen title="Explore" subtitle="Your connected capabilities">
      <View style={styles.list}>
        {CATALOG.map(m => (
          <Card key={m.key} style={styles.row}>
            <View style={[styles.badge, { backgroundColor: moduleColors[m.key as keyof typeof moduleColors] }]} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{m.title}</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{m.desc}</Text>
            </View>
            <Text style={{ color: colors.accentPrimary, fontSize: 13 }}>Enable</Text>
          </Card>
        ))}
      </View>
      <SectionHeading title="Integrations" />
      <EmptyState title="No integrations yet" hint="Connect calendar, health and banking providers from module detail." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.s, marginBottom: spacing.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  badge: { width: 10, height: 10, borderRadius: 5 },
});
