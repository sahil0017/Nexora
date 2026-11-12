import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamily, spacing, typography } from '../../app/theme/tokens';

/** Standard screen scaffold: obsidian navigation canvas, back navigation (supports nested module tabs), top-right action, and brand pill. */
export function Screen({
  title,
  subtitle,
  badge,
  backLabel = '← Back',
  showBack,
  rightAction,
  children,
  scroll = true,
  scrollRef,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  backLabel?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  scrollRef?: React.RefObject<React.ComponentRef<typeof ScrollView> | null>;
}) {
  const nav = useNavigation<any>();
  const parentNav = nav?.getParent?.();
  const navStateType = nav?.getState?.()?.type;
  const isRootTab = navStateType === 'tab' && !parentNav;
  const canGoBackSelf = !isRootTab && (nav?.canGoBack?.() ?? false);
  const canGoBackParent = !isRootTab && (parentNav?.canGoBack?.() ?? Boolean(parentNav));
  const canGoBack = showBack !== undefined ? showBack : canGoBackSelf || canGoBackParent;

  const handleBack = () => {
    if (canGoBackSelf) {
      nav.goBack();
    } else if (parentNav) {
      if (parentNav.canGoBack?.()) {
        parentNav.goBack();
      } else {
        parentNav.navigate?.('Home');
      }
    }
  };

  const content = (
    <>
      <View style={styles.header}>
        <View style={styles.topRow}>
          {canGoBack ? (
            <TouchableOpacity
              onPress={handleBack}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back">
              <Text style={styles.backText}>{backLabel}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandLabel}>{badge ?? 'NEXORA · SUPER APP'}</Text>
            </View>
          )}
          {rightAction}
        </View>
        <Text style={[typography.screenTitle, { color: colors.textPrimary, marginTop: 8 }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 3 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {scroll ? (
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      ) : (
        <View style={styles.bodyFlex}>{content}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  body: { padding: spacing.m, paddingBottom: spacing.xl + 16 },
  bodyFlex: { flex: 1, padding: spacing.m },
  header: { marginBottom: spacing.m },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.navBlue },
  brandLabel: {
    color: colors.statusInfo,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  backBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  backText: {
    color: colors.statusInfo,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    fontWeight: '600',
  },
});
