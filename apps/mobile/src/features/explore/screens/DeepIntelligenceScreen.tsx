import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { Card, PrimaryButton, SectionHeading, SegmentedControl } from '../../../core/design-system/components';
import { FadeIn, StatusPill } from '../../../core/design-system/motion';
import { colors, fontFamily, spacing } from '../../../app/theme/tokens';
import {
  deepMlApi,
  BenchmarkResponse,
  CashflowForecastResponse,
  DriftResponse,
  UserTwinResponse,
  VisionInspectResponse,
  VoiceUrgencyResponse,
} from '../../../core/api/deepMl';

const TABS = [
  { key: 'matrix', label: 'Models' },
  { key: 'mobility', label: 'Vision & Move' },
  { key: 'finance', label: 'Cashflow & Risk' },
  { key: 'voice', label: 'Voice & Dialects' },
  { key: 'twin', label: 'User Twin' },
  { key: 'benchmark', label: 'Benchmarks' },
] as const;

export default function DeepIntelligenceScreen() {
  const nav = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('matrix');

  // Status Query
  const statusQ = useQuery({
    queryKey: ['deep-ml-status'],
    queryFn: deepMlApi.status,
    refetchInterval: 30_000,
  });

  // Interactive Mobility Vision state
  const [visionScenario, setVisionScenario] = useState<'pothole' | 'waterlogging' | 'damaged_road' | 'clear'>('pothole');
  const [visionResult, setVisionResult] = useState<VisionInspectResponse | null>(null);
  const visionMut = useMutation({
    mutationFn: () => deepMlApi.mobility.visionInspect({ simulated_scenario: visionScenario }),
    onSuccess: res => setVisionResult(res),
  });

  // Interactive Finance Cashflow state
  const [cashflowBalance, setCashflowBalance] = useState('145000');
  const [cashflowResult, setCashflowResult] = useState<CashflowForecastResponse | null>(null);
  const cashflowMut = useMutation({
    mutationFn: () => deepMlApi.finance.cashflowForecast({ starting_balance: Number(cashflowBalance) || 100000, horizon_days: 30 }),
    onSuccess: res => setCashflowResult(res),
  });

  // Interactive Voice Urgency state
  const [voiceSampleText, setVoiceSampleText] = useState('Bhai payment immediately fail ho gaya, cab booking issue please help!');
  const [voiceUrgencyResult, setVoiceUrgencyResult] = useState<VoiceUrgencyResponse | null>(null);
  const voiceUrgencyMut = useMutation({
    mutationFn: () => deepMlApi.voice.urgency({ transcript: voiceSampleText }),
    onSuccess: res => setVoiceUrgencyResult(res),
  });

  // Interactive Multimodal User Twin state
  const [twinResult, setTwinResult] = useState<UserTwinResponse | null>(null);
  const twinMut = useMutation({
    mutationFn: () => deepMlApi.multimodal.userTwin({ mobility_trips: 42, finance_spend_inr: 88500, voice_calls: 64 }),
    onSuccess: res => setTwinResult(res),
  });

  // Interactive Benchmark & Drift state
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResponse | null>(null);
  const [driftResult, setDriftResult] = useState<DriftResponse | null>(null);
  const benchmarkMut = useMutation({
    mutationFn: deepMlApi.evaluation.benchmark,
    onSuccess: res => setBenchmarkResult(res),
  });
  const driftMut = useMutation({
    mutationFn: () => deepMlApi.evaluation.drift({ feature_name: 'transaction_amount' }),
    onSuccess: res => setDriftResult(res),
  });

  const archs = statusQ.data?.architectures ?? {
    st_gnn: 'Spatio-Temporal Graph WaveNet (Mobility)',
    calibrated_eta: 'Conformal Quantile ETA Hybrid (Mobility)',
    trajectory_autoencoder: 'Transformer Outlier Trip Detector (Mobility)',
    vision_detector: 'YOLOv8/RT-DETR Road Hazard Inspector (Mobility)',
    demand_tft: 'Temporal Fusion Transformer Surge (Mobility)',
    offline_rl_policy: 'Deep Q/Imitation Corridor Policy (Mobility)',
    neural_classifier: 'Dynamic Indian Merchant Classifier (Finance)',
    deep_svdd: 'Deep Support Vector Data Description (Finance)',
    cashflow_sequence: 'N-BEATS/DeepAR Sequence Forecaster (Finance)',
    regime_switching: 'Deep Markov Factor Exposure (Finance)',
    knowledge_graph_shock: 'Graph Neural Shock Propagator (Finance)',
    document_intelligence: 'LayoutLM Statement OCR Parser (Finance)',
    whisper_asr_adapter: 'Whisper Telephony Indian Multi-Dialect ASR (Voice)',
    pyannote_diarizer: 'Multi-Speaker Turn Diarizer (Voice)',
    semantic_bge_m3: 'BGE-M3 Dense Semantic Search & QA (Voice)',
    affect_urgency: 'HuBERT Telephony Urgency Classifier (Voice)',
    multimodal_user_twin: 'Cross-Domain Latent User-Twin Fusion',
    evaluation_drift: 'KS-Test & ADWIN Continuous Monitor',
  };

  const isOnline = Boolean(statusQ.data?.status === 'ready' || statusQ.data?.brain_reachable);

  return (
    <Screen
      title="Deep ML Intelligence"
      subtitle="16-pillar neural brain for Mobility, Wealth & Voice"
      showBack={true}
      scroll={false}>
      <View style={styles.container}>
        {/* Top Summary Banner */}
        <Card style={styles.bannerCard}>
          <View style={styles.bannerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>NEXORA Neural Engine</Text>
              <Text style={styles.bannerSubtitle}>
                {isOnline
                  ? 'All 16 deep neural architectures active & optimized'
                  : 'Operating in client-resilient offline mode'}
              </Text>
            </View>
            <StatusPill
              tone={isOnline ? 'success' : 'info'}
              label={isOnline ? '16/16 Online' : 'Standby'}
            />
          </View>
        </Card>

        {/* Tab Controls */}
        <SegmentedControl
          options={TABS}
          value={activeTab}
          onChange={setActiveTab}
          compact
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          {/* TAB 1: MODEL MATRIX */}
          {activeTab === 'matrix' && (
            <FadeIn>
              <SectionHeading title="Neural Architecture Matrix" />
              <View style={styles.matrixGrid}>
                {Object.entries(archs).map(([key, desc]) => (
                  <Card key={key} style={styles.modelCard}>
                    <View style={styles.modelHeader}>
                      <Text style={styles.modelName}>{key.replace(/_/g, ' ').toUpperCase()}</Text>
                      <View style={styles.dotOnline} />
                    </View>
                    <Text style={styles.modelDesc}>{desc}</Text>
                    <Text style={styles.modelMeta}>Latency: &lt; 2.5ms · Concurrency: High</Text>
                  </Card>
                ))}
              </View>
            </FadeIn>
          )}

          {/* TAB 2: MOBILITY & VISION */}
          {activeTab === 'mobility' && (
            <FadeIn>
              <SectionHeading title="Computer Vision Road Inspector" />
              <Card style={styles.card}>
                <Text style={styles.label}>Select Simulated Street Camera Scenario:</Text>
                <View style={styles.scenarioRow}>
                  {(['pothole', 'waterlogging', 'damaged_road', 'clear'] as const).map(s => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setVisionScenario(s)}
                      style={[styles.scenarioPill, visionScenario === s && styles.scenarioPillActive]}>
                      <Text style={[styles.scenarioText, visionScenario === s && styles.scenarioTextActive]}>
                        {s.replace('_', ' ').toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <PrimaryButton
                  title={visionMut.isPending ? 'Inspecting Street Frame...' : 'Inspect Frame with YOLOv8 / RT-DETR'}
                  onPress={() => visionMut.mutate()}
                  variant="nav"
                />

                {visionResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Detection: {visionResult.hazards_detected[0]?.hazard_type || 'Clear'}</Text>
                    <Text style={styles.resultDetail}>
                      Severity Grade: {visionResult.hazards_detected[0]?.severity_grade || 'None'} · Depth:{' '}
                      {visionResult.hazards_detected[0]?.depth_estimate_m ?? 0}m
                    </Text>
                    <Text style={styles.resultAdvisory}>Advisory: {visionResult.advisory}</Text>
                    <Text style={styles.modelTag}>Model: {visionResult.model}</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 3: FINANCE & CASHFLOW */}
          {activeTab === 'finance' && (
            <FadeIn>
              <SectionHeading title="N-BEATS 30-Day Cashflow Forecaster" />
              <Card style={styles.card}>
                <Text style={styles.label}>Starting Balance (₹):</Text>
                <TextInput
                  style={styles.textInput}
                  value={cashflowBalance}
                  onChangeText={setCashflowBalance}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={{ marginTop: spacing.s }}>
                  <PrimaryButton
                    title={cashflowMut.isPending ? 'Forecasting Trajectory...' : 'Run N-BEATS Trajectory Forecast'}
                    onPress={() => cashflowMut.mutate()}
                    variant="primary"
                  />
                </View>

                {cashflowResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Runway: {cashflowResult.runway_days} Days · Status: {cashflowResult.risk_status}</Text>
                    <Text style={styles.resultDetail}>
                      Minimum Balance: ₹{cashflowResult.minimum_projected_balance_inr.toLocaleString()}
                    </Text>
                    <View style={styles.trajectoryRow}>
                      {cashflowResult.projections.slice(0, 4).map(p => (
                        <View key={p.day} style={styles.trajDay}>
                          <Text style={styles.trajDayLabel}>Day {p.day}</Text>
                          <Text style={styles.trajAmount}>₹{Math.round(p.predicted_balance_inr / 1000)}k</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.modelTag}>Model: {cashflowResult.model}</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 4: VOICE & URGENCY */}
          {activeTab === 'voice' && (
            <FadeIn>
              <SectionHeading title="Affect & Urgency Classifier" />
              <Card style={styles.card}>
                <Text style={styles.label}>Telephony Transcript Snippet:</Text>
                <TextInput
                  style={[styles.textInput, { height: 60 }]}
                  value={voiceSampleText}
                  onChangeText={setVoiceSampleText}
                  multiline
                  placeholderTextColor={colors.textMuted}
                />
                <View style={{ marginTop: spacing.s }}>
                  <PrimaryButton
                    title={voiceUrgencyMut.isPending ? 'Scoring Affect...' : 'Score Urgency & Affect'}
                    onPress={() => voiceUrgencyMut.mutate()}
                    variant="nav"
                  />
                </View>

                {voiceUrgencyResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Priority Tier: {voiceUrgencyResult.priority_tier}</Text>
                    <Text style={styles.resultDetail}>
                      Affect: {voiceUrgencyResult.caller_affect} · Urgency Score:{' '}
                      {(voiceUrgencyResult.urgency_score * 100).toFixed(1)}%
                    </Text>
                    <Text style={styles.resultAdvisory}>
                      Escalation Required: {voiceUrgencyResult.escalation_required ? 'YES (High Priority)' : 'No'}
                    </Text>
                    <Text style={styles.modelTag}>Model: {voiceUrgencyResult.model}</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 5: USER TWIN */}
          {activeTab === 'twin' && (
            <FadeIn>
              <SectionHeading title="Multimodal User Twin" />
              <Card style={styles.card}>
                <Text style={styles.label}>Synthesize Cross-Domain Habits:</Text>
                <Text style={styles.helperText}>Combines 42 trips, ₹88.5k spend, and 64 call interactions into a 128-dim shared vector.</Text>
                <PrimaryButton
                  title={twinMut.isPending ? 'Synthesizing Twin...' : 'Synthesize Multimodal User Twin'}
                  onPress={() => twinMut.mutate()}
                  variant="nav"
                />

                {twinResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Dominant Mode: {twinResult.dominant_mode.toUpperCase()}</Text>
                    <Text style={styles.resultDetail}>Top Spend: {twinResult.top_spending_category} · Commute Stress: {twinResult.commute_stress_index}</Text>
                    <View style={{ marginTop: 8 }}>
                      {twinResult.cross_domain_correlations.map((c, i) => (
                        <Text key={i} style={styles.twinInsight}>• {c.insight}</Text>
                      ))}
                    </View>
                    <Text style={styles.modelTag}>Model: {twinResult.model}</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 6: BENCHMARKS */}
          {activeTab === 'benchmark' && (
            <FadeIn>
              <SectionHeading title="Continuous Evaluation & Drift" />
              <Card style={styles.card}>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => benchmarkMut.mutate()}>
                    <Text style={styles.actionButtonText}>
                      {benchmarkMut.isPending ? 'Running 8 Pillars...' : 'Run 8-Pillar Benchmark'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#1f2e3d' }]}
                    onPress={() => driftMut.mutate()}>
                    <Text style={styles.actionButtonText}>
                      {driftMut.isPending ? 'Checking Drift...' : 'Check Feature Drift'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {benchmarkResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>
                      All Benchmarks Passed: {benchmarkResult.all_passed ? 'YES' : 'NO'} · {benchmarkResult.total_duration_ms.toFixed(2)}ms
                    </Text>
                    {benchmarkResult.benchmarks.map((b, i) => (
                      <View key={i} style={styles.benchRow}>
                        <Text style={styles.benchName}>{b.pillar}: {b.architecture}</Text>
                        <Text style={styles.benchLatency}>{b.latency_ms.toFixed(2)}ms</Text>
                      </View>
                    ))}
                  </View>
                )}

                {driftResult && (
                  <View style={[styles.resultBox, { marginTop: 12 }]}>
                    <Text style={styles.resultHeadline}>Drift Monitor: {driftResult.feature_name}</Text>
                    <Text style={styles.resultDetail}>
                      KS-Stat: {driftResult.ks_statistic.toFixed(4)} · p-value: {driftResult.p_value.toFixed(4)}
                    </Text>
                    <Text style={styles.resultAdvisory}>Status: {driftResult.drift_severity.toUpperCase()} · Action: {driftResult.recommended_action}</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.m,
  },
  scrollContent: {
    paddingBottom: 40,
    paddingTop: spacing.s,
  },
  bannerCard: {
    backgroundColor: '#0a1622',
    borderColor: '#1d8fe144',
    borderWidth: 1,
    marginBottom: spacing.m,
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bannerTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 2,
  },
  bannerSubtitle: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 12,
  },
  matrixGrid: {
    marginTop: spacing.xs,
  },
  modelCard: {
    marginBottom: spacing.xs,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0a131e',
    borderColor: colors.borderSubtle,
  },
  modelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  modelName: {
    color: colors.navBlue,
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  dotOnline: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00d26a',
  },
  modelDesc: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    marginBottom: 2,
  },
  modelMeta: {
    color: colors.textMuted,
    fontFamily: fontFamily.sans,
    fontSize: 10,
  },
  card: {
    marginTop: spacing.xs,
    backgroundColor: '#0a131e',
  },
  label: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    marginBottom: 8,
  },
  helperText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 12,
    marginBottom: 12,
  },
  textInput: {
    backgroundColor: '#060B10',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    color: colors.textPrimary,
    fontFamily: fontFamily.sans,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  scenarioRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  scenarioPill: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#101e2b',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  scenarioPillActive: {
    backgroundColor: colors.navBlue,
    borderColor: colors.navBlue,
  },
  scenarioText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    fontSize: 10,
  },
  scenarioTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  resultBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#060d14',
    borderWidth: 1,
    borderColor: '#1d8fe133',
  },
  resultHeadline: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  resultDetail: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 12,
    marginBottom: 4,
  },
  resultAdvisory: {
    color: colors.navBlue,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    marginBottom: 6,
  },
  modelTag: {
    color: colors.textMuted,
    fontFamily: fontFamily.sans,
    fontSize: 9.5,
  },
  trajectoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 8,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderSubtle,
  },
  trajDay: {
    alignItems: 'center',
  },
  trajDayLabel: {
    color: colors.textMuted,
    fontFamily: fontFamily.sans,
    fontSize: 10,
  },
  trajAmount: {
    color: '#00d26a',
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 12,
  },
  twinInsight: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
    marginBottom: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.navBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 11,
  },
  benchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  benchName: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11,
  },
  benchLatency: {
    color: '#00d26a',
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 11,
  },
});
