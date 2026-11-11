import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { colors, spacing } from '../../app/theme/tokens';

/** Fades and lifts children in; `index` staggers siblings. */
export function FadeIn({
  children,
  index = 0,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 320,
      delay: index * 55,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [v, index]);
  return (
    <Animated.View
      style={[
        style,
        { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}>
      {children}
    </Animated.View>
  );
}

/** Pressable with a springy scale-down feedback. */
export function Tappable({
  children,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (n: number) =>
    Animated.spring(s, { toValue: n, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/** Pulsing placeholder block for loading states. */
export function Skeleton({ height = 16, width = '100%' as number | string }) {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.75, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      style={{ height, width: width as any, borderRadius: 8, backgroundColor: colors.bgElevated, opacity: v }}
    />
  );
}

/** Three bouncing dots shown while the assistant is thinking. */
export function TypingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(280 - i * 140),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [dots]);
  return (
    <View style={{ flexDirection: 'row', gap: 5, paddingVertical: 6 }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: colors.accentBright,
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
            transform: [{ translateY: d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
          }}
        />
      ))}
    </View>
  );
}

/** Selectable pill; highlights with electric nav-blue (or custom color) fill when active. */
export function Chip({
  label,
  active,
  onPress,
  color = colors.navBlue,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const activeText = color === colors.accentPrimary || color === colors.accentBright ? '#031109' : '#FFFFFF';
  return (
    <Tappable
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        backgroundColor: active ? color : colors.bgElevated,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        minHeight: 36,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: active ? color : colors.borderSubtle,
      }}>
      <Text
        style={{
          color: active ? activeText : colors.textPrimary,
          fontSize: 12.5,
          fontWeight: active ? '800' : '600',
        }}>
        {label}
      </Text>
    </Tappable>
  );
}

/** Telemetry status pill (e.g. AI online / offline) with glowing dot & bordered capsule. */
export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info';
}) {
  const c =
    tone === 'success'
      ? colors.accentBright
      : tone === 'warning'
      ? colors.statusWarning
      : tone === 'info'
      ? colors.navBlue
      : colors.statusDanger;
  const bg =
    tone === 'success'
      ? 'rgba(16, 185, 129, 0.14)'
      : tone === 'warning'
      ? 'rgba(245, 158, 11, 0.14)'
      : tone === 'info'
      ? 'rgba(29, 143, 225, 0.14)'
      : 'rgba(239, 68, 68, 0.14)';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs + 2,
        alignSelf: 'flex-start',
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: c + '44',
      }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c }} />
      <Text style={{ color: c, fontSize: 10.5, letterSpacing: 0.8, fontWeight: '800' }}>
        {label}
      </Text>
    </View>
  );
}
