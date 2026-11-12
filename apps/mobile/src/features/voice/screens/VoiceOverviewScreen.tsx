import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, fontFamily, moduleColors, radii, spacing, typography } from '../../../app/theme/tokens';
import { CallerContextResponse, CaptureSession, voiceApi } from '../../../core/api/voice';
import {
  fetchDeviceCallLogs,
  getNativeCallerCapabilities,
  putAudioToPresignedUrl,
  requestAndroidScreeningRole,
  syncOsCallerDirectory,
} from '../../../core/native/callerIdBridge';
import { Card, Input, PrimaryButton, SectionHeading } from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, StatusPill, Tappable } from '../../../core/design-system/motion';
import { usePrivacyPermissions } from '../../../core/permissions/usePrivacyPermissions';
import { Screen } from '../../../shared/components/Screen';
import { useVoiceData } from '../VoiceContext';

const SOURCE_TYPES = [
  { key: 'mobile_mic', label: 'Live Mic' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'call', label: 'Supported Call' },
  { key: 'imported_file', label: 'Import' },
] as const;

const CAPTURE_MODES = [
  { key: 'call_dual_track', label: 'Dual-Track Call' },
  { key: 'background_service_mic', label: 'Android FG Mic' },
  { key: 'foreground_mic', label: 'iOS Audio Session' },
  { key: 'meeting_stream', label: 'Meeting Stream' },
] as const;

const CHANNEL_HINTS = [
  { key: 'local_mic', label: 'Local Mic (You)' },
  { key: 'remote_track', label: 'Remote Caller' },
  { key: 'mixed_room', label: 'Mixed Room' },
] as const;

