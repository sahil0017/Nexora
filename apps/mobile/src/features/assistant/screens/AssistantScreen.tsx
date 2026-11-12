import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { Card, SegmentedControl } from '../../../core/design-system/components';
import { Chip, FadeIn, StatusPill, Tappable, TypingDots } from '../../../core/design-system/motion';
import {
  RouteContextPayload,
  RouteExplainability,
  digitalTwinApi,
  moveApi,
  platformApi,
} from '../../../core/api/move';
import { financeApi } from '../../../core/api/finance';
import { voiceApi } from '../../../core/api/voice';
import { useLocation } from '../../../core/location/useLocation';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { formatINR } from '../../finance/components/FinanceIntelligencePanels';

type ContextChunk = { id: string; title: string; content: string; relevance_score: number };

type Msg = {
  id: number;
  from: 'user' | 'assistant';
  text: string;
  meta?: string;
  intent?: string;
  actions?: string[];
  financeDomain?: boolean;
  voiceDomain?: boolean;
  context?: ContextChunk[];
  explainability?: RouteExplainability;
  error?: boolean;
};

type DomainKey = 'all' | 'move' | 'finance' | 'voice' | 'health' | 'work';

const DOMAINS: ReadonlyArray<{ key: DomainKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'move', label: 'Move' },
  { key: 'finance', label: 'Wealth' },
  { key: 'voice', label: 'Voice' },
  { key: 'health', label: 'Health' },
  { key: 'work', label: 'Work' },
];

type StarterPrompt = {
  id: string;
  domain: Exclude<DomainKey, 'all'>;
  title: string;
  subtitle: string;
  query: string;
  liveHint?: 'move' | 'finance' | 'voice';
};

const DOMAIN_LABEL: Record<Exclude<DomainKey, 'all'>, string> = {
  move: 'Move',
  finance: 'Wealth',
  voice: 'Voice',
  health: 'Health',
  work: 'Work',
};

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'voice-call-qa',
    domain: 'voice',
    title: 'Commitments & call memory QA',
    subtitle: 'Search decisions, commitments & speakers with citations',
    query: 'What commitments, decisions, or follow-ups are open across my recent conversations and calls?',
    liveHint: 'voice',
  },
  {
    id: 'fin-tax-cash',
    domain: 'finance',
    title: 'Audit tax & idle cash',
    subtitle: 'Review unused deductions, tax regime & cash buffer',
    query: 'Audit my cash, unused deductions & best income tax regime.',
    liveHint: 'finance',
  },
  {
    id: 'move-why-route',
    domain: 'move',
    title: 'Explain best route now',
    subtitle: 'Live corridor ETA, slowdowns & alternate options',
    query: 'Why is this route recommended right now?',
    liveHint: 'move',
  },
  {
    id: 'health-daily-brief',
    domain: 'health',
    title: 'Daily wellness brief',
    subtitle: 'Summarize health notes, habits & daily goals',
    query: 'Summarize my health records and daily wellness goals.',
  },
  {
    id: 'work-morning-brief',
    domain: 'work',
    title: 'Morning work briefing',
    subtitle: 'Top priorities & ideal departure window',
    query: 'Prepare my morning work briefing and ideal leave time.',
  },
  {
    id: 'fin-loan-sip',
    domain: 'finance',
    title: 'Prepay loan vs step-up SIP',
    subtitle: 'Compare debt interest saved against equity growth',
    query: 'Should I prepay my floating loan or increase monthly equity SIP?',
  },
  {
    id: 'move-safety',
    domain: 'move',
    title: 'Corridor & safety check',
    subtitle: 'Walkability, live traffic & road alerts nearby',
    query: 'Check pedestrian safety, road alerts, and corridor traffic near me.',
  },
  {
    id: 'health-recovery',
    domain: 'health',
    title: 'Energy & recovery plan',
    subtitle: 'Balance movement, sleep & peak-hour commute stress',
    query: 'Suggest an energy and recovery routine around my schedule today.',
  },
  {
    id: 'work-focus-commute',
    domain: 'work',
    title: 'Focus blocks & commute sync',
    subtitle: 'Align deep work around lowest-traffic hours',
    query: 'Help me schedule deep work blocks and the lowest-traffic commute window.',
  },
  {
    id: 'voice-spam-followup',
    domain: 'voice',
    title: 'Call logs & spam insights',
    subtitle: 'Review missed calls, repeat handles & spam risk patterns',
    query: 'Summarize my call logs, missed repeat callers, and spam risks.',
    liveHint: 'voice',
  },
];

