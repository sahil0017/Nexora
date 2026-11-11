import React from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../../../shared/components/Screen';
import { Card, EmptyState } from '../../../core/design-system/components';
import { colors } from '../../../app/theme/tokens';

// AC-01 Activity — unified event timeline across modules.
export default function ActivityScreen() {
  return (
    <Screen title="Activity" subtitle="Your recent updates and actions">
      <Card>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>Filters</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
            Filter by module and event type — wiring lands with M1 activity API.
          </Text>
        </View>
      </Card>
      <EmptyState
        title="No activity yet"
        hint="Commute suggestions, insights and completed actions will appear here."
      />
    </Screen>
  );
}
