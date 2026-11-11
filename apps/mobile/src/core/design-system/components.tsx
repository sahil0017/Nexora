import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../app/theme/tokens';

/** Surface card used across all modules. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Primary call-to-action button (48-52pt height). */
export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {loading ? (
        <ActivityIndicator color={colors.bgPrimary} />
      ) : (
        <Text style={styles.buttonText}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

/** Section heading with consistent type scale. */
export function SectionHeading({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={[typography.sectionHeading, { color: colors.textPrimary }]}>
        {title}
      </Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.textSecondary}
      style={styles.input}
      {...props}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{title}</Text>
      {hint ? (
        <Text style={{ color: colors.textSecondary, marginTop: spacing.s }}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    padding: spacing.m,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: radii.button,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.bgPrimary, fontWeight: '700', fontSize: 16 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.s,
  },
  sectionAction: { color: colors.accentPrimary, fontSize: 13 },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    paddingHorizontal: spacing.m,
    height: 48,
    color: colors.textPrimary,
    fontSize: 15,
  },
  empty: {
    padding: spacing.l,
    alignItems: 'center',
  },
});