const QUICK_LANGUAGES = [
  { badge: 'తెలుగు', label: 'రూట్ సలహా', query: 'ట్రాఫిక్ ఎక్కువగా ఉన్నప్పుడు ఏ రూట్ మంచిది?' },
  { badge: 'हिन्दी', label: 'ट्रैफिक अपडेट', query: 'पीक टाइम में सबसे भरोसेमंद रास्ता कौन सा है?' },
] as const;

type FollowUpChip = { label: string; query: string };

/** Build contextual next-step prompts from the active domain and latest assistant reply. */
function buildFollowUpSuggestions(
  domain: DomainKey,
  lastAssistant?: Msg,
  lastUserQuery?: string,
): FollowUpChip[] {
  if (lastAssistant?.error && lastUserQuery) {
    return [
      { label: 'Retry question', query: lastUserQuery },
      { label: 'Check live route status', query: 'Why is this route recommended right now?' },
      { label: 'Audit tax & cashflow', query: 'Audit my cash, unused deductions & best income tax regime.' },
    ];
  }

  const text = `${lastAssistant?.intent ?? ''} ${lastAssistant?.text ?? ''}`.toLowerCase();
  if (lastAssistant?.voiceDomain || domain === 'voice') {
    return [
      { label: 'Open commitments', query: 'List open commitments and decisions across my calls.' },
      { label: 'Missed & follow-up calls', query: 'Summarize missed calls, repeat callers, and spam risks.' },
      { label: 'Search call memory', query: 'What key topics came up in my recent conversations?' },
    ];
  }

  if (lastAssistant?.financeDomain || domain === 'finance') {
    if (text.includes('tax') || text.includes('regime') || text.includes('80c')) {
      return [
        { label: 'Old vs New tax split', query: 'Compare Old vs New tax regime on my current income.' },
        { label: 'Unused deductions', query: 'Which deductions under 80C, 80D, or NPS am I missing?' },
        { label: 'Next best money move', query: 'What is my highest-impact wealth action this month?' },
      ];
    }
    if (text.includes('sip') || text.includes('loan') || text.includes('emi')) {
      return [
        { label: '10% step-up SIP impact', query: 'Show 5-year impact of a 10% annual step-up SIP.' },
        { label: 'Safe monthly spend', query: 'How much can I safely invest or prepay each month?' },
        { label: 'Check idle cash', query: 'How much idle cash should stay in my emergency buffer?' },
      ];
    }
    return [
      { label: 'Compare tax regimes', query: 'Compare Old vs New tax regime on my profile.' },
      { label: 'Check idle cash', query: 'Audit my idle cash and emergency runway.' },
      { label: 'Top 3 wealth actions', query: 'Give me the top 3 prioritized wealth moves right now.' },
    ];
  }

  if (
    domain === 'move' ||
    text.includes('route') ||
    text.includes('traffic') ||
    text.includes('hazard') ||
    text.includes('corridor')
  ) {
    return [
      { label: 'Compare alternate routes', query: 'Compare alternate routes and ETA tradeoffs right now.' },
      { label: 'Best leave window', query: 'When is the lowest-traffic departure window today?' },
      { label: 'Any alerts ahead?', query: 'Check road alerts, bottlenecks, and safety near this corridor.' },
    ];
  }

  if (domain === 'health') {
    return [
      { label: 'Turn into daily checklist', query: 'Turn this into a simple 3-item daily wellness checklist.' },
      { label: 'Evening recovery tip', query: 'What is one quick recovery habit for tonight?' },
    ];
  }

  if (domain === 'work') {
    return [
      { label: 'Top 3 priorities today', query: 'Rank my top 3 work priorities for today.' },
      { label: 'Sync commute leave time', query: 'What time should I leave to avoid peak congestion?' },
    ];
  }

  return [
    { label: 'Explain why', query: 'Break down the key factors behind this recommendation.' },
    { label: 'Next concrete step', query: 'What is the single best next step I should take now?' },
    { label: '3-bullet summary', query: 'Summarize that in 3 concise action bullets.' },
  ];
}

const FINANCE_KEYWORDS = [
  'tax', 'regime', '80c', '80d', 'sip', 'mutual fund', 'mf', 'loan', 'emi', 'prepay',
  'net worth', 'portfolio', 'ltcg', 'stcg', 'salary', 'cfo', 'insurance', 'budget',
  'cash', 'runway', 'invest', 'debt', 'lrs', 'fd', 'gst', 'rupee', '₹', 'inr', 'wealth',
];

