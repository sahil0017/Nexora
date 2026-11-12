import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConversationIR, VoiceOverviewResponse, voiceApi } from '../../core/api/voice';

type VoiceContextValue = {
  overview: VoiceOverviewResponse | undefined;
  conversations: ConversationIR[];
  activeConversation: ConversationIR | undefined;
  activeConversationId: string | null;
  setActiveConversationId: (id: string) => void;
  loading: boolean;
  sseConnected: boolean;
  errorMsg: string | null;
  refresh: () => Promise<void>;
  refreshConversation: (id: string) => Promise<ConversationIR>;
  fetchConversations: () => Promise<ConversationIR[]>;
};

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function normalizeConversationIR(c: ConversationIR): ConversationIR {
  const recording = (c.recording ?? {}) as ConversationIR['recording'];
  const qr = (recording.quality_report ?? {}) as ConversationIR['recording']['quality_report'];
  const integ = (recording.integrity ?? {}) as ConversationIR['recording']['integrity'];
  const ek = (c.extracted_knowledge ?? {}) as ConversationIR['extracted_knowledge'];
  const ev = c.evidence
    ? {
        ...c.evidence,
        custody_events: Array.isArray(c.evidence.custody_events) ? c.evidence.custody_events : [],
      }
    : undefined;

  return {
    ...c,
    detected_languages: Array.isArray(c.detected_languages) ? c.detected_languages : [],
    topics: Array.isArray(c.topics) ? c.topics : [],
    participants: Array.isArray(c.participants) ? c.participants : [],
    utterances: Array.isArray(c.utterances)
      ? c.utterances.map(u => ({
          ...u,
          word_timestamps: Array.isArray(u.word_timestamps) ? u.word_timestamps : [],
        }))
      : [],
    conversation_events: Array.isArray(c.conversation_events) ? c.conversation_events : [],
    extracted_knowledge: {
      entities: Array.isArray(ek.entities) ? ek.entities : [],
      edges: Array.isArray(ek.edges) ? ek.edges : [],
    },
    reasoning_results: Array.isArray(c.reasoning_results) ? c.reasoning_results : [],
    action_suggestions: Array.isArray(c.action_suggestions) ? c.action_suggestions : [],
    human_corrections: Array.isArray(c.human_corrections) ? c.human_corrections : [],
    source_evidence_refs: Array.isArray(c.source_evidence_refs) ? c.source_evidence_refs : [],
    interaction_edges: Array.isArray(c.interaction_edges) ? c.interaction_edges : [],
    model_telemetry: Array.isArray(c.model_telemetry) ? c.model_telemetry : [],
    recording: {
      ...recording,
      quality_report: {
        ...qr,
        vad_segments: Array.isArray(qr.vad_segments) ? qr.vad_segments : [],
        warnings: Array.isArray(qr.warnings) ? qr.warnings : [],
      },
      integrity: integ,
    },
    evidence: ev,
  };
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['voice-overview'],
    queryFn: voiceApi.overview,
    refetchInterval: 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof EventSource === 'undefined') {
      return;
    }
    let es: EventSource | null = null;
    try {
      es = new EventSource(voiceApi.streamUrl());
      es.addEventListener('connected', () => setSseConnected(true));
      es.addEventListener('voice', () => {
        void qc.invalidateQueries({ queryKey: ['voice-overview'] });
        void qc.invalidateQueries({ queryKey: ['voice-call-logs'] });
      });
      es.onerror = () => setSseConnected(false);
    } catch {
      setSseConnected(false);
    }
    return () => {
      es?.close();
    };
  }, [qc]);

  const conversations = useMemo(
    () => (overviewQuery.data?.conversations ?? []).map(normalizeConversationIR),
    [overviewQuery.data?.conversations],
  );

  const activeConversation = useMemo(() => {
    if (!conversations.length) return undefined;
    if (selectedId) {
      const found = conversations.find(c => c.conversation_id === selectedId);
      if (found) return found;
    }
    return conversations[0];
  }, [conversations, selectedId]);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['voice-overview'] });
  }, [qc]);

  const refreshConversation = useCallback(
    async (id: string) => {
      const updated = normalizeConversationIR(await voiceApi.getConversation(id));
      await qc.invalidateQueries({ queryKey: ['voice-overview'] });
      return updated;
    },
    [qc],
  );

  const fetchConversations = useCallback(async () => {
    const res = await voiceApi.conversations();
    return (res.conversations ?? []).map(normalizeConversationIR);
  }, []);

  const value = useMemo<VoiceContextValue>(
    () => ({
      overview: overviewQuery.data,
      conversations,
      activeConversation,
      activeConversationId: activeConversation?.conversation_id ?? null,
      setActiveConversationId: setSelectedId,
      loading: overviewQuery.isLoading,
      sseConnected,
      errorMsg: overviewQuery.isError ? (overviewQuery.error as Error)?.message ?? 'Unable to load Voice & Call Notes' : null,
      refresh,
      refreshConversation,
      fetchConversations,
    }),
    [
      overviewQuery.data,
      overviewQuery.isLoading,
      overviewQuery.isError,
      overviewQuery.error,
      conversations,
      activeConversation,
      sseConnected,
      refresh,
      refreshConversation,
      fetchConversations,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoiceData() {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error('useVoiceData must be used inside VoiceProvider');
  }
  return ctx;
}
