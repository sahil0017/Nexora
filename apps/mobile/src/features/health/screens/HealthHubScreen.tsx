import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, spacing, typography } from '../../../app/theme/tokens';
import { healthApi } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';

const DEFAULT_SUBMODULES = [
  {
    key: 'sleep_clearance',
    title: 'Sleep & Brain-Fluid Insights',
    subtitle: 'See how deep sleep, breathing & heart rhythm relate to overnight brain-fluid dynamics',
    status: 'active' as const,
    sensor_ready: true,
    route: 'SleepClearance' as const,
  },
  {
    key: 'device_sensors',
    title: 'Body & Sleep Sensors',
    subtitle: 'Track sleep posture, gentle movement & connected watch health data privately on-device',
    status: 'active' as const,
    sensor_ready: true,
    route: 'SensorStream' as const,
  },
  {
    key: 'mri_validation',
    title: 'MRI Study & Accuracy',
    subtitle: 'Compare overnight sleep estimates against clinical MRI scans across nights & devices',
    status: 'active' as const,
    sensor_ready: false,
    route: 'MriValidation' as const,
  },
  {
    key: 'cardio_autonomic',
    title: 'Heart & Recovery',
    subtitle: 'Overnight heart-rate variability & recovery trends powered by your connected sensors',
    status: 'research_preview' as const,
    sensor_ready: true,
    route: 'SensorStream' as const,
  },
];

export default function HealthHubScreen() {
  const nav = useNavigation<any>();
  const { data } = useQuery({
    queryKey: ['health', 'submodules'],
    queryFn: () => healthApi.listSubmodules(),
  });

  const guardrail =
    data?.claim_guardrail ??
    'Research surrogate only. NEXORA never claims to measure or improve brain waste clearance from ordinary smartwatch sleep scores or standalone smartphone sensors.';

  return (
    <Screen
      title="NEXORA Health"
      subtitle="Sleep physiology, connected sensors & clinical research"
      badge="HEALTH"
      rightAction={
        <TouchableOpacity onPress={() => nav.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      }>
      <View style={styles.content}>
        <Card variant="featured" style={styles.guardrailCard}>
          <View style={styles.rowBetween}>
            <StatusPill label="RESEARCH ONLY" tone="warning" />
            <Text style={styles.monoTag}>NOT FOR DIAGNOSIS</Text>
          </View>
          <Text style={styles.guardrailText}>{guardrail}</Text>
        </Card>

        <SectionHeading title="Health Areas" />

        {DEFAULT_SUBMODULES.map(sub => {
          const serverMatch = data?.submodules?.find(s => s.key === sub.key);
          const status = serverMatch?.status ?? sub.status;
          return (
            <TouchableOpacity
              key={sub.key}
              activeOpacity={0.85}
              onPress={() => nav.navigate(sub.route)}>
              <Card style={styles.subCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.subTitle}>{sub.title}</Text>
                  <StatusPill
                    label={status === 'active' ? 'ACTIVE' : 'PREVIEW'}
                    tone={status === 'active' ? 'success' : 'info'}
                  />
                </View>
                <Text style={styles.subDesc}>{serverMatch?.subtitle ?? sub.subtitle}</Text>
                <View style={styles.subFooter}>
                  <Text style={styles.sensorTag}>
                    {sub.sensor_ready ? '● Live sensors ready' : '◎ Clinical study data'}
                  </Text>
                  <Text style={styles.openLink}>Open →</Text>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}

        <View style={styles.ctaWrap}>
          <PrimaryButton
            title="Explore Sleep & Brain-Fluid Insights"
            onPress={() => nav.navigate('SleepClearance')}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  guardrailCard: {
    borderColor: 'rgba(245, 158, 11, 0.45)',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
  },
  monoTag: { fontFamily: fontFamily.mono, fontSize: 10.5, color: colors.statusWarning },
  guardrailText: { ...typography.body, color: colors.textPrimary, marginTop: spacing.s },
  subCard: { borderColor: 'rgba(45, 212, 191, 0.28)' },
  subTitle: { fontFamily: fontFamily.medium, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  subDesc: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
  subFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.m },
  sensorTag: { fontFamily: fontFamily.mono, fontSize: 11, color: moduleColors.health },
  openLink: { fontFamily: fontFamily.medium, fontSize: 13, fontWeight: '600', color: moduleColors.health },
  ctaWrap: { marginTop: spacing.s },
});