const VOICE_KEYWORDS = [
  'call', 'calls', 'caller', 'call log', 'call logs', 'voicemail', 'transcript',
  'conversation', 'commitment', 'commitments', 'speaker', 'recording', 'meeting',
  'follow-up', 'followup', 'spam', 'evidence', 'custody',
];

function isVoicePrompt(text: string, activeDomain: DomainKey): boolean {
  if (activeDomain === 'voice') return true;
  if (activeDomain === 'finance' || activeDomain === 'move') return false;
  const lower = text.toLowerCase();
  return VOICE_KEYWORDS.some(k => lower.includes(k));
}

function isFinancePrompt(text: string, activeDomain: DomainKey): boolean {
  if (activeDomain === 'finance') return true;
  if (activeDomain === 'move' || activeDomain === 'voice') return false;
  const lower = text.toLowerCase();
  return FINANCE_KEYWORDS.some(k => lower.includes(k));
}

let nextId = 1;

// AI-01 Interactive Copilot workspace with focused domain steering, starter prompts, GPS context, & action links.
export default function AssistantScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const loc = useLocation();
  const { permissions } = usePrivacyPermissions();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [domain, setDomain] = useState<DomainKey>('all');
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const [attachGps, setAttachGps] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expandedCtxId, setExpandedCtxId] = useState<number | null>(null);
  const [activeRouteCtx, setActiveRouteCtx] = useState<RouteContextPayload | undefined>(
    route.params?.routeContext,
  );
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const brief = useQuery({
    queryKey: ['assistant-proactive-brief', loc.point?.latitude, loc.point?.longitude],
    queryFn: () => digitalTwinApi.proactiveBrief(loc.point!),
    enabled: !!loc.point && attachGps,
    retry: 0,
  });

  const finTwin = useQuery({
    queryKey: ['copilot-finance-twin'],
    queryFn: financeApi.digitalTwin,
    retry: 0,
  });

  const finRadar = useQuery({
    queryKey: ['copilot-finance-radar'],
    queryFn: financeApi.radarOpportunities,
    retry: 0,
  });

  const voiceOverview = useQuery({
    queryKey: ['copilot-voice-overview'],
    queryFn: voiceApi.overview,
    retry: 0,
  });

  const voiceInsights = useQuery({
    queryKey: ['copilot-voice-insights'],
    queryFn: voiceApi.callLogInsights,
    retry: 0,
  });

  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const ask = useMutation({
    mutationFn: async (vars: { raw: string; routeContext?: RouteContextPayload }) => {
      const useVoiceBrain = isVoicePrompt(vars.raw, domain);
      const useFinanceBrain = !useVoiceBrain && isFinancePrompt(vars.raw, domain);
      const prefix = domain !== 'all' ? `[Focus: ${domain}] ` : '';
      const gpsSuffix =
        !useFinanceBrain && !useVoiceBrain && attachGps && loc.point
          ? ` (Near ${loc.point.latitude.toFixed(4)}, ${loc.point.longitude.toFixed(4)})`
          : '';
      const enriched = `${prefix}${vars.raw}${gpsSuffix}`;

      if (conversationId) {
        platformApi.sendConversationMessage(conversationId, enriched).catch(() => undefined);
      }

      if (useVoiceBrain) {
        if (!usePrivacyPermissions.getState().permissions.voiceConversationMemory) {
          throw new Error('Conversational Memory & Graph is turned off in Privacy & Access');
        }
        const [qa, ins] = await Promise.all([
          voiceApi.askQA(vars.raw),
          voiceApi.callLogInsights().catch(() => voiceInsights.data),
        ]);
        return { kind: 'voice' as const, qa, insights: ins };
      }

      if (useFinanceBrain) {
        if (!usePrivacyPermissions.getState().permissions.aiCfoTelemetry) {
          throw new Error('Wealth Advisor context sharing is turned off in Privacy & Access');
        }
        const cfo = await financeApi.queryCFO(vars.raw);
        return { kind: 'finance' as const, cfo };
      }

      const mob = await moveApi.assistantQuery(
        enriched,
        vars.routeContext ?? activeRouteCtx,
        attachGps ? loc.point : undefined,
      );
      return { kind: 'mobility' as const, mob };
    },
    onSuccess: res => {
      if (res.kind === 'voice') {
        const { qa, insights } = res;
        const alertLines =
          insights?.follow_up_alerts?.map(
            a => `${a.title} (${a.phone_masked}) — ${a.recommendation}`,
          ) ?? [];
        const insSummary =
          insights && insights.total_calls > 0
            ? `\n\nCall Insights: ${insights.total_calls} call(s) logged · ${insights.missed_count} missed · ${insights.high_risk_spam_count} high-risk spam · ${Math.round(insights.total_talk_duration_sec / 60)}m talk time.`
            : '';
        setMessages(m => [
          ...m,
          {
            id: nextId++,
            from: 'assistant',
            text: `${qa.answer}${insSummary}`,
            meta: `Voice Intelligence · ${qa.confidence_tier} (${Math.round(qa.confidence * 100)}%) · ${qa.citations.length} citation(s)`,
            actions: alertLines.length > 0 ? alertLines : undefined,
            context: qa.citations.map(c => ({
              id: c.utterance_id,
              title: `${c.conversation_title} · ${c.speaker_label}`,
              content: c.quote,
              relevance_score: c.score,
            })),
            voiceDomain: true,
          },
        ]);
        return;
      }

      if (res.kind === 'finance') {
        const { cfo } = res;
        const privacyLabel = cfo.evidence_bundle?.privacy_firewall?.pii_scrubbed
          ? 'Details Protected'
          : 'Private Session';
        const conf = cfo.evidence_bundle?.confidence_tier
          ? cfo.evidence_bundle.confidence_tier.replace(/_/g, ' ')
          : 'Verified';
        setMessages(m => [
          ...m,
          {
            id: nextId++,
            from: 'assistant',
            text: cfo.cfo_synthesis,
            meta: `Wealth Advisor · ${privacyLabel} · ${conf}${cfo.requires_action_approval ? ' · Review Recommended' : ''}`,
            actions: cfo.prioritized_actions,
            financeDomain: true,
          },
        ]);
        return;
      }

      const r = res.mob;
      const lang = (r.language ?? r.detected_language ?? 'en').toUpperCase();
      const topCtx = r.retrieved_context?.[0]?.title;
      const meta = ['Mobility', lang, topCtx].filter(Boolean).join(' · ');
      setMessages(m => [
        ...m,
        {
          id: nextId++,
          from: 'assistant',
          text: r.answer || r.reply || '',
          meta,
          intent: r.intent ?? r.detected_intents?.[0],
          context: r.retrieved_context,
          explainability: r.explainability,
        },
      ]);
    },
    onError: (e: Error) =>
      setMessages(m => [
        ...m,
        { id: nextId++, from: 'assistant', text: `Couldn't complete that request: ${e.message}`, error: true },
      ]),
  });

  const startThread = useMutation({
    mutationFn: platformApi.startConversation,
    onSuccess: res => setConversationId(res.conversation_id),
  });

  const submit = (text: string, overrideCtx?: RouteContextPayload) => {
    const t = text.trim();
    if (!t || ask.isPending) return;
    setMessages(m => [...m, { id: nextId++, from: 'user', text: t }]);
    setDraft('');
    ask.mutate({ raw: t, routeContext: overrideCtx });
  };

  const { prompt, nonce, routeContext: incomingCtx } = route.params ?? {};
  useEffect(() => {
    if (incomingCtx) setActiveRouteCtx(incomingCtx);
    if (prompt) submit(prompt, incomingCtx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const clearChat = () => {
    setMessages([]);
    setExpandedCtxId(null);
  };

  const fillDraft = (query: string) => {
    setDraft(query);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const visibleStarters = useMemo(() => {
    if (domain !== 'all') return STARTER_PROMPTS.filter(p => p.domain === domain);
    return showAllPrompts ? STARTER_PROMPTS : STARTER_PROMPTS.slice(0, 4);
  }, [domain, showAllPrompts]);

  const followUpSuggestions = useMemo(() => {
    const lastAssistant = [...messages].reverse().find(m => m.from === 'assistant');
    const lastUser = [...messages].reverse().find(m => m.from === 'user');
    return buildFollowUpSuggestions(domain, lastAssistant, lastUser?.text);
  }, [domain, messages]);

  const gpsActive = permissions.gpsLocation && attachGps && !!loc.point;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Clean Header */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={[typography.screenTitle, { color: colors.textPrimary }]}>Copilot</Text>
                <StatusPill label={conversationId ? 'SAVED' : 'PRIVATE'} tone="success" />
              </View>
              <Text style={styles.subtitle}>
                Commute, wealth & daily decisions in one conversation
              </Text>
            </View>
            <View style={styles.headerActions}>
              {!conversationId && (
                <TouchableOpacity onPress={() => startThread.mutate()} style={styles.pillBtn}>
                  <Text style={styles.pillText}>{startThread.isPending ? '…' : 'Save Thread'}</Text>
                </TouchableOpacity>
              )}
              {messages.length > 0 && (
                <TouchableOpacity onPress={clearChat} style={styles.pillBtn}>
                  <Text style={styles.pillText}>New Chat</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={{ marginTop: 10 }}>
            <SegmentedControl compact options={DOMAINS} value={domain} onChange={setDomain} />
          </View>

          {/* Compact horizontal live context strip */}
          {(brief.data || finTwin.data || voiceOverview.data) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.contextStrip}>
              {domain !== 'finance' && domain !== 'voice' && brief.data ? (
                <TouchableOpacity
                  onPress={() => submit(`Explain corridor status: ${brief.data.headline}`)}
                  style={[styles.contextChip, styles.contextChipMove]}>
                  <View style={[styles.dot, { backgroundColor: colors.routeCyan }]} />
                  <Text style={[styles.contextChipText, { color: colors.routeCyan }]} numberOfLines={1}>
                    Live Traffic: {brief.data.headline}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {domain !== 'move' && domain !== 'voice' && finTwin.data ? (
                <TouchableOpacity
                  onPress={() => submit('Audit my net worth, safe to spend & top tax/investment actions right now.')}
                  style={[styles.contextChip, styles.contextChipFinance]}>
                  <View style={[styles.dot, { backgroundColor: moduleColors.finance }]} />
                  <Text style={[styles.contextChipText, { color: moduleColors.finance }]} numberOfLines={1}>
                    Net Worth {formatINR(finTwin.data.net_worth_inr)}
                    {finRadar.data && finRadar.data.total_annualized_savings_inr > 0
                      ? ` · Save ${formatINR(finRadar.data.total_annualized_savings_inr)}/yr`
                      : ''}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {domain !== 'move' && domain !== 'finance' && voiceOverview.data ? (
                <TouchableOpacity
                  onPress={() =>
                    submit('What commitments, decisions, or call follow-ups are open across my conversations?')
                  }
                  style={[styles.contextChip, styles.contextChipVoice]}>
                  <View style={[styles.dot, { backgroundColor: moduleColors.voice }]} />
                  <Text style={[styles.contextChipText, { color: moduleColors.voice }]} numberOfLines={1}>
                    Voice: {voiceOverview.data.conversation_count} convs · {voiceInsights.data?.total_calls ?? 0} calls
                  </Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          )}
        </View>

        {/* Chat Area or Guided Welcome */}
        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.scrollBody,
            messages.length === 0 && styles.scrollBodyEmpty,
          ]}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
          {messages.length === 0 ? (
            <FadeIn index={0} style={styles.welcomeWrap}>
              <Card variant="featured" style={styles.heroCard}>
                <View style={styles.heroBadge}>
                  <Text style={styles.heroBadgeText}>✦ NEXORA COPILOT</Text>
                </View>
                <Text style={styles.heroTitle}>How can I help today?</Text>
                <Text style={styles.heroBody}>
                  Live guidance across routes, wealth, wellness & work — tap any prompt to run or edit it before sending.
                </Text>
              </Card>

              <View style={styles.starterSectionHeader}>
                <Text style={styles.starterSectionTitle}>TRY ASKING</Text>
                {domain === 'all' && STARTER_PROMPTS.length > 4 && (
                  <TouchableOpacity
                    onPress={() => setShowAllPrompts(v => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.starterToggle}>
                      {showAllPrompts ? 'Show fewer' : `Show all (${STARTER_PROMPTS.length})`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.starterList}>
                {visibleStarters.map(item => {
                  const accent = moduleColors[item.domain];
                  const liveTag =
                    item.liveHint === 'finance' &&
                    finRadar.data &&
                    finRadar.data.total_annualized_savings_inr > 0
                      ? `Save ${formatINR(finRadar.data.total_annualized_savings_inr)}/yr`
                      : item.liveHint === 'move' && brief.data
                      ? 'Live corridor'
                      : item.liveHint === 'voice' && voiceOverview.data
                      ? `${voiceOverview.data.conversation_count} convs · ${voiceInsights.data?.total_calls ?? 0} calls`
                      : null;

                  return (
                    <View key={item.id} style={styles.starterRowCard}>
                      <Tappable
                        onPress={() => submit(item.query)}
                        accessibilityLabel={`Ask ${item.title}`}
                        style={styles.starterMainTap}>
                        <View style={styles.starterTopLine}>
                          <View style={styles.starterDomainPill}>
                            <View style={[styles.dot, { backgroundColor: accent }]} />
                            <Text style={[styles.starterDomain, { color: accent }]}>
                              {DOMAIN_LABEL[item.domain]}
                            </Text>
                          </View>
                          {liveTag ? (
                            <View style={styles.liveTagPill}>
                              <Text style={styles.liveTagText}>{liveTag}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.starterTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.starterSub} numberOfLines={2}>
                          {item.subtitle}
                        </Text>
                      </Tappable>

                      <View style={styles.starterActions}>
                        <TouchableOpacity
                          onPress={() => fillDraft(item.query)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={`Edit prompt: ${item.title}`}
                          style={styles.editPromptBtn}>
                          <Text style={styles.editPromptText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => submit(item.query)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          accessibilityLabel={`Run prompt: ${item.title}`}
                          style={styles.runPromptBtn}>
                          <Text style={styles.runPromptArrow}>↗</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>

              {(domain === 'all' || domain === 'move') && (
                <View style={styles.langWrap}>
                  <Text style={styles.langLabel}>Ask in regional languages</Text>
                  <View style={styles.langRow}>
                    {QUICK_LANGUAGES.map(l => (
                      <TouchableOpacity
                        key={l.label}
                        onPress={() => submit(l.query)}
                        style={styles.langPill}>
                        <Text style={styles.langBadge}>{l.badge}</Text>
                        <Text style={styles.langText}>{l.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </FadeIn>
          ) : (
            messages.map(m => {
              const isCtxOpen = expandedCtxId === m.id;
              const showRouteActions =
                m.from === 'assistant' &&
                !m.error &&
                !m.financeDomain &&
                !m.voiceDomain &&
                (m.intent?.includes('route') ||
                  m.intent?.includes('traffic') ||
                  m.intent?.includes('hazard') ||
                  m.text.toLowerCase().includes('route') ||
                  m.text.toLowerCase().includes('traffic'));

              return (
                <FadeIn
                  key={m.id}
                  style={[styles.bubble, m.from === 'user' ? styles.userBubble : styles.assistantBubble]}>
                  {m.from === 'assistant' && (
                    <View style={styles.assistantTagRow}>
                      <Text
                        style={[
                          styles.assistantTag,
                          m.financeDomain && { color: moduleColors.finance },
                          m.voiceDomain && { color: moduleColors.voice },
                        ]}>
                        ✦ {m.voiceDomain ? 'Voice Intelligence' : m.financeDomain ? 'Wealth Advisor' : 'Copilot'}
                      </Text>
                    </View>
                  )}
                  <Text
                    style={[
                      styles.msgText,
                      m.from === 'user' && { color: '#FFFFFF' },
                      m.error && { color: colors.statusDanger },
                    ]}>
                    {m.text}
                  </Text>
                  {m.meta ? <Text style={styles.metaText}>{m.meta}</Text> : null}

                  {m.explainability?.factors && m.explainability.factors.length > 0 && (
                    <View style={styles.explainBox}>
                      <Text style={styles.explainHeading}>WHY RECOMMENDED</Text>
                      {m.explainability.factors.map((f, idx) => (
                        <View key={`${f.label}-${idx}`} style={styles.explainRow}>
                          <View
                            style={[
                              styles.impactDot,
                              {
                                backgroundColor:
                                  f.impact === 'positive'
                                    ? colors.statusSuccess
                                    : f.impact === 'warning'
                                    ? colors.statusWarning
                                    : colors.navBlue,
                              },
                            ]}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.factorLabel}>{f.label}</Text>
                            <Text style={styles.factorDetail}>{f.detail}</Text>
                          </View>
                        </View>
                      ))}
                      {m.explainability.confidence_note ? (
                        <Text style={styles.confNote}>{m.explainability.confidence_note}</Text>
                      ) : null}
                    </View>
                  )}

                  {m.context && m.context.length > 0 && (
                    <View style={{ marginTop: 8 }}>
                      <TouchableOpacity onPress={() => setExpandedCtxId(isCtxOpen ? null : m.id)}>
                        <Text style={styles.sourcesToggle}>
                          {isCtxOpen ? 'Hide sources ▲' : `View sources (${m.context.length}) ▼`}
                        </Text>
                      </TouchableOpacity>
                      {isCtxOpen && (
                        <View style={styles.ctxBox}>
                          {m.context.map(c => (
                            <View key={c.id} style={{ gap: 2 }}>
                              <Text style={styles.ctxTitle}>
                                {c.title} ({Math.round(c.relevance_score * 100)}%)
                              </Text>
                              <Text style={styles.ctxBody}>{c.content}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}

                  {m.actions && m.actions.length > 0 && (
                    <View style={styles.ctxBox}>
                      <Text style={[styles.explainHeading, { color: moduleColors.finance }]}>
                        RECOMMENDED NEXT STEPS
                      </Text>
                      {m.actions.map((act, idx) => (
                        <Text key={idx} style={styles.actionBullet}>
                          • {act}
                        </Text>
                      ))}
                    </View>
                  )}

                  {m.voiceDomain && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Voice', { screen: 'VoiceCapture' })}
                        style={[
                          styles.deepLinkBtn,
                          { backgroundColor: 'rgba(167, 139, 250, 0.14)', borderColor: moduleColors.voice },
                        ]}>
                        <Text style={[styles.deepLinkText, { color: moduleColors.voice }]}>Voice Hub →</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Voice', { screen: 'VoiceMemory' })}
                        style={[
                          styles.deepLinkBtn,
                          { backgroundColor: 'rgba(167, 139, 250, 0.08)', borderColor: 'rgba(167, 139, 250, 0.35)' },
                        ]}>
                        <Text style={[styles.deepLinkText, { color: moduleColors.voice }]}>Memory & QA →</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {m.financeDomain && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Finance', { screen: 'FinTwin' })}
                        style={[
                          styles.deepLinkBtn,
                          { backgroundColor: 'rgba(163, 230, 53, 0.14)', borderColor: moduleColors.finance },
                        ]}>
                        <Text style={[styles.deepLinkText, { color: moduleColors.finance }]}>Wealth Overview →</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Finance', { screen: 'FinCFO' })}
                        style={[
                          styles.deepLinkBtn,
                          { backgroundColor: 'rgba(163, 230, 53, 0.08)', borderColor: 'rgba(163, 230, 53, 0.35)' },
                        ]}>
                        <Text style={[styles.deepLinkText, { color: moduleColors.finance }]}>Wealth Advisor →</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {showRouteActions && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Mobility', { screen: 'Navigate' })}
                        style={styles.deepLinkBtn}>
                        <Text style={styles.deepLinkText}>Open Map →</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => nav.navigate('Mobility', { screen: 'Radar' })}
                        style={styles.deepLinkBtn}>
                        <Text style={styles.deepLinkText}>Live Traffic →</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </FadeIn>
              );
            })
          )}

          {ask.isPending && (
            <View style={[styles.bubble, styles.assistantBubble]}>
              <TypingDots />
            </View>
          )}
        </ScrollView>

        {/* Contextual follow-up strip only during active conversation */}
        {messages.length > 0 && !ask.isPending && (
          <View style={styles.followUpWrap}>
            <Text style={styles.followUpLabel}>SUGGESTED NEXT</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.followUpRow}>
              {followUpSuggestions.map(item => (
                <Chip key={item.label} label={`✦ ${item.label}`} onPress={() => submit(item.query)} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* Clean Composer with inline GPS toggle */}
        <View style={styles.composer}>
          <TouchableOpacity
            onPress={() => {
              if (!permissions.gpsLocation) {
                nav.navigate('PrivacyPermissions');
                return;
              }
              setAttachGps(v => !v);
            }}
            style={[styles.gpsPill, gpsActive && styles.gpsPillActive]}
            accessibilityLabel="Toggle location context">
            <Text style={[styles.gpsPillText, gpsActive && styles.gpsPillTextActive]}>
              {!permissions.gpsLocation ? 'GPS Off' : gpsActive ? '📍 GPS' : '📍 Off'}
            </Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder={
              domain === 'finance'
                ? 'Ask about taxes, SIPs, loans, cashflow…'
                : domain === 'voice'
                ? 'Ask about calls, commitments, callers, transcripts…'
                : domain === 'move'
                ? 'Ask about routes, traffic, road alerts…'
                : 'Message NEXORA Copilot…'
            }
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => submit(draft)}
            returnKeyType="send"
          />
          <Tappable onPress={() => submit(draft)} accessibilityLabel="Send">
            <View style={[styles.sendBtn, (!draft.trim() || ask.isPending) && { opacity: 0.4 }]}>
              <Text style={styles.send}>↑</Text>
            </View>
          </Tappable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgPrimary },
  header: {
    paddingHorizontal: spacing.m,
    paddingTop: spacing.s,
    paddingBottom: spacing.s,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 12,
    marginTop: 2,
  },
  headerActions: { flexDirection: 'row', gap: 6 },
  pillBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillText: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
  contextStrip: {
    flexDirection: 'row',
    gap: spacing.s,
    paddingTop: spacing.s,
  },
  contextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 280,
  },
  contextChipMove: {
    backgroundColor: 'rgba(34, 211, 238, 0.10)',
    borderColor: 'rgba(34, 211, 238, 0.28)',
  },
  contextChipFinance: {
    backgroundColor: 'rgba(163, 230, 53, 0.10)',
    borderColor: 'rgba(163, 230, 53, 0.28)',
  },
  contextChipVoice: {
    backgroundColor: 'rgba(167, 139, 250, 0.12)',
    borderColor: 'rgba(167, 139, 250, 0.32)',
  },
  contextChipText: { fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  scrollBody: { padding: spacing.m, gap: spacing.s },
  scrollBodyEmpty: { flexGrow: 1, justifyContent: 'flex-start', paddingTop: spacing.s, paddingBottom: spacing.l },
  welcomeWrap: { gap: spacing.m },
  heroCard: { gap: 6 },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  heroBadgeText: {
    color: colors.accentBright,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  heroTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamily.sans,
    fontSize: 17,
    fontWeight: '700',
  },
  heroBody: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  starterSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  starterSectionTitle: {
    ...typography.label,
    color: colors.textMuted,
  },
  starterToggle: {
    color: colors.routeCyan,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    fontWeight: '600',
  },
  starterList: {
    gap: spacing.s,
  },
  starterRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 10,
    gap: 10,
  },
  starterMainTap: {
    flex: 1,
    gap: 3,
  },
  starterTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  starterDomainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  starterDomain: {
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  liveTagPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  liveTagText: {
    color: colors.accentBright,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '600',
  },
  starterTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    fontWeight: '600',
  },
  starterSub: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
    lineHeight: 16,
  },
  starterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editPromptBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  editPromptText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    fontWeight: '600',
  },
  runPromptBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(29, 143, 225, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runPromptArrow: {
    color: colors.routeCyan,
    fontSize: 13,
    fontWeight: '700',
  },
  langWrap: {
    gap: 6,
    marginTop: spacing.xs,
  },
  langLabel: {
    color: colors.textMuted,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    fontWeight: '600',
  },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  langBadge: {
    color: colors.routeCyan,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    fontWeight: '700',
  },
  langText: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
  },
  bubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.navBlueDark,
    borderColor: colors.navBlue,
  },
  assistantBubble: { alignSelf: 'flex-start' },
  assistantTagRow: { marginBottom: 4 },
  assistantTag: {
    color: colors.accentBright,
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  msgText: {
    color: colors.textPrimary,
    fontFamily: fontFamily.sans,
    fontSize: 13.5,
    lineHeight: 19.5,
  },
  metaText: {
    color: colors.textMuted,
    fontFamily: fontFamily.sans,
    fontSize: 10.5,
    marginTop: 6,
  },
  ctxBox: {
    marginTop: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    padding: 9,
    gap: 6,
  },
  ctxTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
  ctxBody: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 16 },
  sourcesToggle: { color: colors.navBlue, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
  actionBullet: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17 },
  explainBox: {
    marginTop: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 9,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.25)',
  },
  explainHeading: {
    color: colors.routeCyan,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  explainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  impactDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  factorLabel: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
  factorDetail: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 11, lineHeight: 15 },
  confNote: { color: colors.routeCyan, fontFamily: fontFamily.medium, fontSize: 11, fontWeight: '600' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  deepLinkBtn: {
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    borderWidth: 1,
    borderColor: colors.navBlue,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  deepLinkText: { color: colors.routeCyan, fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600' },
  followUpWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  },
  followUpLabel: {
    color: colors.textMuted,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.m,
  },
  followUpRow: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.m, paddingBottom: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    paddingHorizontal: spacing.m,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  gpsPill: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 9,
    height: 36,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gpsPillActive: {
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    borderColor: colors.navBlue,
  },
  gpsPillText: { color: colors.textMuted, fontFamily: fontFamily.medium, fontSize: 11, fontWeight: '600' },
  gpsPillTextActive: { color: colors.routeCyan },
  input: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 40,
    color: colors.textPrimary,
    fontFamily: fontFamily.sans,
    fontSize: 13.5,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.navBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
