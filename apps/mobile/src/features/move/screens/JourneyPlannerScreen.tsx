import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../../../shared/components/Screen';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { colors, spacing } from '../../../app/theme/tokens';

const MODES = ['Walk', 'Cycle', '2W', 'Car', 'Bus', 'Metro'];

// MV-02 Journey planner — origin/destination + mode selection.
// Calls POST /api/v1/move/journeys/plan (stubbed API layer in M1).
export default function JourneyPlannerScreen() {
  const [destination, setDestination] = React.useState('');

  return (
    <Screen title="Plan journey" subtitle="Compare routes across modes">
      <Card style={{ gap: spacing.s }}>
        <Text style={{ color: colors.textSecondary, fontSize: 13 }}>Origin</Text>
        <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>Current location</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 8 }}>Destination</Text>
        <TextInput
          value={destination}
          onChangeText={setDestination}
          placeholder="Where to?"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </Card>

      <SectionHeading title="Modes" />
      <View style={styles.modeRow}>
        {MODES.map(m => (
          <View key={m} style={styles.modeChip}>
            <Text style={{ color: colors.accentPrimary, fontSize: 13 }}>{m}</Text>
          </View>
        ))}
      </View>

      <PrimaryButton title="Find routes" onPress={() => { /* wire to API in M3 */ }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: spacing.m,
    height: 46,
    color: colors.textPrimary,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s, marginBottom: spacing.l },
  modeChip: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
