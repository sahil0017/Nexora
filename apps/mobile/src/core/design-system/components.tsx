import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, fontFamily, radii, spacing, typography } from '../../app/theme/tokens';

/** Surface card used across all modules. Supports 'featured', 'subtle', and 'nav' (glass HUD) styles. */
export function Card({
  children,
  style,
  variant = 'default',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'default' | 'featured' | 'subtle' | 'nav';
}) {
  return (
    <View
      style={[
        styles.card,
        variant === 'featured' && styles.cardFeatured,
        variant === 'subtle' && styles.cardSubtle,
        variant === 'nav' && styles.cardNav,
        style,
      ]}>
      {children}
    </View>
  );
}

/** Call-to-action button (48pt height) with primary emerald, electric nav blue, and secondary variants. */
export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'nav';
}) {
  const isSecondary = variant === 'secondary';
  const isNav = variant === 'nav';
  return (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary && styles.buttonSecondary,
        isNav && styles.buttonNav,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {loading ? (
        <ActivityIndicator
          color={isSecondary ? colors.accentBright : isNav ? '#FFFFFF' : colors.bgPrimary}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            isSecondary && styles.buttonTextSecondary,
            isNav && styles.buttonTextNav,
          ]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

/** Segmented pill bar for switching interactive lenses, driving modes, or filter tabs. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  compact = false,
}: {
  options: ReadonlyArray<{ key: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.segmentWrap, compact && { padding: 3 }]}>
      {options.map(opt => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.85}
            style={[
              styles.segmentItem,
              compact && { paddingVertical: 6 },
              active && styles.segmentItemActive,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}>
            <Text
              numberOfLines={1}
              style={[
                styles.segmentText,
                compact && { fontSize: 11.5 },
                active && styles.segmentTextActive,
              ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Section heading with consistent type scale and nav-blue/emerald accent bar. */
export function SectionHeading({
  title,
  action,
  onActionPress,
}: {
  title: string;
  action?: string;
  onActionPress?: () => void;
}) {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionTitleWrap}>
        <View style={styles.sectionAccent} />
        <Text style={[typography.sectionHeading, { color: colors.textPrimary }]}>
          {title}
        </Text>
      </View>
      {action ? (
        <TouchableOpacity onPress={onActionPress} disabled={!onActionPress}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      selectionColor={colors.navBlue}
      style={styles.input}
      {...props}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Text style={{ color: colors.navBlue, fontSize: 16 }}>✦</Text>
      </View>
      <Text style={{ color: colors.textPrimary, fontFamily: fontFamily.medium, fontWeight: '600', fontSize: 13.5 }}>
        {title}
      </Text>
      {hint ? (
        <Text
          style={{
            color: colors.textSecondary,
            fontFamily: fontFamily.sans,
            marginTop: spacing.xs,
            fontSize: 12,
            lineHeight: 17,
            textAlign: 'center',
          }}>
          {hint}
        </Text>
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
  cardFeatured: {
    backgroundColor: '#0E1C28',
    borderColor: colors.borderStrong,
  },
  cardSubtle: {
    backgroundColor: colors.bgElevated,
    borderColor: 'transparent',
  },
  cardNav: {
    backgroundColor: colors.glassSurface,
    borderColor: colors.glassBorder,
    borderRadius: radii.panel,
  },
  button: {
    backgroundColor: colors.accentPrimary,
    borderRadius: radii.button,
    height: 44,
    paddingHorizontal: spacing.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonNav: {
    backgroundColor: colors.navBlue,
    borderRadius: 999,
    height: 44,
    paddingHorizontal: spacing.l,
  },
  buttonSecondary: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: {
    color: '#031109',
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 13.5,
    letterSpacing: 0.1,
  },
  buttonTextNav: {
    color: '#FFFFFF',
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 13.5,
    letterSpacing: 0.15,
  },
  buttonTextSecondary: {
    color: colors.textPrimary,
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  segmentItemActive: {
    backgroundColor: colors.navBlue,
  },
  segmentText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.m,
    marginBottom: spacing.s,
  },
  sectionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionAccent: {
    width: 3,
    height: 13,
    borderRadius: 2,
    backgroundColor: colors.navBlue,
  },
  sectionAction: {
    color: colors.navBlue,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.button,
    paddingHorizontal: spacing.m,
    height: 44,
    color: colors.textPrimary,
    fontFamily: fontFamily.sans,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  empty: {
    padding: spacing.m,
    alignItems: 'center',
  },
  emptyBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(29, 143, 225, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
  },
});
