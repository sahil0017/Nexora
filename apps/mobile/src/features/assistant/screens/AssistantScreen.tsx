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
  context?: ContextChunk[];
  explainability?: RouteExplainability;
  error?: boolean;
};

type DomainKey = 'all' | 'move' | 'finance' | 'health' | 'work';

const DOMAINS: ReadonlyArray<{ key: DomainKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'move', label: 'Move' },
  { key: 'finance', label: 'Wealth' },
  { key: 'health', label: 'Health' },
  { key: 'work', label: 'Work' },
];

type StarterPrompt = {
  domain: Exclude<DomainKey, 'all'>;
  title: string;
  subtitle: string;
  query: string;
};

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    domain: 'finance',
    title: 'Audit Tax & Idle Cash',
    subtitle: 'Check regime savings & unused deductions',
    query: 'Audit my cash, unused deductions & best income tax regime.',
  },
  {
    domain: 'finance',
    title: 'Prepay Loan vs Increase SIP',
    subtitle: 'Compare debt payoff against equity returns',
    query: 'Should I prepay my floating loan or increase monthly equity SIP?',
  },
  {
    domain: 'move',
    title: 'Why This Route?',
    subtitle: 'Traffic, ETA & reliability breakdown',
    query: 'Why is this route recommended right now?',
  },
  {
    domain: 'move',
    title: 'Corridor & Safety Check',
    subtitle: 'Live traffic, road alerts & walkability',
    query: 'Check pedestrian safety, road alerts, and corridor traffic near me.',
  },
  {
    domain: 'health',
    title: 'Daily Wellness Brief',
    subtitle: 'Review recent health notes & reminders',
    query: 'Summarize my health records and daily wellness goals.',
  },
  {
    domain: 'work',
    title: 'Morning Work Briefing',
    subtitle: 'Tasks, commute timing & day prep',
    query: 'Prepare my morning work briefing and ideal leave time.',
  },
];

const QUICK_LANGUAGES = [
  { label: 'తెలుగు · రూట్ సలహా', query: 'ట్రాఫిక్ ఎక్కువగా ఉన్నప్పుడు ఏ రూట్ మంచిది?' },
  { label: 'हिन्दी · ट्रैफिक अपडेट', query: 'पीक टाइम में सबसे भरोसेमंद रास्ता कौन सा है?' },
] as const;

const FINANCE_KEYWORDS = [
  'tax', 'regime', '80c', '80d', 'sip', 'mutual fund', 'mf', 'loan', 'emi', 'prepay',
  'net worth', 'portfolio', 'ltcg', 'stcg', 'salary', 'cfo', 'insurance', 'budget',
  'cash', 'runway', 'invest', 'debt', 'lrs', 'fd', 'gst', 'rupee', '₹', 'inr', 'wealth',
];

function isFinancePrompt(text: string, activeDomain: DomainKey): boolean {
  if (activeDomain === 'finance') return true;
  if (activeDomain === 'move') return false;
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
  const [attachGps, setAttachGps] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [expandedCtxId, setExpandedCtxId] = useState<number | null>(null);
  const [activeRouteCtx, setActiveRouteCtx] = useState<RouteContextPayload | undefined>(
    route.params?.routeContext,
  );

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

  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const ask = useMutation({
    mutationFn: async (vars: { raw: string; routeContext?: RouteContextPayload }) => {
      const useFinanceBrain = isFinancePrompt(vars.raw, domain);
      const prefix = domain !== 'all' ? `[Focus: ${domain}] ` : '';
      const gpsSuffix =
        !useFinanceBrain && attachGps && loc.point
          ? ` (Near ${loc.point.latitude.toFixed(4)}, ${loc.point.longitude.toFixed(4)})`
          : '';
      const enriched = `${prefix}${vars.raw}${gpsSuffix}`;

      if (conversationId) {
        platformApi.sendConversationMessage(conversationId, enriched).catch(() => undefined);
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

  const visibleStarters = useMemo(
    () => (domain === 'all' ? STARTER_PROMPTS : STARTER_PROMPTS.filter(p => p.domain === domain)),
    [domain],
  );

  const followUpSuggestions = useMemo(() => {
    if (domain === 'finance') return ['Compare Old vs New tax', 'Check idle cash'];
    if (domain === 'move') return ['Any hazards near me?', 'Best departure window?'];
    return ['Why this recommendation?', 'What should I do next?'];
  }, [domain]);

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
          {(brief.data || finTwin.data) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.contextStrip}>
              {domain !== 'finance' && brief.data ? (
                <TouchableOpacity
                  onPress={() => submit(`Explain corridor status: ${brief.data.headline}`)}
                  style={[styles.contextChip, styles.contextChipMove]}>
                  <View style={[styles.dot, { backgroundColor: colors.routeCyan }]} />
                  <Text style={[styles.contextChipText, { color: colors.routeCyan }]} numberOfLines={1}>
                    Live Traffic: {brief.data.headline}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {domain !== 'move' && finTwin.data ? (
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
                  Ask about Hyderabad routes, live traffic, tax savings, SIP vs loan decisions, or your daily briefing in English, తెలుగు, or हिन्दी.
                </Text>
              </Card>

              <Text style={styles.starterSectionTitle}>SUGGESTED PROMPTS</Text>
              <View style={styles.starterGrid}>
                {visibleStarters.map(item => (
                  <Tappable
                    key={item.title}
                    onPress={() => submit(item.query)}
                    style={styles.starterCard}>
                    <View style={styles.starterHeader}>
                      <View style={[styles.dot, { backgroundColor: moduleColors[item.domain] }]} />
                      <Text style={styles.starterDomain}>{item.domain.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.starterTitle}>{item.title}</Text>
                    <Text style={styles.starterSub} numberOfLines={2}>
                      {item.subtitle}
                    </Text>
                  </Tappable>
                ))}
              </View>

              {(domain === 'all' || domain === 'move') && (
                <View style={styles.langRow}>
                  {QUICK_LANGUAGES.map(l => (
                    <Chip key={l.label} label={l.label} onPress={() => submit(l.query)} />
                  ))}
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
                      <Text style={[styles.assistantTag, m.financeDomain && { color: moduleColors.finance }]}>
                        ✦ {m.financeDomain ? 'Wealth Advisor' : 'Copilot'}
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.followUpRow}>
            {followUpSuggestions.map(q => (
              <Chip key={q} label={q} onPress={() => submit(q)} />
            ))}
          </ScrollView>
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
            style={styles.input}
            placeholder={
              domain === 'finance'
                ? 'Ask about taxes, SIPs, loans, cashflow…'
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
  contextChipText: { fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  scrollBody: { padding: spacing.m, gap: spacing.s },
  scrollBodyEmpty: { flexGrow: 1, justifyContent: 'center' },
  welcomeWrap: { gap: spacing.m },
  heroCard: { gap: spacing.s },
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
    fontSize: 18,
    fontWeight: '700',
  },
  heroBody: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 13,
    lineHeight: 19,
  },
  starterSectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  starterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s,
  },
  starterCard: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.card,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 4,
  },
  starterHeader: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  starterDomain: {
    color: colors.textMuted,
    fontFamily: fontFamily.medium,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  starterTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    fontWeight: '600',
  },
  starterSub: {
    color: colors.textSecondary,
    fontFamily: fontFamily.sans,
    fontSize: 11.5,
    lineHeight: 16,
  },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
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
  followUpRow: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.m, paddingVertical: 6 },
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
