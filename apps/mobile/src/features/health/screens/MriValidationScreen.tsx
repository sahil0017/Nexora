import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { healthApi, type CohortValidationResult } from '../../../core/api/health';
import { Card, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { StatusPill } from '../../../core/design-system/motion';
import { Screen } from '../../../shared/components/Screen';
import { HealthMetricBar, StudyAgreementBars } from '../components/HealthVisualizations';

const SAMPLE_PRED = [1.22, 1.31, 1.45, 1.5, 1.28, 1.39, 1.61, 1.44, 1.35, 1.55, 1.48, 1.3];
const SAMPLE_MRI = [1.2, 1.33, 1.42, 1.52, 1.25, 1.4, 1.58, 1.46, 1.36, 1.53, 1.49, 1.31];

export default function MriValidationScreen() {
  const nav = useNavigation<any>();
  const [cohortId, setCohortId] = useState('nexora-pilot-01');
  const [siteId, setSiteId] = useState('neuro-mri-partner-01');
  const [dtiAlpsInput, setDtiAlpsInput] = useState('1.44');
  const [validationResult, setValidationResult] = useState<CohortValidationResult | null>(null);

  const refsQuery = useQuery({
    queryKey: ['health', 'mri-references', cohortId],
    queryFn: () => healthApi.listMriReferences(cohortId, 15),
  });

  const validationsQuery = useQuery({
    queryKey: ['health', 'validations'],
    queryFn: () => healthApi.listValidationRuns(5),
  });

  const registerMri = useMutation({
    mutationFn: () =>
      healthApi.createMriReference({
        cohort_id: cohortId,
        site_id: siteId,
        scanner_field_t: 3.0,
        surrogate_type: 'dti_alps_index',
        dti_alps_index: parseFloat(dtiAlpsInput) || 1.44,
        quality_score: 0.93,
      }),
    onSuccess: () => {
      void refsQuery.refetch();
    },
  });

  const runValidation = useMutation({
    mutationFn: () =>
      healthApi.validateCohort({
        surrogate_target: 'dti_alps_index',
        predicted: SAMPLE_PRED,
        mri_reference: SAMPLE_MRI,
        ci_low: SAMPLE_PRED.map(p => p - 0.06),
        ci_high: SAMPLE_PRED.map(p => p + 0.06),
        night_groups: [
          [1.21, 1.23, 1.22],
          [1.45, 1.47, 1.44],
          [1.55, 1.53, 1.56],
        ],
        subgroups: [
          { device_model: 'iphone_15' },
          { device_model: 'iphone_15' },
          { device_model: 'iphone_15' },
          { device_model: 'iphone_15' },
          { device_model: 'iphone_15' },
          { device_model: 'pixel_9' },
          { device_model: 'pixel_9' },
          { device_model: 'pixel_9' },
          { device_model: 'pixel_9' },
          { device_model: 'pixel_9' },
        ],
      }),
    onSuccess: res => {
      setValidationResult(res);
      void validationsQuery.refetch();
    },
  });

  const activeReport = validationResult ?? validationsQuery.data?.validations?.[0] ?? null;

  return (
    <Screen
      title="MRI Study & Accuracy"
      subtitle="Visual agreement between sleep estimates & 3T MRI scans"
      badge="HEALTH · STUDY">
      <View style={styles.content}>
        <SectionHeading title="Study Accuracy Overview" />
        <Card variant="featured" style={styles.resultCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Sleep vs. 3T MRI Comparison</Text>
            <StatusPill
              label={
                activeReport
                  ? activeReport.validation_passed
                    ? 'PASSING'
                    : 'NEEDS DATA'
                  : 'READY'
              }
              tone={
                activeReport
                  ? activeReport.validation_passed
                    ? 'success'
                    : 'warning'
                  : 'info'
              }
            />
          </View>

          <StudyAgreementBars predicted={SAMPLE_PRED} reference={SAMPLE_MRI} maxItems={6} />

          {activeReport ? (
            <View style={{ gap: spacing.s, marginTop: spacing.s }}>
              <HealthMetricBar
                label="Overall Match (Lin's CCC)"
                valueLabel={activeReport.lin_ccc.toFixed(3)}
                progress={activeReport.lin_ccc}
              />
              {'multi_night_icc' in activeReport && activeReport.multi_night_icc != null ? (
                <HealthMetricBar
                  label="Multi-Night Repeatability (ICC)"
                  valueLabel={activeReport.multi_night_icc.toFixed(3)}
                  progress={activeReport.multi_night_icc}
                  color={colors.navBlue}
                />
              ) : null}
              {'interval_coverage_95' in activeReport && activeReport.interval_coverage_95 != null ? (
                <HealthMetricBar
                  label="95% Confidence Coverage"
                  valueLabel={`${Math.round(activeReport.interval_coverage_95 * 100)}%`}
                  progress={activeReport.interval_coverage_95}
                  color={colors.accentBright}
                />
              ) : null}
              {'mae' in activeReport ? (
                <View style={styles.grid}>
                  <StatTile label="Avg Error" value={activeReport.mae.toFixed(3)} />
                  <StatTile label="Offset Bias" value={activeReport.bland_altman_bias.toFixed(4)} />
                  <StatTile
                    label="Deep-Sleep Link"
                    value={`+${activeReport.n3_associated_feature_sensitivity.toFixed(3)}`}
                  />
                </View>
              ) : (
                <View style={styles.grid}>
                  <StatTile label="Sample Size" value={String(activeReport.sample_count)} />
                  <StatTile label="Overall Match" value={activeReport.lin_ccc.toFixed(3)} />
                  <StatTile label="Status" value={activeReport.validation_passed ? 'Passing' : 'Review'} />
                </View>
              )}
            </View>
          ) : null}

          <View style={{ marginTop: spacing.s }}>
            <PrimaryButton
              title="Run Accuracy Check"
              variant="nav"
              loading={runValidation.isPending}
              onPress={() => runValidation.mutate()}
            />
          </View>
        </Card>

        <SectionHeading title="Add a Clinical MRI Scan Result" />
        <Card>
          <Text style={styles.label}>Study Group ID</Text>
          <TextInput
            style={styles.input}
            value={cohortId}
            onChangeText={setCohortId}
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[styles.label, { marginTop: spacing.s }]}>Hospital / Clinic ID</Text>
          <TextInput
            style={styles.input}
            value={siteId}
            onChangeText={setSiteId}
            placeholderTextColor={colors.textMuted}
          />
          <Text style={[styles.label, { marginTop: spacing.s }]}>MRI Brain-Fluid Score (3T Scan)</Text>
          <TextInput
            style={styles.input}
            value={dtiAlpsInput}
            onChangeText={setDtiAlpsInput}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.textMuted}
          />
          <View style={{ marginTop: spacing.m }}>
            <PrimaryButton
              title="Save MRI Scan Result"
              loading={registerMri.isPending}
              onPress={() => registerMri.mutate()}
            />
          </View>
          {refsQuery.data?.references?.length ? (
            <Text style={styles.metaText}>
              Saved MRI scans in study: {refsQuery.data.references.length}
            </Text>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.m },
  backText: { fontFamily: fontFamily.medium, fontSize: 13, color: moduleColors.health, fontWeight: '600' },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    color: colors.textPrimary,
    fontFamily: fontFamily.mono,
    fontSize: 13,
  },
  metaText: { ...typography.body, color: colors.textSecondary, marginTop: spacing.s },
  resultCard: { borderColor: 'rgba(45, 212, 191, 0.4)', gap: spacing.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { ...typography.sectionHeading, color: colors.textPrimary },
  grid: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  tile: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: radii.card, padding: spacing.s },
  tileLabel: { fontSize: 11, color: colors.textMuted },
  tileValue: { fontFamily: fontFamily.mono, fontSize: 12.5, color: colors.textPrimary, marginTop: 2 },
});
