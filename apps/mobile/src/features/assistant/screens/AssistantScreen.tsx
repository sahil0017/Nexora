import React, { useEffect, useRef, useState } from 'react';
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
import { colors, moduleColors, spacing, typography } from '../../../app/theme/tokens';
import { SegmentedControl } from '../../../core/design-system/components';
import { Chip, FadeIn, Tappable, TypingDots } from '../../../core/design-system/motion';
import {
  RouteContextPayload,
  RouteExplainability,
  digitalTwinApi,
  moveApi,
  platformApi,
} from '../../../core/api/move';
import { useLocation } from '../../../core/location/useLocation';

type ContextChunk = { id: string; title: string; content: string; relevance_score: number };

type Msg = {
  id: number;
  from: 'user' | 'assistant';
  text: string;
  meta?: string;
  intent?: string;
  context?: ContextChunk[];
  explainability?: RouteExplainability;
  error?: boolean;
};

const DOMAINS = [
  { key: 'all', label: 'All' },
  { key: 'move', label: 'Move' },
  { key: 'health', label: 'Health' },
  { key: 'finance', label: 'Finance' },
  { key: 'work', label: 'Work' },
] as const;

const MULTILINGUAL_PROMPTS = [
  { label: '✨ Why this route?', query: 'Why is this route recommended right now?' },
  { label: '🌐 City Twin Brief', query: 'Summarize the live digital twin corridor health, pedestrian safety, and crowd risk.' },
  { label: '🛡 Safety & Memory', query: 'Check pedestrian safety, animal conflict warnings, and road memory hazards near me.' },
  { label: 'EN · Best route now', query: 'What is the most reliable route during peak traffic?' },
  { label: 'తెలుగు · రూట్ సలహా', query: 'ట్రాఫిక్ ఎక్కువగా ఉన్నప్పుడు ఏ రూట్ మంచిది?' },
  { label: 'हिन्दी · ट्रैफिक अपडेट', query: 'पीक टाइम में सबसे भरोसेमंद रास्ता कौन सा है?' },
] as const;

let nextId = 1;
const INITIAL_MSG: Msg = {
  id: nextId++,
  from: 'assistant',
  text: 'How can I help? Ask about routes, traffic hazards, health, finances or tasks (English, తెలుగు, हिन्दी).',
};

