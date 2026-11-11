import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../shared/components/Screen';
import { Card, SectionHeading } from '../../../core/design-system/components';
import { colors, spacing } from '../../../app/theme/tokens';

const SETTINGS = [
  'Personal details',
  'Security and sessions',
  'Connected apps',
  'Module permissions',
  'Consent history',
  'AI memory controls',
  'Data export and deletion',
];

// PR-01 Profile — settings, privacy and consent management entry points.
export default function ProfileScreen() {
  return (
    <Screen title="Profile">
      <Card>
        <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 17 }}>User</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>user@example.com</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
          Hyderabad · Asia/Kolkata · en-IN
        </Text>
      </Card>
      <SectionHeading title="Settings" />
      <View style={styles.list}>
        {SETTINGS.map(s => (
          <Card key={s} style={styles.item}>
            <Text style={{ color: colors.textPrimary }}>{s}</Text>
            <Text style={{ color: colors.textSecondary }}>›</Text>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
});
