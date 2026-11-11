import React from 'react';
import { ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../../app/theme/tokens';

/** Standard screen scaffold: safe area + dark background + header. */
export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const content = (
    <>
      <View style={styles.header}>
        <Text style={[typography.screenTitle, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.body, { color: colors.textSecondary, marginTop: 4 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      {scroll ? (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
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
  body: { padding: spacing.m, paddingBottom: spacing.xl },
  bodyFlex: { flex: 1, padding: spacing.m },
  header: { marginBottom: spacing.m },
});
