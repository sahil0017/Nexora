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
    () => overviewQuery.data?.conversations ?? [],
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
      const updated = await voiceApi.getConversation(id);
      await qc.invalidateQueries({ queryKey: ['voice-overview'] });
      return updated;
    },
    [qc],
  );

  const fetchConversations = useCallback(async () => {
    const res = await voiceApi.conversations();
    return res.conversations ?? [];
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
      errorMsg: overviewQuery.isError ? (overviewQuery.error as Error)?.message ?? 'Unable to load Voice Intelligence' : null,
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