// AI-01 Interactive Copilot workspace with domain steering, expandable RAG context, GPS context, & action deep links.
export default function AssistantScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const loc = useLocation();

  const [messages, setMessages] = useState<Msg[]>([INITIAL_MSG]);
  const [draft, setDraft] = useState('');
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]['key']>('all');
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

  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const ask = useMutation({
    mutationFn: async (vars: { raw: string; routeContext?: RouteContextPayload }) => {
      const prefix = domain !== 'all' ? `[Focus: ${domain}] ` : '';
      const gpsSuffix =
        attachGps && loc.point
          ? ` (Near ${loc.point.latitude.toFixed(4)}, ${loc.point.longitude.toFixed(4)})`
          : '';
      const enriched = `${prefix}${vars.raw}${gpsSuffix}`;

      // Also mirror into a tracked platform conversation asynchronously when available
      if (conversationId) {
        platformApi.sendConversationMessage(conversationId, enriched).catch(() => undefined);
      }
      return moveApi.assistantQuery(
        enriched,
        vars.routeContext ?? activeRouteCtx,
        attachGps ? loc.point : undefined,
      );
    },
    onSuccess: r => {
      const lang = (r.language ?? r.detected_language ?? 'en').toUpperCase();
      const topCtx = r.retrieved_context?.[0]?.title;
      const meta = [lang, r.model_version, topCtx].filter(Boolean).join(' · ');
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
        { id: nextId++, from: 'assistant', text: `I couldn't reach the assistant (${e.message}).`, error: true },
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
    setMessages([{ ...INITIAL_MSG, id: nextId++ }]);
    setExpandedCtxId(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.screenTitle, { color: colors.textPrimary }]}>Copilot</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12.5 }}>
                Context-aware AI · {conversationId ? 'Thread saved' : 'Instant NLU/RAG'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {!conversationId && (
                <TouchableOpacity onPress={() => startThread.mutate()} style={styles.pillBtn}>
                  <Text style={styles.pillText}>{startThread.isPending ? '…' : '+ Session'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={clearChat} style={styles.pillBtn}>
                <Text style={styles.pillText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ marginTop: 10 }}>
            <SegmentedControl compact options={[...DOMAINS]} value={domain} onChange={setDomain} />
          </View>
          {brief.data ? (
            <TouchableOpacity
              onPress={() => submit(`Explain corridor status: ${brief.data.headline}`)}
              style={{
                marginTop: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
                backgroundColor: 'rgba(34, 211, 238, 0.12)',
                borderWidth: 1,
                borderColor: 'rgba(34, 211, 238, 0.30)',
              }}>
              <Text style={{ color: colors.routeCyan, fontSize: 11.5, fontWeight: '700' }} numberOfLines={1}>
                🌐 Proactive Brief: {brief.data.headline}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.m, gap: spacing.s }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}>
          {messages.map(m => {
            const isCtxOpen = expandedCtxId === m.id;
            const showRouteActions =
              m.from === 'assistant' &&
              !m.error &&
              (m.intent?.includes('route') ||
                m.intent?.includes('traffic') ||
                m.intent?.includes('hazard') ||
                m.text.toLowerCase().includes('route') ||
                m.text.toLowerCase().includes('traffic'));

            return (
              <FadeIn
                key={m.id}
                style={[styles.bubble, m.from === 'user' ? styles.userBubble : styles.assistantBubble]}>
                <Text style={{ color: m.error ? colors.statusDanger : colors.textPrimary, lineHeight: 20 }}>
                  {m.text}
                </Text>
                {m.meta ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>{m.meta}</Text>
                ) : null}

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
                          <Text style={{ color: colors.textPrimary, fontSize: 11.5, fontWeight: '700' }}>
                            {f.label}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{f.detail}</Text>
                        </View>
                      </View>
                    ))}
                    {m.explainability.confidence_note ? (
                      <Text style={{ color: colors.routeCyan, fontSize: 11, fontWeight: '600' }}>
                        {m.explainability.confidence_note}
                      </Text>
                    ) : null}
                  </View>
                )}

                {m.context && m.context.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <TouchableOpacity onPress={() => setExpandedCtxId(isCtxOpen ? null : m.id)}>
                      <Text style={{ color: colors.navBlue, fontSize: 11.5, fontWeight: '700' }}>
                        {isCtxOpen ? 'Hide retrieved context ▲' : `Sources (${m.context.length}) ▼`}
                      </Text>
                    </TouchableOpacity>
                    {isCtxOpen && (
                      <View style={styles.ctxBox}>
                        {m.context.map(c => (
                          <View key={c.id} style={{ gap: 2 }}>
                            <Text style={{ color: colors.textPrimary, fontSize: 11.5, fontWeight: '700' }}>
                              {c.title} ({Math.round(c.relevance_score * 100)}%)
                            </Text>
                            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{c.content}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {showRouteActions && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => nav.navigate('Mobility', { screen: 'Navigate' })}
                      style={styles.deepLinkBtn}>
                      <Text style={styles.deepLinkText}>Open Mobility HUD →</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => nav.navigate('Mobility', { screen: 'Radar' })}
                      style={styles.deepLinkBtn}>
                      <Text style={styles.deepLinkText}>Live Radar →</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </FadeIn>
            );
          })}
          {ask.isPending && (
            <View style={[styles.bubble, styles.assistantBubble]}>
              <TypingDots />
            </View>
          )}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modulesRow}>
          <Chip
            label={attachGps && loc.point ? '📍 GPS On' : '📍 GPS Off'}
            active={attachGps && !!loc.point}
            onPress={() => setAttachGps(v => !v)}
          />
          {MULTILINGUAL_PROMPTS.map(p => (
            <Chip key={p.label} label={p.label} onPress={() => submit(p.query)} />
          ))}
        </ScrollView>

        <View style={styles.domainStrip}>
          {(['move', 'health', 'finance', 'work'] as const).map(k => (
            <Tappable key={k} onPress={() => setDomain(k)} style={styles.moduleChip}>
              <View style={[styles.dot, { backgroundColor: moduleColors[k] }]} />
              <Text style={{ color: domain === k ? colors.textPrimary : colors.textSecondary, fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' }}>
                {k}
              </Text>
            </Tappable>
          ))}
        </View>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Ask NEXORA anything…"
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
  header: { paddingHorizontal: spacing.m, paddingTop: spacing.s, paddingBottom: spacing.s },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pillBtn: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  bubble: {
    maxWidth: '88%',
    padding: spacing.m,
    borderRadius: 18,
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
  ctxBox: {
    marginTop: 6,
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  explainBox: {
    marginTop: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 9,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.25)',
  },
  explainHeading: { color: colors.routeCyan, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.7 },
  explainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  impactDot: { width: 7, height: 7, borderRadius: 4, marginTop: 4 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  deepLinkBtn: {
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    borderWidth: 1,
    borderColor: colors.navBlue,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  deepLinkText: { color: colors.routeCyan, fontSize: 11.5, fontWeight: '800' },
  modulesRow: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.m, paddingBottom: spacing.s },
  domainStrip: { flexDirection: 'row', gap: spacing.s, paddingHorizontal: spacing.m, paddingBottom: spacing.s },
  moduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    padding: spacing.m,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingHorizontal: spacing.m,
    height: 46,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.navBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
});