export default function VoiceOverviewScreen() {
  const nav = useNavigation<any>();
  const { permissions, requestOsCallLogs, requestOsCallScreening } = usePrivacyPermissions();
  const { overview, conversations, activeConversation, setActiveConversationId, loading, sseConnected, errorMsg, refresh, fetchConversations } =
    useVoiceData();

  const [showCapture, setShowCapture] = useState(false);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]['key']>('meeting');
  const [transcript, setTranscript] = useState('');
  const [snrText, setSnrText] = useState('22');
  const [overlapSuspected, setOverlapSuspected] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const [liveSession, setLiveSession] = useState<CaptureSession | null>(null);
  const [captureMode, setCaptureMode] = useState<(typeof CAPTURE_MODES)[number]['key']>('call_dual_track');
  const [channelHint, setChannelHint] = useState<(typeof CHANNEL_HINTS)[number]['key']>('local_mic');
  const [chunkText, setChunkText] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [callerPhone, setCallerPhone] = useState('');
  const [callerCtx, setCallerCtx] = useState<CallerContextResponse | null>(null);
  const [classifyName, setClassifyName] = useState('');
  const [classifyRelation, setClassifyRelation] = useState('client');
  const [classifyOrg, setClassifyOrg] = useState('');
  const [callerNotice, setCallerNotice] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [callLogsInput, setCallLogsInput] = useState('');
  const [callLogsNotice, setCallLogsNotice] = useState<string | null>(null);
  const nativeCaps = getNativeCallerCapabilities();

  const callLogsQuery = useQuery({
    queryKey: ['voice-call-logs'],
    queryFn: () => voiceApi.callLogs(100),
  });

  const importCallLogsMut = useMutation({
    mutationFn: async (mode: 'device' | 'text') => {
      if (mode === 'device') {
        if (!permissions.deviceCallLogsRead) {
          const osStatus = await requestOsCallLogs();
          if (osStatus !== 'granted') {
            throw new Error('Grant "Device Historic Call Logs" in Privacy & Access first.');
          }
        }
        const res = await fetchDeviceCallLogs(200);
        if (!res.supported || res.logs.length === 0) {
          throw new Error(res.note);
        }
        return voiceApi.importCallLogs({ source: 'device_call_log', logs: res.logs });
      }
      const trimmed = callLogsInput.trim();
      if (!trimmed) {
        throw new Error('Paste CSV (phone_number,contact_name,direction,duration_sec,started_at) or JSON logs first.');
      }
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed);
        const logs = Array.isArray(parsed) ? parsed : parsed.logs ?? [];
        return voiceApi.importCallLogs({ source: 'json_import', logs });
      }
      return voiceApi.importCallLogs({ source: 'csv_import', raw_csv: trimmed });
    },
    onSuccess: async res => {
      setCallLogsInput('');
      setCallLogsNotice(
        `Loaded ${res.imported_count} call log(s), linked ${res.linked_conversations} conversation(s), ${res.insights.follow_up_alerts.length} insight alert(s).`,
      );
      await callLogsQuery.refetch();
      await refresh();
    },
    onError: (err: any) => setCallLogsNotice(err?.message ?? 'Call log import failed'),
  });

  const captureMut = useMutation({
    mutationFn: () => {
      if (!transcript.trim()) {
        throw new Error('Enter or paste real conversation/call transcript text before processing.');
      }
      const payload = {
        title: title.trim() || 'Captured Conversation',
        source_type: sourceType,
        language: 'en',
        consent_granted: true,
        transcript_text: transcript.trim(),
        snr_db: Number(snrText) || 22,
        overlap_suspected: overlapSuspected,
      };
      return sourceType === 'imported_file' ? voiceApi.importRecording(payload) : voiceApi.capture(payload);
    },
    onSuccess: async created => {
      setTitle('');
      setTranscript('');
      setShowCapture(false);
      setCaptureError(null);
      setActiveConversationId(created.conversation_id);
      await refresh();
    },
    onError: (err: any) => {
      setCaptureError(err?.message ?? 'Capture failed');
    },
  });

  const handleCapture = () => {
    if (!permissions.voiceMicCapture) {
      setCaptureError('Enable "Voice Capture & Recording Import" in Privacy & Access first.');
      return;
    }
    setCaptureError(null);
    captureMut.mutate();
  };

  const startSessionMut = useMutation({
    mutationFn: () =>
      voiceApi.startSession({
        title: sessionTitle.trim() || 'Live Call Session',
        capture_mode: captureMode,
        source_type: captureMode === 'call_dual_track' ? 'call' : captureMode === 'meeting_stream' ? 'meeting' : 'mobile_mic',
        language: 'en',
        consent_granted: true,
      }),
    onSuccess: async sess => {
      setLiveSession(sess);
      setSessionError(null);
      setActiveConversationId(sess.conversation_id);
      await refresh();
    },
    onError: (err: any) => setSessionError(err?.message ?? 'Could not start call session'),
  });

  const streamChunkMut = useMutation({
    mutationFn: () => {
      if (!chunkText.trim()) {
        throw new Error('Enter live transcript text or stream captured audio frames.');
      }
      return voiceApi.streamChunk(liveSession!.session_id, {
        chunk_seq: (liveSession?.chunk_count ?? 0) + 1,
        channel_hint: channelHint,
        in_background: liveSession?.state === 'background',
        transcript_text: chunkText.trim(),
        snr_db: 22,
        duration_ms: 4000,
      });
    },
    onSuccess: async res => {
      setLiveSession(res.session);
      setChunkText('');
      setSessionError(null);
      setActiveConversationId(res.ir.conversation_id);
      await refresh();
    },
    onError: (err: any) => setSessionError(err?.message ?? 'Failed to stream chunk'),
  });

  const toggleBgMut = useMutation({
    mutationFn: () =>
      voiceApi.updateSessionState(
        liveSession!.session_id,
        liveSession?.state === 'background' ? 'active' : 'background',
      ),
    onSuccess: sess => {
      setLiveSession(sess);
      setSessionError(null);
    },
    onError: (err: any) => setSessionError(err?.message ?? 'State update failed'),
  });

  const finalizeSessionMut = useMutation({
    mutationFn: () => voiceApi.finalizeSession(liveSession!.session_id),
    onSuccess: async res => {
      setLiveSession(null);
      setSessionTitle('');
      setSessionError(null);
      setActiveConversationId(res.ir.conversation_id);
      await refresh();
    },
    onError: (err: any) => setSessionError(err?.message ?? 'Finalize failed'),
  });

  const handleStartSession = () => {
    if (!permissions.voiceMicCapture) {
      setSessionError('Enable "Voice Capture & Recording Import" in Privacy & Access first.');
      return;
    }
    setSessionError(null);
    startSessionMut.mutate();
  };

  const resolveCallerMut = useMutation({
    mutationFn: () =>
      voiceApi.resolveCaller({
        phone_number: callerPhone.trim(),
        caller_source: nativeCaps.iosCallDirectoryAvailable ? 'ios_call_directory' : 'android_call_screening',
      }),
    onSuccess: res => {
      setCallerCtx(res);
      setCallerNotice(
        res.caller.needs_classification
          ? 'Unknown number — classify after call to build local Caller Intelligence.'
          : null,
      );
    },
    onError: (err: any) => setCallerNotice(err?.message ?? 'Caller lookup failed'),
  });

  const classifyCallerMut = useMutation({
    mutationFn: () =>
      voiceApi.classifyCaller({
        phone_number: callerPhone.trim(),
        display_name: classifyName.trim() || 'Identified Contact',
        relationship_label: classifyRelation,
        organization: classifyOrg.trim(),
        conversation_id: activeConversation?.conversation_id,
      }),
    onSuccess: async updated => {
      setCallerCtx(prev => (prev ? { ...prev, caller: updated } : { caller: updated, timeline: [] }));
      setCallerNotice('Saved to local Caller Intelligence DB & linked to conversation.');
      await refresh();
    },
  });

  const spamReportMut = useMutation({
    mutationFn: () => voiceApi.reportCallerSpam({ phone_number: callerPhone.trim(), reason: 'User reported spam' }),
    onSuccess: updated => {
      setCallerCtx(prev => (prev ? { ...prev, caller: updated } : { caller: updated, timeline: [] }));
      setCallerNotice(
        `Spam pattern updated (${(updated.spam_risk || 'low').toUpperCase()} · ${updated.spam_reports} report(s)).`,
      );
    },
  });

  const syncOsDirMut = useMutation({
    mutationFn: async () => {
      const syncData = await voiceApi.syncCallerDirectory();
      const osRes = await syncOsCallerDirectory(syncData.entries);
      const roleRes = await requestAndroidScreeningRole();
      return { osRes, roleRes };
    },
    onSuccess: ({ osRes, roleRes }) => {
      setCallerNotice(`Synced ${osRes.count} caller entries (${osRes.mode}). ${roleRes.note}`);
    },
  });

  const presignUploadMut = useMutation({
    mutationFn: async () => {
      const sourceText = chunkText.trim() || transcript.trim();
      if (!sourceText) {
        throw new Error('Provide transcript notes or audio content in Capture before presigning upload.');
      }
      const presigned = await voiceApi.presignUpload({
        title: sessionTitle.trim() || title.trim() || 'Call Recording Upload',
        source_type: 'call',
        mime_type: 'text/plain',
        byte_size: sourceText.length,
        phone_number: callerPhone.trim() || undefined,
        call_direction: 'inbound',
        consent_granted: true,
      });
      const putRes = await putAudioToPresignedUrl(presigned.upload_url, sourceText, presigned.required_headers);
      if (!putRes.ok) {
        throw new Error(`Upload returned status ${putRes.status}`);
      }
      return voiceApi.completeUpload(presigned.recording_id, {
        s3_etag: putRes.etag,
        byte_size: sourceText.length,
        duration_ms: 4200,
        phone_number: callerPhone.trim() || undefined,
        call_direction: 'inbound',
        transcript_text: sourceText,
      });
    },
    onSuccess: async res => {
      setActiveConversationId(res.ir.conversation_id);
      setCallerNotice(`Uploaded to ${res.ir.recording.s3_object_key} & linked to Postgres.`);
      await refresh();
    },
    onError: (err: any) => setCallerNotice(err?.message ?? 'Presigned upload failed'),
  });

  const resumeSessionMut = useMutation({
    mutationFn: (sid: string) => voiceApi.getSession(sid),
    onSuccess: sess => {
      setLiveSession(sess);
      setSessionError(null);
    },
    onError: (err: any) => setSessionError(err?.message ?? 'Unable to resume session'),
  });

  const timelineMut = useMutation({
    mutationFn: () => voiceApi.callerTimeline(callerPhone.trim()),
    onSuccess: res => {
      setCallerCtx(res);
      setCallerNotice(`Loaded ${res.timeline.length} past call(s) from timeline.`);
    },
    onError: (err: any) => setCallerNotice(err?.message ?? 'Timeline lookup failed'),
  });

  const bindCallerMut = useMutation({
    mutationFn: () =>
      voiceApi.bindCaller(activeConversation!.conversation_id, {
        phone_number: callerPhone.trim(),
        caller_name: classifyName.trim() || callerCtx?.caller.display_name,
        caller_source: callerCtx?.caller.source || 'user_assigned',
      }),
    onSuccess: async () => {
      setCallerNotice('Bound caller identity to active conversation.');
      await refresh();
    },
    onError: (err: any) => setCallerNotice(err?.message ?? 'Bind caller failed'),
  });

  const presignDownloadMut = useMutation({
    mutationFn: () => voiceApi.presignDownload(activeConversation!.recording.recording_id),
    onSuccess: res => {
      setDownloadUrl(res.download_url);
      setCallerNotice(`Presigned S3 download ready (${res.s3_presigned_status}).`);
    },
    onError: (err: any) => setCallerNotice(err?.message ?? 'Presigned download failed'),
  });

  return (
    <Screen
      title="Voice Intelligence"
      subtitle="Capture, speaker IR, reasoning, memory & verifiable custody"
      badge="NEXORA VOICE · 10 WORKSTREAMS"
      rightAction={
        <TouchableOpacity onPress={() => setShowCapture(v => !v)} style={styles.capturePill}>
          <Text style={styles.capturePillText}>{showCapture ? 'Close' : '+ Capture'}</Text>
        </TouchableOpacity>
      }>
      {errorMsg ? (
        <Card style={{ borderColor: colors.statusDanger, marginBottom: spacing.m }}>
          <Text style={{ color: colors.statusDanger, fontFamily: fontFamily.medium, fontSize: 12.5 }}>{errorMsg}</Text>
        </Card>
      ) : null}

      <View style={styles.stack}>
        {showCapture && (
          <FadeIn index={0}>
            <Card variant="featured" style={{ gap: spacing.s, borderColor: moduleColors.voice }}>
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>WS1 · Capture / Import Recording</Text>
                <StatusPill
                  label={permissions.voiceMicCapture ? 'CONSENT OK' : 'CONSENT OFF'}
                  tone={permissions.voiceMicCapture ? 'success' : 'warning'}
                />
              </View>
              <Input value={title} onChangeText={setTitle} placeholder="Conversation title (e.g. Sprint Sync)" />
              <View style={styles.chipRow}>
                {SOURCE_TYPES.map(st => (
                  <Chip
                    key={st.key}
                    label={st.label}
                    active={sourceType === st.key}
                    color={moduleColors.voice}
                    onPress={() => setSourceType(st.key)}
                  />
                ))}
              </View>
              <Input
                value={transcript}
                onChangeText={setTranscript}
                placeholder="Speaker-tagged lines (e.g. Sahil: I will send the contract by Friday)"
                multiline
                style={{ minHeight: 86, textAlignVertical: 'top' }}
              />
              <View style={styles.pairRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.labelMuted}>Estimated SNR (dB)</Text>
                  <Input value={snrText} onChangeText={setSnrText} keyboardType="numeric" placeholder="22" />
                </View>
                <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                  <Chip
                    label={overlapSuspected ? 'Overlap: Yes' : 'Overlap: No'}
                    active={overlapSuspected}
                    color={colors.statusWarning}
                    onPress={() => setOverlapSuspected(v => !v)}
                  />
                </View>
              </View>
              {captureError ? <Text style={styles.errText}>{captureError}</Text> : null}
              <View style={styles.pairRow}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title="Process Through 10 Workstreams"
                    loading={captureMut.isPending}
                    onPress={handleCapture}
                  />
                </View>
                {!permissions.voiceMicCapture && (
                  <PrimaryButton
                    title="Grant Consent"
                    variant="secondary"
                    onPress={() => nav.navigate('PrivacyPermissions')}
                  />
                )}
              </View>
            </Card>
          </FadeIn>
        )}

        {loading && !overview ? (
          <Card style={{ gap: spacing.s }}>
            <Skeleton height={22} width="55%" />
            <Skeleton height={44} />
          </Card>
        ) : (
          <FadeIn index={0}>
            <Card variant="featured" style={{ gap: spacing.m }}>
              <View style={styles.rowBetween}>
                <View>
                  <Text style={styles.labelMuted}>PLATFORM STATUS · CONVERSATION IR</Text>
                  <Text style={[typography.display, { color: moduleColors.voice }]}>
                    {overview?.conversation_count ?? 0} Conversations
                  </Text>
                </View>
                <StatusPill label={sseConnected ? 'LIVE STREAM' : 'VERIFIED IR'} tone={sseConnected ? 'info' : 'success'} />
              </View>

              <View style={styles.gridRow}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricVal}>{overview?.utterance_count ?? 0}</Text>
                  <Text style={styles.metricLbl}>Utterances</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={[styles.metricVal, { color: colors.accentBright }]}>
                    {overview?.commitments_decisions ?? 0}
                  </Text>
                  <Text style={styles.metricLbl}>Decisions & Commits</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={[styles.metricVal, { color: colors.statusWarning }]}>
                    {overview?.pending_approvals ?? 0}
                  </Text>
                  <Text style={styles.metricLbl}>Pending Actions</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={[styles.metricVal, { color: moduleColors.voice }]}>
                    {Math.round(overview?.avg_audio_quality ?? 0)}/100
                  </Text>
                  <Text style={styles.metricLbl}>Avg Audio QC</Text>
                </View>
              </View>
            </Card>
          </FadeIn>
        )}

        {activeConversation && (
          <FadeIn index={1}>
            <SectionHeading title="Active Conversation IR" action="Transcript →" onActionPress={() => nav.navigate('VoiceTranscript')} />
            <Card style={{ gap: spacing.s }}>
              <View style={styles.rowBetween}>
                <Text style={[styles.cardTitle, { flex: 1 }]}>{activeConversation.title}</Text>
                <StatusPill
                  label={`${activeConversation.confidence_tier} (${Math.round(activeConversation.overall_confidence * 100)}%)`}
                  tone={activeConversation.confidence_tier === 'HIGH' ? 'success' : 'info'}
                />
              </View>
              <Text style={styles.bodyText}>{activeConversation.summary}</Text>
              <View style={styles.chipRow}>
                <Chip label={`Strategy: ${activeConversation.recording.quality_report.routing_strategy}`} active color={moduleColors.voice} />
                <Chip label={`SNR: ${activeConversation.recording.quality_report.snr_db} dB`} />
                <Chip label={`Lang: ${activeConversation.detected_languages.join(', ')}`} />
                {activeConversation.interaction_edges && activeConversation.interaction_edges.length > 0 ? (
                  <Chip label={`Who→Whom: ${activeConversation.interaction_edges.length} edges`} active color={colors.accentPrimary} />
                ) : null}
              </View>
            </Card>
          </FadeIn>
        )}

        <FadeIn index={2}>
          <SectionHeading title="Live Call & Background Stream" />
          <Card style={{ gap: spacing.s }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>WS1 · Background & Call Session</Text>
              <StatusPill
                label={
                  liveSession
                    ? liveSession.state === 'background'
                      ? 'BACKGROUND STREAMING'
                      : `LIVE · ${liveSession.chunk_count} CHUNKS`
                    : 'READY'
                }
                tone={liveSession?.state === 'background' ? 'warning' : liveSession ? 'success' : 'info'}
              />
            </View>
            <Text style={styles.bodyText}>
              Supports active foreground/background audio services (with visible OS indicator) or dual-track VoIP/meeting streams. Native OS blocks silent PSTN call tapping.
            </Text>
            {!liveSession ? (
              <>
                <Input value={sessionTitle} onChangeText={setSessionTitle} placeholder="Live call title (e.g. Vendor Renewal Call)" />
                <View style={styles.chipRow}>
                  {CAPTURE_MODES.map(m => (
                    <Chip
                      key={m.key}
                      label={m.label}
                      active={captureMode === m.key}
                      color={moduleColors.voice}
                      onPress={() => setCaptureMode(m.key)}
                    />
                  ))}
                </View>
                {sessionError ? <Text style={styles.errText}>{sessionError}</Text> : null}
                <PrimaryButton
                  title="Start Streaming Call Session"
                  loading={startSessionMut.isPending}
                  onPress={handleStartSession}
                />
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <Input
                      value={resumeSessionId}
                      onChangeText={setResumeSessionId}
                      placeholder="Session ID to resume"
                    />
                  </View>
                  <PrimaryButton
                    title="Resume"
                    variant="secondary"
                    loading={resumeSessionMut.isPending}
                    onPress={() => resumeSessionId.trim() && resumeSessionMut.mutate(resumeSessionId.trim())}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.metaText}>
                  Session {liveSession.session_id.slice(0, 8)} · Mode: {liveSession.capture_mode} · {liveSession.chunk_count} chunks
                </Text>
                {liveSession.os_capture_guidance ? (
                  <Text style={styles.metaText}>{liveSession.os_capture_guidance}</Text>
                ) : null}
                <View style={styles.chipRow}>
                  {CHANNEL_HINTS.map(ch => (
                    <Chip
                      key={ch.key}
                      label={ch.label}
                      active={channelHint === ch.key}
                      color={moduleColors.voice}
                      onPress={() => setChannelHint(ch.key)}
                    />
                  ))}
                </View>
                <Input
                  value={chunkText}
                  onChangeText={setChunkText}
                  placeholder="Optional live chunk text (or leave blank to simulate acoustic turn)"
                />
                {sessionError ? <Text style={styles.errText}>{sessionError}</Text> : null}
                <View style={styles.pairRow}>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      title={`Send Chunk #${liveSession.chunk_count + 1}`}
                      loading={streamChunkMut.isPending}
                      onPress={() => streamChunkMut.mutate()}
                    />
                  </View>
                  <PrimaryButton
                    title={liveSession.state === 'background' ? 'Resume FG' : 'Go Background'}
                    variant="secondary"
                    loading={toggleBgMut.isPending}
                    onPress={() => toggleBgMut.mutate()}
                  />
                </View>
                <PrimaryButton
                  title="Finalize Call & Seal Evidence (WS9)"
                  variant="secondary"
                  loading={finalizeSessionMut.isPending}
                  onPress={() => finalizeSessionMut.mutate()}
                />
              </>
            )}
          </Card>
        </FadeIn>

        <FadeIn index={3}>
          <SectionHeading title="Free Native Caller Intelligence & S3 Vault" />
          <Card style={{ gap: spacing.s }}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Caller ID (₹0 Native OS) & Presigned S3</Text>
              <StatusPill label={nativeCaps.platform.toUpperCase()} tone="info" />
            </View>
            <Text style={styles.bodyText}>{nativeCaps.summary}</Text>
            <Input
              value={callerPhone}
              onChangeText={setCallerPhone}
              placeholder="Phone number (e.g. +919876504210)"
              keyboardType="phone-pad"
            />
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Check Caller Context"
                  loading={resolveCallerMut.isPending}
                  onPress={() => callerPhone.trim() && resolveCallerMut.mutate()}
                />
              </View>
              <PrimaryButton
                title="Sync OS Dir"
                variant="secondary"
                loading={syncOsDirMut.isPending}
                onPress={() => syncOsDirMut.mutate()}
              />
            </View>
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Presign S3 Recording"
                  variant="secondary"
                  loading={presignUploadMut.isPending}
                  onPress={() => presignUploadMut.mutate()}
                />
              </View>
              <PrimaryButton
                title="Timeline"
                variant="secondary"
                loading={timelineMut.isPending}
                onPress={() => callerPhone.trim() && timelineMut.mutate()}
              />
            </View>
            {activeConversation && (
              <View style={styles.pairRow}>
                <View style={{ flex: 1 }}>
                  <PrimaryButton
                    title="Bind Caller to Active"
                    variant="secondary"
                    loading={bindCallerMut.isPending}
                    onPress={() => (callerPhone.trim() || classifyName.trim()) && bindCallerMut.mutate()}
                  />
                </View>
                {activeConversation.recording?.recording_id ? (
                  <PrimaryButton
                    title="Presign Download"
                    variant="secondary"
                    loading={presignDownloadMut.isPending}
                    onPress={() => presignDownloadMut.mutate()}
                  />
                ) : null}
              </View>
            )}
            {downloadUrl ? (
              <Text style={styles.metaText} numberOfLines={2}>
                Download URL: {downloadUrl}
              </Text>
            ) : null}

            {callerCtx && (
              <Card variant="subtle" style={{ gap: 6 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardTitle}>
                    {callerCtx.caller.display_name || callerCtx.caller.phone_masked}
                  </Text>
                  <StatusPill
                    label={callerCtx.caller.spam_risk === 'high' ? 'SPAM HIGH' : (callerCtx.caller.relationship_label || 'UNKNOWN').toUpperCase()}
                    tone={callerCtx.caller.spam_risk === 'high' ? 'danger' : callerCtx.caller.identity_conflict ? 'warning' : 'success'}
                  />
                </View>
                <Text style={styles.metaText}>
                  Source: {callerCtx.caller.source} · Calls: {callerCtx.caller.call_count} · Past Linked: {callerCtx.timeline.length}
                  {callerCtx.caller.business_category ? ` · ${callerCtx.caller.business_category}` : ''}
                </Text>
                {callerCtx.caller.identity_conflict ? (
                  <Text style={styles.errText}>
                    Identity conflict: {callerCtx.caller.observed_identities?.map(o => `${o.source}: ${o.name}`).join(' vs ')}
                  </Text>
                ) : null}
                {callerCtx.caller.needs_classification && (
                  <View style={{ gap: spacing.xs, marginTop: 4 }}>
                    <Input value={classifyName} onChangeText={setClassifyName} placeholder="Who called? (Name / Business)" />
                    <Input value={classifyOrg} onChangeText={setClassifyOrg} placeholder="Organization / Purpose (optional)" />
                    <View style={styles.pairRow}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton
                          title="Save Classification"
                          loading={classifyCallerMut.isPending}
                          onPress={() => classifyCallerMut.mutate()}
                        />
                      </View>
                      <PrimaryButton
                        title="Report Spam"
                        variant="secondary"
                        loading={spamReportMut.isPending}
                        onPress={() => spamReportMut.mutate()}
                      />
                    </View>
                  </View>
                )}
              </Card>
            )}
            {callerNotice ? <Text style={styles.metaText}>{callerNotice}</Text> : null}
          </Card>
        </FadeIn>

        <FadeIn index={4}>
          <SectionHeading
            title="Historic Call Logs & Insights"
            action="Refresh Insights"
            onActionPress={() => {
              void callLogsQuery.refetch();
            }}
          />
          <Card style={{ gap: spacing.s }}>
            <Text style={styles.bodyText}>
              Dynamically import device call history (Android CallLog / CSV / JSON) into voice.call_logs — zero manual
              seed rows — to generate follow-up alerts and caller patterns.
            </Text>
            <Input
              value={callLogsInput}
              onChangeText={setCallLogsInput}
              placeholder="Paste CSV (phone_number,contact_name,direction,duration_sec,started_at) or JSON logs"
              multiline
            />
            <View style={styles.pairRow}>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  title="Import & Analyze Logs"
                  loading={importCallLogsMut.isPending}
                  onPress={() => importCallLogsMut.mutate('text')}
                />
              </View>
              <PrimaryButton
                title="Sync Device CallLog"
                variant="secondary"
                loading={importCallLogsMut.isPending}
                onPress={() => importCallLogsMut.mutate('device')}
              />
            </View>
            {(!permissions.deviceCallLogsRead || !permissions.deviceCallScreening) && (
              <View style={styles.pairRow}>
                {!permissions.deviceCallLogsRead && (
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      title="Grant CallLog Access"
                      variant="secondary"
                      onPress={() => void requestOsCallLogs()}
                    />
                  </View>
                )}
                {!permissions.deviceCallScreening && (
                  <View style={{ flex: 1 }}>
                    <PrimaryButton
                      title="Enable Caller Screening"
                      variant="secondary"
                      onPress={() => void requestOsCallScreening()}
                    />
                  </View>
                )}
                <PrimaryButton
                  title="Privacy"
                  variant="secondary"
                  onPress={() => nav.navigate('PrivacyPermissions')}
                />
              </View>
            )}
            {callLogsNotice ? <Text style={styles.metaText}>{callLogsNotice}</Text> : null}

            {callLogsQuery.data?.insights && callLogsQuery.data.insights.total_calls > 0 ? (
              <View style={{ gap: spacing.s }}>
                <View style={styles.gridRow}>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricVal}>{callLogsQuery.data.insights.total_calls}</Text>
                    <Text style={styles.metricLbl}>Total Calls</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={[styles.metricVal, { color: colors.statusWarning }]}>
                      {callLogsQuery.data.insights.missed_count}
                    </Text>
                    <Text style={styles.metricLbl}>Missed</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricVal}>
                      {Math.round(callLogsQuery.data.insights.total_talk_duration_sec / 60)}m
                    </Text>
                    <Text style={styles.metricLbl}>Talk Time</Text>
                  </View>
                  <View style={styles.metricBox}>
                    <Text style={styles.metricVal}>{callLogsQuery.data.insights.unknown_numbers}</Text>
                    <Text style={styles.metricLbl}>Unknowns</Text>
                  </View>
                </View>

                {callLogsQuery.data.insights.follow_up_alerts.length > 0 && (
                  <View style={{ gap: 4 }}>
                    <Text style={styles.labelMuted}>DYNAMIC FOLLOW-UP INSIGHTS</Text>
                    {callLogsQuery.data.insights.follow_up_alerts.slice(0, 4).map((al, i) => (
                      <Card key={`${al.alert_type}-${al.phone_hash}-${i}`} variant="subtle" style={{ gap: 2 }}>
                        <Text style={styles.cardTitle}>{al.title}</Text>
                        <Text style={styles.metaText}>{al.recommendation}</Text>
                      </Card>
                    ))}
                  </View>
                )}

                <View style={{ gap: 4 }}>
                  <Text style={styles.labelMuted}>LOADED HISTORIC CALL LOGS TABLE ({callLogsQuery.data.count})</Text>
                  {(callLogsQuery.data.logs ?? []).slice(0, 8).map(row => (
                    <View key={row.id} style={styles.rowBetween}>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {row.contact_name || row.phone_masked} · {row.direction.toUpperCase()} · {row.duration_sec}s
                      </Text>
                      <StatusPill
                        label={row.spam_risk === 'high' ? 'SPAM' : row.source}
                        tone={row.spam_risk === 'high' ? 'danger' : 'info'}
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.metaText}>No call logs loaded yet. Sync device CallLog or paste CSV/JSON above.</Text>
            )}
          </Card>
        </FadeIn>

        <SectionHeading
          title="Captured Conversations"
          action="Refresh List"
          onActionPress={() => {
            void fetchConversations().then(() => refresh());
          }}
        />
        {conversations.map((c, idx) => {
          const isSelected = c.conversation_id === activeConversation?.conversation_id;
          return (
            <FadeIn key={c.conversation_id} index={idx + 2}>
              <Tappable onPress={() => setActiveConversationId(c.conversation_id)}>
                <Card variant={isSelected ? 'featured' : 'default'} style={{ gap: 6 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{c.title}</Text>
                    <StatusPill
                      label={isSelected ? 'ACTIVE' : c.recording.source_type.toUpperCase()}
                      tone={isSelected ? 'success' : 'info'}
                    />
                  </View>
                  <Text style={styles.bodyText} numberOfLines={2}>
                    {c.summary}
                  </Text>
                  <Text style={styles.metaText}>
                    {c.participants.length} speakers · {c.utterances.length} utterances · {c.reasoning_results.length} reasoning findings
                  </Text>
                </Card>
              </Tappable>
            </FadeIn>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.m },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.s },
  pairRow: { flexDirection: 'row', gap: spacing.s, alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  capturePill: {
    backgroundColor: 'rgba(167, 139, 250, 0.18)',
    borderColor: 'rgba(167, 139, 250, 0.45)',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  capturePillText: { color: moduleColors.voice, fontFamily: fontFamily.medium, fontSize: 12, fontWeight: '700' },
  cardTitle: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 14.5, fontWeight: '700' },
  bodyText: { color: colors.textSecondary, fontFamily: fontFamily.sans, fontSize: 12.5, lineHeight: 18 },
  metaText: { color: colors.textMuted, fontFamily: fontFamily.mono, fontSize: 11 },
  labelMuted: { color: colors.textMuted, fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.4 },
  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  metricBox: {
    width: '48%',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.card,
    padding: spacing.s,
    gap: 2,
  },
  metricVal: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 16, fontWeight: '700' },
  metricLbl: { color: colors.textMuted, fontFamily: fontFamily.sans, fontSize: 11 },
  errText: { color: colors.statusDanger, fontFamily: fontFamily.medium, fontSize: 12 },
});
