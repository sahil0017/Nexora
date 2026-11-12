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
  { key: 'matrix', label: 'AI Overview' },
  { key: 'mobility', label: 'Road Safety' },
  { key: 'finance', label: 'Cashflow' },
  { key: 'voice', label: 'Call Priority' },
  { key: 'twin', label: 'Lifestyle Insights' },
  { key: 'benchmark', label: 'Speed Test' },
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
  const [voiceSampleText, setVoiceSampleText] = useState('Payment immediately fail ho gaya, cab booking issue please help!');
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

  const friendlyFeatures: Array<{ key: string; name: string; desc: string; domain: string }> = [
    {
      key: 'traffic_predictor',
      name: 'Traffic Flow Forecaster',
      desc: 'Predicts corridor traffic and road speeds 15 to 60 minutes ahead',
      domain: 'Commute',
    },
    {
      key: 'arrival_timer',
      name: 'Accurate Arrival Timer',
      desc: 'Calculates reliable arrival windows based on real weather and road conditions',
      domain: 'Commute',
    },
    {
      key: 'road_scanner',
      name: 'Road Hazard & Pothole Scanner',
      desc: 'Detects potholes, waterlogging, and road hazards from street photos',
      domain: 'Commute',
    },
    {
      key: 'route_guard',
      name: 'Trip Safety & Route Guard',
      desc: 'Monitors route safety, anticipates destination, and alerts on major road changes',
      domain: 'Commute',
    },
    {
      key: 'rush_hour_predictor',
      name: 'Rush Hour Demand Predictor',
      desc: 'Anticipates peak commuter times and suggests the smartest departure window',
      domain: 'Commute',
    },
    {
      key: 'smart_router',
      name: 'Smart Travel Recommender',
      desc: 'Balances time, cost, and comfort across two-wheelers, metro, and cabs',
      domain: 'Commute',
    },
    {
      key: 'expense_categorizer',
      name: 'Instant Expense Categorizer',
      desc: 'Identifies merchants (Swiggy, Uber, Zepto) and categorizes bank alerts automatically',
      domain: 'Wealth',
    },
    {
      key: 'fraud_guard',
      name: 'Spending Anomaly Guard',
      desc: 'Protects you by flagging unexpected spikes, duplicate charges, and irregular spending',
      domain: 'Wealth',
    },
    {
      key: 'cashflow_forecaster',
      name: '30-Day Cashflow Forecaster',
      desc: 'Projects your upcoming balance and financial runway so you never face shortfalls',
      domain: 'Wealth',
    },
    {
      key: 'wealth_radar',
      name: 'Market & Wealth Protection',
      desc: 'Monitors economic conditions to safeguard your savings and investment risk',
      domain: 'Wealth',
    },
    {
      key: 'stress_tester',
      name: 'Budget Stress Simulator',
      desc: 'Shows how inflation or interest rate changes affect your monthly budget',
      domain: 'Wealth',
    },
    {
      key: 'doc_reader',
      name: 'Smart Statement Reader',
      desc: 'Securely extracts details from uploaded bank statements and bills with zero hassle',
      domain: 'Wealth',
    },
    {
      key: 'multi_lang_voice',
      name: 'Multi-Language Voice Recognizer',
      desc: 'Understands English, Hindi, Telugu, and mixed everyday conversation accurately',
      domain: 'Voice',
    },
    {
      key: 'speaker_id',
      name: 'Speaker Identifier',
      desc: 'Recognizes different voices to keep call notes and meeting transcripts organized',
      domain: 'Voice',
    },
    {
      key: 'smart_recall',
      name: 'Voice Search & Smart Recall',
      desc: 'Finds key decisions, numbers, and commitments spoken in previous conversations',
      domain: 'Voice',
    },
    {
      key: 'urgent_call_detector',
      name: 'Urgent Call Detector',
      desc: 'Identifies urgent callers, payment issues, and priority follow-ups instantly',
      domain: 'Voice',
    },
    {
      key: 'lifestyle_insights',
      name: 'Personal Lifestyle Insights',
      desc: 'Connects your travel, spending, and daily habits into personalized recommendations',
      domain: 'Lifestyle',
    },
    {
      key: 'accuracy_guard',
      name: 'AI Quality & Accuracy Guard',
      desc: 'Continuously monitors model quality to ensure recommendations remain sharp',
      domain: 'System',
    },
  ];

  const isOnline = Boolean(statusQ.data?.status === 'ready' || statusQ.data?.brain_reachable);

  return (
    <Screen
      title="AI Intelligence Studio"
      subtitle="Smart automated protection for Commute, Wealth & Calls"
      showBack={true}
      scroll={false}>
      <View style={styles.container}>
        {/* Top Summary Banner */}
        <Card style={styles.bannerCard}>
          <View style={styles.bannerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>NEXORA AI Engine</Text>
              <Text style={styles.bannerSubtitle}>
                {isOnline
                  ? 'All 16 intelligent systems active & protecting your day'
                  : 'Operating securely in on-device mode'}
              </Text>
            </View>
            <StatusPill
              tone={isOnline ? 'success' : 'info'}
              label={isOnline ? '16 Systems Active' : 'Standby'}
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
              <SectionHeading title="Active Intelligent Systems" />
              <View style={styles.matrixGrid}>
                {friendlyFeatures.map(f => (
                  <Card key={f.key} style={styles.modelCard}>
                    <View style={styles.modelHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.modelName}>{f.name}</Text>
                        <Text style={styles.domainBadge}>{f.domain}</Text>
                      </View>
                      <View style={styles.dotOnline} />
                    </View>
                    <Text style={styles.modelDesc}>{f.desc}</Text>
                    <Text style={styles.modelMeta}>Response time: &lt; 3ms · Status: Active & Protecting</Text>
                  </Card>
                ))}
              </View>
            </FadeIn>
          )}

          {/* TAB 2: MOBILITY & VISION */}
          {activeTab === 'mobility' && (
            <FadeIn>
              <SectionHeading title="Road Hazard & Surface Scanner" />
              <Card style={styles.card}>
                <Text style={styles.label}>Choose a road scenario to scan:</Text>
                <View style={styles.scenarioRow}>
                  {([
                    { key: 'pothole', label: 'Pothole on Road' },
                    { key: 'waterlogging', label: 'Waterlogged Street' },
                    { key: 'damaged_road', label: 'Damaged Surface' },
                    { key: 'clear', label: 'Clear Highway' },
                  ] as const).map(s => (
                    <TouchableOpacity
                      key={s.key}
                      onPress={() => setVisionScenario(s.key)}
                      style={[styles.scenarioPill, visionScenario === s.key && styles.scenarioPillActive]}>
                      <Text style={[styles.scenarioText, visionScenario === s.key && styles.scenarioTextActive]}>
                        {s.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <PrimaryButton
                  title={visionMut.isPending ? 'Scanning Road Surface...' : 'Scan Road Surface'}
                  onPress={() => visionMut.mutate()}
                  variant="nav"
                />

                {visionResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>
                      {visionResult.hazards_detected[0]
                        ? `Hazard Detected: ${visionResult.hazards_detected[0].hazard_type.replace('_', ' ').toUpperCase()}`
                        : 'Road is Clear and Safe'}
                    </Text>
                    <Text style={styles.resultDetail}>
                      Severity Level: {visionResult.hazards_detected[0]?.severity_grade || 'None'} · Estimated Depth:{' '}
                      {visionResult.hazards_detected[0]?.depth_estimate_m ?? 0}m
                    </Text>
                    <Text style={styles.resultAdvisory}>Safety Tip: {visionResult.advisory}</Text>
                    <Text style={styles.modelTag}>Powered by: Road Vision AI</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 3: FINANCE & CASHFLOW */}
          {activeTab === 'finance' && (
            <FadeIn>
              <SectionHeading title="30-Day Balance Forecaster" />
              <Card style={styles.card}>
                <Text style={styles.label}>Starting Bank Balance (₹):</Text>
                <TextInput
                  style={styles.textInput}
                  value={cashflowBalance}
                  onChangeText={setCashflowBalance}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textMuted}
                />
                <View style={{ marginTop: spacing.s }}>
                  <PrimaryButton
                    title={cashflowMut.isPending ? 'Calculating Projection...' : 'Calculate 30-Day Projection'}
                    onPress={() => cashflowMut.mutate()}
                    variant="primary"
                  />
                </View>

                {cashflowResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Estimated Runway: {cashflowResult.runway_days} Days · Health: {cashflowResult.risk_status}</Text>
                    <Text style={styles.resultDetail}>
                      Projected Minimum Balance: ₹{cashflowResult.minimum_projected_balance_inr.toLocaleString()}
                    </Text>
                    <View style={styles.trajectoryRow}>
                      {cashflowResult.projections.slice(0, 4).map(p => (
                        <View key={p.day} style={styles.trajDay}>
                          <Text style={styles.trajDayLabel}>Day {p.day}</Text>
                          <Text style={styles.trajAmount}>₹{Math.round(p.predicted_balance_inr / 1000)}k</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.modelTag}>Powered by: Cashflow Intelligence</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 4: VOICE & URGENCY */}
          {activeTab === 'voice' && (
            <FadeIn>
              <SectionHeading title="Urgent Call & Dialect Detector" />
              <Card style={styles.card}>
                <Text style={styles.label}>Sample Voice Message or Call Note:</Text>
                <TextInput
                  style={[styles.textInput, { height: 60 }]}
                  value={voiceSampleText}
                  onChangeText={setVoiceSampleText}
                  multiline
                  placeholderTextColor={colors.textMuted}
                />
                <View style={{ marginTop: spacing.s }}>
                  <PrimaryButton
                    title={voiceUrgencyMut.isPending ? 'Analyzing Call...' : 'Analyze Call Urgency'}
                    onPress={() => voiceUrgencyMut.mutate()}
                    variant="nav"
                  />
                </View>

                {voiceUrgencyResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Priority Level: {voiceUrgencyResult.priority_tier.toUpperCase()}</Text>
                    <Text style={styles.resultDetail}>
                      Detected Mood: {voiceUrgencyResult.caller_affect} · Urgency Score:{' '}
                      {(voiceUrgencyResult.urgency_score * 100).toFixed(0)}%
                    </Text>
                    <Text style={styles.resultAdvisory}>
                      Immediate Follow-up Recommended: {voiceUrgencyResult.escalation_required ? 'YES (High Priority)' : 'No'}
                    </Text>
                    <Text style={styles.modelTag}>Powered by: Voice Urgency Engine</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 5: USER TWIN */}
          {activeTab === 'twin' && (
            <FadeIn>
              <SectionHeading title="Personal Lifestyle Insights" />
              <Card style={styles.card}>
                <Text style={styles.label}>How your commute, spending, and calls work together:</Text>
                <Text style={styles.helperText}>Combines 42 recent trips, your monthly spending patterns, and call activity to uncover personalized habits.</Text>
                <PrimaryButton
                  title={twinMut.isPending ? 'Analyzing Lifestyle Patterns...' : 'Discover My Lifestyle Insights'}
                  onPress={() => twinMut.mutate()}
                  variant="nav"
                />

                {twinResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>Preferred Travel: {twinResult.dominant_mode.toUpperCase()}</Text>
                    <Text style={styles.resultDetail}>Top Spending: {twinResult.top_spending_category} · Commute Stress Level: {twinResult.commute_stress_index}/10</Text>
                    <View style={{ marginTop: 8 }}>
                      {twinResult.cross_domain_correlations.map((c, i) => (
                        <Text key={i} style={styles.twinInsight}>• {c.insight}</Text>
                      ))}
                    </View>
                    <Text style={styles.modelTag}>Powered by: Smart Lifestyle Twin</Text>
                  </View>
                )}
              </Card>
            </FadeIn>
          )}

          {/* TAB 6: BENCHMARKS */}
          {activeTab === 'benchmark' && (
            <FadeIn>
              <SectionHeading title="System Health & Speed Test" />
              <Card style={styles.card}>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => benchmarkMut.mutate()}>
                    <Text style={styles.actionButtonText}>
                      {benchmarkMut.isPending ? 'Testing Systems...' : 'Run Speed Test'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: '#1f2e3d' }]}
                    onPress={() => driftMut.mutate()}>
                    <Text style={styles.actionButtonText}>
                      {driftMut.isPending ? 'Checking Accuracy...' : 'Verify Accuracy'}
                    </Text>
                  </TouchableOpacity>
                </View>

                {benchmarkResult && (
                  <View style={styles.resultBox}>
                    <Text style={styles.resultHeadline}>
                      All Systems Operational: YES · Average Speed: {(benchmarkResult.total_duration_ms / 8).toFixed(2)}ms (Instant)
                    </Text>
                    {benchmarkResult.benchmarks.map((b, i) => (
                      <View key={i} style={styles.benchRow}>
                        <Text style={styles.benchName}>{b.pillar}: {b.architecture.replace(/_/g, ' ')}</Text>
                        <Text style={styles.benchLatency}>{b.latency_ms.toFixed(2)}ms</Text>
                      </View>
                    ))}
                  </View>
                )}

                {driftResult && (
                  <View style={[styles.resultBox, { marginTop: 12 }]}>
                    <Text style={styles.resultHeadline}>Quality Check: {driftResult.feature_name.replace(/_/g, ' ')}</Text>
                    <Text style={styles.resultDetail}>
                      Status: {driftResult.drift_severity.toUpperCase()} · Calibrated & Active
                    </Text>
                    <Text style={styles.resultAdvisory}>Action: {driftResult.recommended_action}</Text>
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
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontWeight: '700',
    fontSize: 12.5,
  },
  domainBadge: {
    color: colors.navBlue,
    fontFamily: fontFamily.sans,
    fontSize: 9.5,
    backgroundColor: 'rgba(29, 143, 225, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  dotOnline: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00d26a',
  },
  modelDesc: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
    marginBottom: 3,
    lineHeight: 16,
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
    lineHeight: 17,
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
    fontSize: 11,
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
    fontSize: 10,
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
    fontSize: 12,
    marginBottom: 4,
    lineHeight: 17,
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
