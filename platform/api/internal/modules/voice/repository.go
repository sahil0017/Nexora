package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexora/platform/api/internal/platform/events"
)

var (
	ErrNotFound = errors.New("voice record not found")
	ErrConflict = errors.New("invalid voice state transition")
)

// Repository persists Conversation IR objects across all 10 workstreams and outbox events.
type Repository interface {
	ListConversations(ctx context.Context, userID string) ([]ConversationIR, error)
	GetConversation(ctx context.Context, userID, conversationID string) (ConversationIR, error)
	SaveConversationIR(ctx context.Context, ir ConversationIR, vault *VoiceVault, actionEvent string) (ConversationIR, error)
	AddCorrection(ctx context.Context, userID, conversationID string, req CorrectionRequest, vault *VoiceVault) (HumanCorrectionIR, error)
	DecideAction(ctx context.Context, userID, actionID, decision string, vault *VoiceVault) (ActionSuggestionIR, error)
	ToggleLegalHold(ctx context.Context, userID, conversationID string, hold bool, reason string, vault *VoiceVault) (EvidenceRecord, error)
	IncrementExportCount(ctx context.Context, userID, conversationID string, vault *VoiceVault) (EvidenceRecord, error)
	SearchUtterances(ctx context.Context, userID, query string) ([]map[string]any, error)
	UpsertCallerDirectory(ctx context.Context, entry CallerDirectoryEntry) error
	LookupCallerDirectory(ctx context.Context, userID, phoneHash string) (CallerDirectoryEntry, bool)
	ListCallerDirectory(ctx context.Context, userID string) ([]CallerDirectoryEntry, error)
	GetCallerTimeline(ctx context.Context, userID, phoneHash string) ([]CallerTimelineItem, error)
	GetConversationByRecordingID(ctx context.Context, userID, recordingID string) (ConversationIR, error)
	BindCallerIdentity(ctx context.Context, userID, conversationID, speakerLabel string, caller CallerDirectoryEntry, callDirection string, vault *VoiceVault) (ConversationIR, error)
	SaveCaptureSession(ctx context.Context, sess *CaptureSession) error
	GetCaptureSession(ctx context.Context, sessionID string) (*CaptureSession, bool)
	BulkUpsertCallLogs(ctx context.Context, userID string, entries []CallLogEntry) (int, error)
	ListCallLogs(ctx context.Context, userID string, limit int) ([]CallLogEntry, error)
}

// MemoryRepository provides dynamic thread-safe in-memory storage (no manual seed records).
type MemoryRepository struct {
	mu        sync.RWMutex
	convs     map[string]map[string]ConversationIR       // userID -> convID -> IR
	directory map[string]map[string]CallerDirectoryEntry // userID -> phoneHash -> entry
	sessions  map[string]*CaptureSession                 // sessionID -> session
	callLogs  map[string][]CallLogEntry                  // userID -> historic call logs
}

// NewMemoryRepository initializes an in-memory Voice Intelligence repository.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		convs:     make(map[string]map[string]ConversationIR),
		directory: make(map[string]map[string]CallerDirectoryEntry),
		sessions:  make(map[string]*CaptureSession),
		callLogs:  make(map[string][]CallLogEntry),
	}
}

func (m *MemoryRepository) ensureSeededLocked(userID string, _ *VoiceVault) {
	if _, ok := m.convs[userID]; !ok {
		m.convs[userID] = make(map[string]ConversationIR)
	}
}

func attachSealedEvidence(ir ConversationIR, vault *VoiceVault, action string) ConversationIR {
	if vault == nil {
		vault = NewVoiceVault("")
	}
	ir.Recording.Integrity.HMACSeal = vault.SealRecording(ir.UserID, ir.Recording.RecordingID, ir.Recording.Integrity.SHA256Original)
	merkle := ComputeUtteranceMerkleRoot(ir.Utterances)
	evID := uuid.NewSHA1(uuid.NameSpaceDNS, []byte("evidence:"+ir.ConversationID)).String()
	nowStr := time.Now().UTC().Format(time.RFC3339Nano)

	var custody []CustodyEvent
	prevHash := "GENESIS"
	if ir.Evidence != nil && len(ir.Evidence.CustodyEvents) > 0 {
		custody = append(custody, ir.Evidence.CustodyEvents...)
		prevHash = custody[len(custody)-1].EventHash
		evID = ir.Evidence.EvidenceID
	}
	evHash := vault.ComputeCustodyHash(evID, ir.ConversationID, ir.UserID, action, prevHash, nowStr)
	custody = append(custody, CustodyEvent{
		ID:             uuid.NewString(),
		EvidenceID:     evID,
		ConversationID: ir.ConversationID,
		ActorID:        ir.UserID,
		EventAction:    action,
		PrevHash:       prevHash,
		EventHash:      evHash,
		OccurredAt:     nowStr,
	})
	exportCount := 0
	if ir.Evidence != nil {
		exportCount = ir.Evidence.ExportCount
	}
	ir.Evidence = &EvidenceRecord{
		EvidenceID:     evID,
		ConversationID: ir.ConversationID,
		RecordingID:    ir.Recording.RecordingID,
		MerkleRoot:     merkle,
		ChainHeadHash:  evHash,
		ChainValid:     vault.VerifyCustodyChain(custody),
		ExportCount:    exportCount,
		LastVerifiedAt: nowStr,
		CustodyEvents:  custody,
	}
	return ir
}

func (m *MemoryRepository) ListConversations(_ context.Context, userID string) ([]ConversationIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, nil)

	out := make([]ConversationIR, 0, len(m.convs[userID]))
	for _, c := range m.convs[userID] {
		out = append(out, c)
	}
	slices.SortFunc(out, func(a, b ConversationIR) int {
		if a.CreatedAt.After(b.CreatedAt) {
			return -1
		}
		if a.CreatedAt.Before(b.CreatedAt) {
			return 1
		}
		return 0
	})
	return out, nil
}

func (m *MemoryRepository) GetConversation(_ context.Context, userID, conversationID string) (ConversationIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, nil)

	c, ok := m.convs[userID][conversationID]
	if !ok {
		return ConversationIR{}, ErrNotFound
	}
	return c, nil
}

func (m *MemoryRepository) SaveConversationIR(_ context.Context, ir ConversationIR, vault *VoiceVault, actionEvent string) (ConversationIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(ir.UserID, vault)

	now := time.Now().UTC()
	if ir.CreatedAt.IsZero() {
		ir.CreatedAt = now
	}
	ir.UpdatedAt = now
	sealed := attachSealedEvidence(ir, vault, actionEvent)
	m.convs[ir.UserID][sealed.ConversationID] = sealed
	return sealed, nil
}

func (m *MemoryRepository) AddCorrection(_ context.Context, userID, conversationID string, req CorrectionRequest, vault *VoiceVault) (HumanCorrectionIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, vault)

	c, ok := m.convs[userID][conversationID]
	if !ok {
		return HumanCorrectionIR{}, ErrNotFound
	}
	origVal := ""
	switch req.TargetType {
	case "utterance_text":
		for _, u := range c.Utterances {
			if u.UtteranceID == req.TargetID {
				origVal = u.OriginalText
				break
			}
		}
	case "speaker_attribution":
		for _, u := range c.Utterances {
			if u.UtteranceID == req.TargetID {
				origVal = u.SpeakerLabel
				break
			}
		}
	case "conversation_event":
		for _, ev := range c.ConversationEvents {
			if ev.EventID == req.TargetID {
				origVal = ev.Summary
				break
			}
		}
	}
	if origVal == "" {
		origVal = "(unverified original value)"
	}

	corr := HumanCorrectionIR{
		CorrectionID:   uuid.NewString(),
		TargetType:     req.TargetType,
		TargetID:       req.TargetID,
		OriginalValue:  origVal,
		CorrectedValue: req.CorrectedValue,
		Reason:         req.Reason,
		CorrectedBy:    userID,
		CreatedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	}
	c.HumanCorrections = append(c.HumanCorrections, corr)
	c.Status = "verified"
	c.UpdatedAt = time.Now().UTC()
	c = attachSealedEvidence(c, vault, "corrected")
	m.convs[userID][conversationID] = c
	return corr, nil
}

func (m *MemoryRepository) DecideAction(_ context.Context, userID, actionID, decision string, vault *VoiceVault) (ActionSuggestionIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, vault)

	for cid, c := range m.convs[userID] {
		for i, a := range c.ActionSuggestions {
			if a.ActionID == actionID {
				c.ActionSuggestions[i].Status = decision
				c.ActionSuggestions[i].DecidedAt = time.Now().UTC().Format(time.RFC3339Nano)
				c = attachSealedEvidence(c, vault, "approved")
				m.convs[userID][cid] = c
				return c.ActionSuggestions[i], nil
			}
		}
	}
	return ActionSuggestionIR{}, ErrNotFound
}

func (m *MemoryRepository) ToggleLegalHold(_ context.Context, userID, conversationID string, hold bool, _ string, vault *VoiceVault) (EvidenceRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, vault)

	c, ok := m.convs[userID][conversationID]
	if !ok {
		return EvidenceRecord{}, ErrNotFound
	}
	c.Recording.Integrity.LegalHold = hold
	act := "legal_hold_released"
	if hold {
		act = "legal_hold_enabled"
	}
	c = attachSealedEvidence(c, vault, act)
	m.convs[userID][conversationID] = c
	return *c.Evidence, nil
}

func (m *MemoryRepository) IncrementExportCount(_ context.Context, userID, conversationID string, vault *VoiceVault) (EvidenceRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, vault)

	c, ok := m.convs[userID][conversationID]
	if !ok {
		return EvidenceRecord{}, ErrNotFound
	}
	if c.Evidence != nil {
		c.Evidence.ExportCount++
	}
	c = attachSealedEvidence(c, vault, "exported")
	m.convs[userID][conversationID] = c
	return *c.Evidence, nil
}

func (m *MemoryRepository) SearchUtterances(_ context.Context, userID, query string) ([]map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, nil)

	q := strings.ToLower(strings.TrimSpace(query))
	var results []map[string]any
	for _, c := range m.convs[userID] {
		for _, u := range c.Utterances {
			if q == "" || strings.Contains(strings.ToLower(u.OriginalText), q) || strings.Contains(strings.ToLower(c.Title), q) {
				results = append(results, map[string]any{
					"conversation_id":    c.ConversationID,
					"conversation_title": c.Title,
					"utterance_id":       u.UtteranceID,
					"speaker_label":      u.SpeakerLabel,
					"start_ms":           u.StartMS,
					"end_ms":             u.EndMS,
					"text":               u.OriginalText,
					"score":              1.0,
				})
			}
		}
	}
	return results, nil
}

func (m *MemoryRepository) UpsertCallerDirectory(_ context.Context, entry CallerDirectoryEntry) error {
	if entry.UserID == "" || entry.PhoneHash == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.directory[entry.UserID] == nil {
		m.directory[entry.UserID] = make(map[string]CallerDirectoryEntry)
	}
	if entry.UpdatedAt.IsZero() {
		entry.UpdatedAt = time.Now().UTC()
	}
	m.directory[entry.UserID][entry.PhoneHash] = entry
	return nil
}

func (m *MemoryRepository) LookupCallerDirectory(_ context.Context, userID, phoneHash string) (CallerDirectoryEntry, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.directory[userID] == nil {
		return CallerDirectoryEntry{}, false
	}
	entry, ok := m.directory[userID][phoneHash]
	return entry, ok
}

func (m *MemoryRepository) ListCallerDirectory(_ context.Context, userID string) ([]CallerDirectoryEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]CallerDirectoryEntry, 0, len(m.directory[userID]))
	for _, entry := range m.directory[userID] {
		out = append(out, entry)
	}
	slices.SortFunc(out, func(a, b CallerDirectoryEntry) int {
		return b.UpdatedAt.Compare(a.UpdatedAt)
	})
	return out, nil
}

func (m *MemoryRepository) GetCallerTimeline(_ context.Context, userID, phoneHash string) ([]CallerTimelineItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, nil)
	var items []CallerTimelineItem
	for _, c := range m.convs[userID] {
		if phoneHash != "" && c.Recording.CallerPhoneHash == phoneHash {
			items = append(items, CallerTimelineItem{
				ConversationID:    c.ConversationID,
				RecordingID:       c.Recording.RecordingID,
				Title:             c.Title,
				Summary:           c.Summary,
				CallDirection:     c.Recording.CallDirection,
				StorageURI:        c.Recording.StorageURI,
				S3PresignedStatus: c.Recording.S3PresignedStatus,
				DurationMS:        c.Recording.DurationMS,
				CreatedAt:         c.CreatedAt.UTC().Format(time.RFC3339Nano),
			})
		}
	}
	slices.SortFunc(items, func(a, b CallerTimelineItem) int {
		return strings.Compare(b.CreatedAt, a.CreatedAt)
	})
	return items, nil
}

func (m *MemoryRepository) GetConversationByRecordingID(_ context.Context, userID, recordingID string) (ConversationIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, nil)
	for _, c := range m.convs[userID] {
		if c.Recording.RecordingID == recordingID {
			return c, nil
		}
	}
	return ConversationIR{}, ErrNotFound
}

func (m *MemoryRepository) BindCallerIdentity(ctx context.Context, userID, conversationID, speakerLabel string, caller CallerDirectoryEntry, callDirection string, vault *VoiceVault) (ConversationIR, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ensureSeededLocked(userID, vault)
	c, ok := m.convs[userID][conversationID]
	if !ok {
		return ConversationIR{}, ErrNotFound
	}
	c = applyCallerToConversation(c, speakerLabel, caller, callDirection)
	c = attachSealedEvidence(c, vault, "caller_identified")
	m.convs[userID][conversationID] = c
	if caller.PhoneHash != "" && caller.DisplayName != "" {
		if m.directory[userID] == nil {
			m.directory[userID] = make(map[string]CallerDirectoryEntry)
		}
		caller.UserID = userID
		caller.UpdatedAt = time.Now().UTC()
		m.directory[userID][caller.PhoneHash] = caller
	}
	return c, nil
}

func applyCallerToConversation(c ConversationIR, speakerLabel string, caller CallerDirectoryEntry, callDirection string) ConversationIR {
	if caller.DisplayName != "" {
		c.Recording.CallerName = caller.DisplayName
	}
	if caller.PhoneMasked != "" {
		c.Recording.CallerPhoneMasked = caller.PhoneMasked
	}
	if caller.PhoneHash != "" {
		c.Recording.CallerPhoneHash = caller.PhoneHash
	}
	if caller.Source != "" {
		c.Recording.CallerSource = caller.Source
	}
	if caller.Confidence > 0 {
		c.Recording.CallerConfidence = caller.Confidence
	}
	if callDirection != "" {
		c.Recording.CallDirection = callDirection
	}

	target := strings.TrimSpace(speakerLabel)
	for i := range c.Participants {
		p := &c.Participants[i]
		match := (target != "" && p.SpeakerLabel == target) ||
			(target == "" && (strings.HasPrefix(p.DisplayName, "Remote Caller") || (!strings.HasPrefix(p.DisplayName, "User") && len(c.Participants) > 1 && i > 0))) ||
			(target == "" && len(c.Participants) == 1 && !strings.HasPrefix(p.DisplayName, "User"))
		if match && caller.DisplayName != "" {
			p.DisplayName = caller.DisplayName
			p.Role = "caller"
			p.IsVerified = caller.Confidence >= 0.85
			break
		}
	}
	c.InteractionEdges = ResolveGoInteractionDynamics(c.Utterances, c.Participants)
	c.UpdatedAt = time.Now().UTC()
	return c
}

func (m *MemoryRepository) SaveCaptureSession(_ context.Context, sess *CaptureSession) error {
	if sess == nil || sess.SessionID == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *sess
	cp.ProcessedSeqs = append([]int{}, sess.ProcessedSeqs...)
	m.sessions[sess.SessionID] = &cp
	return nil
}

func (m *MemoryRepository) GetCaptureSession(_ context.Context, sessionID string) (*CaptureSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	s, ok := m.sessions[sessionID]
	if !ok {
		return nil, false
	}
	cp := *s
	cp.ProcessedSeqs = append([]int{}, s.ProcessedSeqs...)
	return &cp, true
}

// PostgresRepository persists Voice Intelligence Conversation IR tables in PostgreSQL.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresRepository creates a PostgreSQL-backed Voice Intelligence repository.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) ListConversations(ctx context.Context, userID string) ([]ConversationIR, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT id::text FROM voice.conversations
		 WHERE user_id = $1::uuid AND deleted_at IS NULL
		 ORDER BY created_at DESC LIMIT 50`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return []ConversationIR{}, nil
	}
	return p.loadConversationsBatch(ctx, userID, ids)
}

func (p *PostgresRepository) GetConversation(ctx context.Context, userID, conversationID string) (ConversationIR, error) {
	list, err := p.loadConversationsBatch(ctx, userID, []string{conversationID})
	if err != nil {
		return ConversationIR{}, err
	}
	if len(list) == 0 {
		return ConversationIR{}, ErrNotFound
	}
	return list[0], nil
}

// loadConversationsBatch fetches conversations and all child Voice Intelligence tables
// in a constant number of ANY($1::uuid[]) queries, eliminating N+1 query cascades.
func (p *PostgresRepository) loadConversationsBatch(ctx context.Context, userID string, ids []string) ([]ConversationIR, error) {
	cRows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, title, summary, status, primary_language, detected_languages,
		        topics, overall_confidence, confidence_tier, created_at, updated_at
		 FROM voice.conversations
		 WHERE id = ANY($1::uuid[]) AND user_id = $2::uuid AND deleted_at IS NULL
		 ORDER BY created_at DESC`,
		ids, userID,
	)
	if err != nil {
		return nil, err
	}
	defer cRows.Close()

	byID := make(map[string]*ConversationIR, len(ids))
	ordered := make([]string, 0, len(ids))
	for cRows.Next() {
		var ir ConversationIR
		if cRows.Scan(&ir.ConversationID, &ir.UserID, &ir.Title, &ir.Summary, &ir.Status, &ir.PrimaryLanguage,
			&ir.DetectedLanguages, &ir.Topics, &ir.OverallConfidence, &ir.ConfidenceTier, &ir.CreatedAt, &ir.UpdatedAt) == nil {
			byID[ir.ConversationID] = &ir
			ordered = append(ordered, ir.ConversationID)
		}
	}
	cRows.Close()
	if len(ordered) == 0 {
		return nil, nil
	}

	// 1. Recordings
	if rRows, rErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, source_type, mime_type, sample_rate_hz, channels, duration_ms, byte_size,
		        storage_uri, COALESCE(s3_bucket,''), COALESCE(s3_object_key,''), COALESCE(s3_presigned_status,'pending'),
		        COALESCE(s3_etag,''), uploaded_at, COALESCE(caller_name,''), COALESCE(caller_phone_masked,''),
		        COALESCE(caller_phone_hash,''), COALESCE(caller_source,'unknown'), COALESCE(caller_confidence,0),
		        COALESCE(call_direction,'unknown'), audio_metadata, encryption_key_version, quality_score, snr_db, clipping_ratio,
		        speech_ratio, noise_floor_dbfs, routing_strategy, vad_segments, consent_granted,
		        consent_scope, sha256_original, hmac_seal, legal_hold
		 FROM voice.recordings WHERE conversation_id = ANY($1::uuid[])`, ordered); rErr == nil {
		for rRows.Next() {
			var cid string
			var amRaw, vadRaw []byte
			var uploadedAt *time.Time
			var rec RecordingIR
			if rRows.Scan(
				&cid, &rec.RecordingID, &rec.SourceType, &rec.MimeType,
				&rec.SampleRateHz, &rec.Channels, &rec.DurationMS,
				&rec.ByteSize, &rec.StorageURI,
				&rec.S3Bucket, &rec.S3ObjectKey, &rec.S3PresignedStatus,
				&rec.S3ETag, &uploadedAt,
				&rec.CallerName, &rec.CallerPhoneMasked, &rec.CallerPhoneHash,
				&rec.CallerSource, &rec.CallerConfidence, &rec.CallDirection,
				&amRaw, &rec.Integrity.EncryptionKeyVersion,
				&rec.QualityReport.QualityScore, &rec.QualityReport.SNRDB,
				&rec.QualityReport.ClippingRatio, &rec.QualityReport.SpeechRatio,
				&rec.QualityReport.NoiseFloorDBFS, &rec.QualityReport.RoutingStrategy,
				&vadRaw, &rec.Integrity.ConsentGranted, &rec.Integrity.ConsentScope,
				&rec.Integrity.SHA256Original, &rec.Integrity.HMACSeal, &rec.Integrity.LegalHold,
			) == nil {
				if uploadedAt != nil {
					rec.UploadedAt = uploadedAt.UTC().Format(time.RFC3339Nano)
				}
				_ = json.Unmarshal(amRaw, &rec.AudioMetadata)
				_ = json.Unmarshal(vadRaw, &rec.QualityReport.VadSegments)
				if c := byID[cid]; c != nil {
					c.Recording = rec
				}
			}
		}
		rRows.Close()
	}

	// 2. Participants
	if pRows, pErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, speaker_label, display_name, role, COALESCE(voiceprint_ref,''), is_verified, talk_time_ms, utterance_count
		 FROM voice.participants WHERE conversation_id = ANY($1::uuid[]) ORDER BY speaker_label ASC`, ordered); pErr == nil {
		for pRows.Next() {
			var cid string
			var part ParticipantIR
			if pRows.Scan(&cid, &part.ParticipantID, &part.SpeakerLabel, &part.DisplayName, &part.Role, &part.VoiceprintRef, &part.IsVerified, &part.TalkTimeMS, &part.UtteranceCount) == nil {
				if c := byID[cid]; c != nil {
					c.Participants = append(c.Participants, part)
				}
			}
		}
		pRows.Close()
	}

	// 3. Utterances
	if uRows, uErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, recording_id::text, speaker_label, seq_index, start_ms, end_ms,
		        original_text, word_timestamps, language, confidence, COALESCE(uncertainty_reason,''),
		        overlap_detected, COALESCE(audio_segment_ref,''), to_speakers, addressing_mode,
		        COALESCE(addressed_utterance_id::text,''), what_is_spoken
		 FROM voice.utterances WHERE conversation_id = ANY($1::uuid[]) ORDER BY seq_index ASC`, ordered); uErr == nil {
		for uRows.Next() {
			var cid string
			var u UtteranceIR
			var wts []byte
			if uRows.Scan(&cid, &u.UtteranceID, &u.RecordingID, &u.SpeakerLabel, &u.SeqIndex, &u.StartMS, &u.EndMS, &u.OriginalText, &wts, &u.Language, &u.Confidence, &u.UncertaintyReason, &u.OverlapDetected, &u.AudioSegmentRef, &u.ToSpeakers, &u.AddressingMode, &u.AddressedUtteranceID, &u.WhatIsSpoken) == nil {
				_ = json.Unmarshal(wts, &u.WordTimestamps)
				if c := byID[cid]; c != nil {
					c.Utterances = append(c.Utterances, u)
				}
			}
		}
		uRows.Close()
	}

	// 4. Conversation Events
	if eRows, eErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, event_type, summary, actor_speaker, topic, dialogue_act, intent, due_at, confidence, source_utterance_ids::text[], status
		 FROM voice.conversation_events WHERE conversation_id = ANY($1::uuid[])`, ordered); eErr == nil {
		for eRows.Next() {
			var cid string
			var ev ConversationEventIR
			var dueAt *time.Time
			if eRows.Scan(&cid, &ev.EventID, &ev.EventType, &ev.Summary, &ev.ActorSpeaker, &ev.Topic, &ev.DialogueAct, &ev.Intent, &dueAt, &ev.Confidence, &ev.SourceUtteranceIDs, &ev.Status) == nil {
				if dueAt != nil {
					ev.DueAt = dueAt.UTC().Format(time.RFC3339Nano)
				}
				if c := byID[cid]; c != nil {
					c.ConversationEvents = append(c.ConversationEvents, ev)
				}
			}
		}
		eRows.Close()
	}

	// 5. Reasoning Findings
	if fRows, fErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, finding_type, severity, title, explanation, evidence_utterance_ids::text[], confidence
		 FROM voice.reasoning_findings WHERE conversation_id = ANY($1::uuid[])`, ordered); fErr == nil {
		for fRows.Next() {
			var cid string
			var f ReasoningResultIR
			if fRows.Scan(&cid, &f.FindingID, &f.FindingType, &f.Severity, &f.Title, &f.Explanation, &f.EvidenceUtteranceIDs, &f.Confidence) == nil {
				if c := byID[cid]; c != nil {
					c.ReasoningResults = append(c.ReasoningResults, f)
				}
			}
		}
		fRows.Close()
	}

	// 6. Knowledge Entities & Edges (Workstream 6)
	entNameByID := map[string]string{}
	if keRows, keErr := p.pool.Query(ctx,
		`SELECT COALESCE(conversation_id::text,''), id::text, canonical_name, entity_type, aliases, attributes, embedding
		 FROM voice.knowledge_entities WHERE conversation_id = ANY($1::uuid[])`, ordered); keErr == nil {
		for keRows.Next() {
			var cid string
			var ent KnowledgeEntityIR
			var attrRaw []byte
			if keRows.Scan(&cid, &ent.EntityID, &ent.CanonicalName, &ent.EntityType, &ent.Aliases, &attrRaw, &ent.Embedding) == nil {
				_ = json.Unmarshal(attrRaw, &ent.Attributes)
				entNameByID[ent.EntityID] = ent.CanonicalName
				if c := byID[cid]; c != nil {
					c.ExtractedKnowledge.Entities = append(c.ExtractedKnowledge.Entities, ent)
				}
			}
		}
		keRows.Close()
	}
	if kgRows, kgErr := p.pool.Query(ctx,
		`SELECT ke.conversation_id::text, COALESCE(f.canonical_name, ke.from_entity_id::text), COALESCE(t.canonical_name, ke.to_entity_id::text),
		        ke.relation_type, ke.confidence, ke.valid_from, ke.evidence_ref
		 FROM voice.knowledge_edges ke
		 LEFT JOIN voice.knowledge_entities f ON f.id = ke.from_entity_id
		 LEFT JOIN voice.knowledge_entities t ON t.id = ke.to_entity_id
		 WHERE ke.conversation_id = ANY($1::uuid[])`, ordered); kgErr == nil {
		for kgRows.Next() {
			var cid string
			var edge KnowledgeEdgeIR
			var validFrom time.Time
			var refRaw []byte
			if kgRows.Scan(&cid, &edge.FromEntity, &edge.ToEntity, &edge.RelationType, &edge.Confidence, &validFrom, &refRaw) == nil {
				edge.ValidFrom = validFrom.UTC().Format(time.RFC3339Nano)
				var refMap map[string]any
				if json.Unmarshal(refRaw, &refMap) == nil {
					if u, ok := refMap["utterance_id"].(string); ok {
						edge.EvidenceUtteranceID = u
					}
				}
				if c := byID[cid]; c != nil {
					c.ExtractedKnowledge.Edges = append(c.ExtractedKnowledge.Edges, edge)
				}
			}
		}
		kgRows.Close()
	}

	// 7. Action Suggestions
	if aRows, aErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, action_type, title, rationale, payload, confidence, evidence_refs, status, decided_at
		 FROM voice.action_suggestions WHERE conversation_id = ANY($1::uuid[])`, ordered); aErr == nil {
		for aRows.Next() {
			var cid string
			var a ActionSuggestionIR
			var payloadRaw, refsRaw []byte
			var dAt *time.Time
			a.RequiresApproval = true
			if aRows.Scan(&cid, &a.ActionID, &a.ActionType, &a.Title, &a.Rationale, &payloadRaw, &a.Confidence, &refsRaw, &a.Status, &dAt) == nil {
				_ = json.Unmarshal(payloadRaw, &a.Payload)
				_ = json.Unmarshal(refsRaw, &a.EvidenceRefs)
				if dAt != nil {
					a.DecidedAt = dAt.UTC().Format(time.RFC3339Nano)
				}
				if c := byID[cid]; c != nil {
					c.ActionSuggestions = append(c.ActionSuggestions, a)
				}
			}
		}
		aRows.Close()
	}

	// 8. Human Corrections
	if cRows, cErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, id::text, target_type, target_id::text, original_value, corrected_value, reason, corrected_by::text, created_at
		 FROM voice.human_corrections WHERE conversation_id = ANY($1::uuid[]) ORDER BY created_at ASC`, ordered); cErr == nil {
		for cRows.Next() {
			var cid string
			var hc HumanCorrectionIR
			var cAt time.Time
			if cRows.Scan(&cid, &hc.CorrectionID, &hc.TargetType, &hc.TargetID, &hc.OriginalValue, &hc.CorrectedValue, &hc.Reason, &hc.CorrectedBy, &cAt) == nil {
				hc.CreatedAt = cAt.UTC().Format(time.RFC3339Nano)
				if c := byID[cid]; c != nil {
					c.HumanCorrections = append(c.HumanCorrections, hc)
				}
			}
		}
		cRows.Close()
	}

	// 9. Evidence + Custody
	evByConv := map[string]*EvidenceRecord{}
	if evRows, evErr := p.pool.Query(ctx,
		`SELECT id::text, conversation_id::text, recording_id::text, merkle_root, chain_head_hash, source_refs, export_count, last_verified_at
		 FROM voice.evidence_records WHERE conversation_id = ANY($1::uuid[])`, ordered); evErr == nil {
		for evRows.Next() {
			var evRec EvidenceRecord
			var lvAt time.Time
			var refsJSON []byte
			if evRows.Scan(&evRec.EvidenceID, &evRec.ConversationID, &evRec.RecordingID, &evRec.MerkleRoot, &evRec.ChainHeadHash, &refsJSON, &evRec.ExportCount, &lvAt) == nil {
				evRec.LastVerifiedAt = lvAt.UTC().Format(time.RFC3339Nano)
				if c := byID[evRec.ConversationID]; c != nil {
					_ = json.Unmarshal(refsJSON, &c.SourceEvidenceRefs)
					c.Evidence = &evRec
					evByConv[evRec.ConversationID] = &evRec
				}
			}
		}
		evRows.Close()
	}
	if len(evByConv) > 0 {
		if ceRows, ceErr := p.pool.Query(ctx,
			`SELECT id::text, evidence_id::text, conversation_id::text, actor_id::text, event_action, prev_hash, event_hash, details, occurred_at
			 FROM voice.custody_events WHERE conversation_id = ANY($1::uuid[]) ORDER BY occurred_at ASC`, ordered); ceErr == nil {
			for ceRows.Next() {
				var ce CustodyEvent
				var detRaw []byte
				var occ time.Time
				if ceRows.Scan(&ce.ID, &ce.EvidenceID, &ce.ConversationID, &ce.ActorID, &ce.EventAction, &ce.PrevHash, &ce.EventHash, &detRaw, &occ) == nil {
					_ = json.Unmarshal(detRaw, &ce.Details)
					ce.OccurredAt = occ.UTC().Format(time.RFC3339Nano)
					if ev := evByConv[ce.ConversationID]; ev != nil {
						ev.CustodyEvents = append(ev.CustodyEvents, ce)
					}
				}
			}
			ceRows.Close()
		}
	}

	// 10. Model Telemetry (Workstream 10)
	if mtRows, mtErr := p.pool.Query(ctx,
		`SELECT conversation_id::text, stage, adapter_name, routing_reason, fallback_used, latency_ms, confidence, cost_units
		 FROM voice.model_telemetry WHERE conversation_id = ANY($1::uuid[])`, ordered); mtErr == nil {
		for mtRows.Next() {
			var cid string
			var tel ModelTelemetryIR
			if mtRows.Scan(&cid, &tel.Stage, &tel.AdapterName, &tel.RoutingReason, &tel.FallbackUsed, &tel.LatencyMS, &tel.Confidence, &tel.CostUnits) == nil {
				if c := byID[cid]; c != nil {
					c.ModelTelemetry = append(c.ModelTelemetry, tel)
				}
			}
		}
		mtRows.Close()
	}

	vault := NewVoiceVault("")
	out := make([]ConversationIR, 0, len(ordered))
	for _, cid := range ordered {
		c := byID[cid]
		normalizeConversationSlicesForJSON(c)
		c.InteractionEdges = ResolveGoInteractionDynamics(c.Utterances, c.Participants)
		if c.InteractionEdges == nil {
			c.InteractionEdges = []InteractionEdgeIR{}
		}
		if c.Evidence != nil {
			if c.Evidence.CustodyEvents == nil {
				c.Evidence.CustodyEvents = []CustodyEvent{}
			}
			c.Evidence.ChainValid = vault.VerifyCustodyChain(c.Evidence.CustodyEvents)
		}
		out = append(out, *c)
	}
	return out, nil
}

func normalizeConversationSlicesForJSON(c *ConversationIR) {
	if c == nil {
		return
	}
	if c.DetectedLanguages == nil {
		c.DetectedLanguages = []string{}
	}
	if c.Topics == nil {
		c.Topics = []string{}
	}
	if c.Participants == nil {
		c.Participants = []ParticipantIR{}
	}
	if c.Utterances == nil {
		c.Utterances = []UtteranceIR{}
	}
	if c.ConversationEvents == nil {
		c.ConversationEvents = []ConversationEventIR{}
	}
	if c.ExtractedKnowledge.Entities == nil {
		c.ExtractedKnowledge.Entities = []KnowledgeEntityIR{}
	}
	if c.ExtractedKnowledge.Edges == nil {
		c.ExtractedKnowledge.Edges = []KnowledgeEdgeIR{}
	}
	if c.ReasoningResults == nil {
		c.ReasoningResults = []ReasoningResultIR{}
	}
	if c.ActionSuggestions == nil {
		c.ActionSuggestions = []ActionSuggestionIR{}
	}
	if c.HumanCorrections == nil {
		c.HumanCorrections = []HumanCorrectionIR{}
	}
	if c.SourceEvidenceRefs == nil {
		c.SourceEvidenceRefs = []SourceEvidenceRef{}
	}
	if c.ModelTelemetry == nil {
		c.ModelTelemetry = []ModelTelemetryIR{}
	}
	if c.InteractionEdges == nil {
		c.InteractionEdges = []InteractionEdgeIR{}
	}
	if c.Recording.QualityReport.VadSegments == nil {
		c.Recording.QualityReport.VadSegments = []VadSegment{}
	}
	if c.Recording.QualityReport.Warnings == nil {
		c.Recording.QualityReport.Warnings = []string{}
	}
	if c.Evidence != nil && c.Evidence.CustodyEvents == nil {
		c.Evidence.CustodyEvents = []CustodyEvent{}
	}
}

func nonNilStrings(in []string, fallback ...string) []string {
	if len(in) > 0 {
		return in
	}
	if len(fallback) > 0 {
		return append([]string{}, fallback...)
	}
	return []string{}
}

func nonNilInts(in []int) []int {
	if in == nil {
		return []int{}
	}
	return in
}

func marshalNonNullJSON(v any, emptyLiteral string) string {
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 || string(b) == "null" {
		return emptyLiteral
	}
	return string(b)
}

func normalizeConversationIRForPersist(ir *ConversationIR) {
	ir.PrimaryLanguage = defaultString(ir.PrimaryLanguage, "en")
	ir.DetectedLanguages = nonNilStrings(ir.DetectedLanguages, ir.PrimaryLanguage)
	ir.Topics = nonNilStrings(ir.Topics)
	ir.Status = defaultString(ir.Status, "captured")
	switch ir.ConfidenceTier {
	case "HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA":
	default:
		ir.ConfidenceTier = "MEDIUM"
	}
	if ir.Recording.QualityReport.RoutingStrategy == "" {
		ir.Recording.QualityReport.RoutingStrategy = "direct_asr"
	}
	if ir.Recording.Integrity.SHA256Original == "" {
		ir.Recording.Integrity.SHA256Original = ComputeSHA256([]byte("rec:" + ir.Recording.RecordingID + ":" + ir.ConversationID))
	}
	if ir.Recording.QualityReport.VadSegments == nil {
		ir.Recording.QualityReport.VadSegments = []VadSegment{}
	}
	if ir.Recording.AudioMetadata == nil {
		ir.Recording.AudioMetadata = map[string]any{}
	}
	if ir.SourceEvidenceRefs == nil {
		ir.SourceEvidenceRefs = []SourceEvidenceRef{}
	}
}

func (p *PostgresRepository) SaveConversationIR(ctx context.Context, ir ConversationIR, vault *VoiceVault, actionEvent string) (ConversationIR, error) {
	normalizeConversationIRForPersist(&ir)
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return ConversationIR{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	ir = attachSealedEvidence(ir, vault, actionEvent)
	_, err = tx.Exec(ctx,
		`INSERT INTO voice.conversations (
		     id, user_id, title, summary, status, primary_language, detected_languages,
		     topics, overall_confidence, confidence_tier
		 ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (id) DO UPDATE SET
		   title = EXCLUDED.title, summary = EXCLUDED.summary, status = EXCLUDED.status,
		   detected_languages = EXCLUDED.detected_languages,
		   topics = EXCLUDED.topics, overall_confidence = EXCLUDED.overall_confidence,
		   confidence_tier = EXCLUDED.confidence_tier`,
		ir.ConversationID, ir.UserID, ir.Title, ir.Summary, ir.Status, ir.PrimaryLanguage,
		ir.DetectedLanguages, ir.Topics, ir.OverallConfidence, ir.ConfidenceTier,
	)
	if err != nil {
		return ConversationIR{}, fmt.Errorf("save voice conversation: %w", err)
	}

	vadJSON := marshalNonNullJSON(ir.Recording.QualityReport.VadSegments, "[]")
	qrJSON := marshalNonNullJSON(ir.Recording.QualityReport, "{}")
	amJSON := marshalNonNullJSON(ir.Recording.AudioMetadata, "{}")
	s3Status := ir.Recording.S3PresignedStatus
	if s3Status == "" {
		s3Status = "pending"
	}
	callerSrc := ir.Recording.CallerSource
	if callerSrc == "" {
		callerSrc = "unknown"
	}
	callDir := ir.Recording.CallDirection
	if callDir == "" {
		callDir = "unknown"
	}
	var uploadedPtr *time.Time
	if ir.Recording.UploadedAt != "" {
		if t, parseErr := time.Parse(time.RFC3339Nano, ir.Recording.UploadedAt); parseErr == nil {
			uploadedPtr = &t
		}
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO voice.recordings (
		     id, conversation_id, user_id, source_type, mime_type, sample_rate_hz, channels,
		     duration_ms, byte_size, storage_uri, s3_bucket, s3_object_key, s3_presigned_status,
		     s3_etag, uploaded_at, caller_name, caller_phone_masked, caller_phone_hash,
		     caller_source, caller_confidence, call_direction, audio_metadata, encryption_key_version, quality_score, snr_db,
		     clipping_ratio, speech_ratio, noise_floor_dbfs, routing_strategy, quality_report,
		     vad_segments, consent_granted, consent_scope, sha256_original, hmac_seal, legal_hold
		 ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,$32,$33,$34,$35,$36)
		 ON CONFLICT (id) DO UPDATE SET
		   duration_ms = EXCLUDED.duration_ms,
		   byte_size = EXCLUDED.byte_size,
		   storage_uri = EXCLUDED.storage_uri,
		   s3_bucket = COALESCE(NULLIF(EXCLUDED.s3_bucket,''), voice.recordings.s3_bucket),
		   s3_object_key = COALESCE(NULLIF(EXCLUDED.s3_object_key,''), voice.recordings.s3_object_key),
		   s3_presigned_status = CASE WHEN EXCLUDED.s3_presigned_status <> 'pending' THEN EXCLUDED.s3_presigned_status ELSE voice.recordings.s3_presigned_status END,
		   s3_etag = COALESCE(NULLIF(EXCLUDED.s3_etag,''), voice.recordings.s3_etag),
		   uploaded_at = COALESCE(EXCLUDED.uploaded_at, voice.recordings.uploaded_at),
		   caller_name = COALESCE(NULLIF(EXCLUDED.caller_name,''), voice.recordings.caller_name),
		   caller_phone_masked = COALESCE(NULLIF(EXCLUDED.caller_phone_masked,''), voice.recordings.caller_phone_masked),
		   caller_phone_hash = COALESCE(NULLIF(EXCLUDED.caller_phone_hash,''), voice.recordings.caller_phone_hash),
		   caller_source = CASE WHEN EXCLUDED.caller_source <> 'unknown' THEN EXCLUDED.caller_source ELSE voice.recordings.caller_source END,
		   caller_confidence = GREATEST(voice.recordings.caller_confidence, EXCLUDED.caller_confidence),
		   call_direction = CASE WHEN EXCLUDED.call_direction <> 'unknown' THEN EXCLUDED.call_direction ELSE voice.recordings.call_direction END,
		   audio_metadata = EXCLUDED.audio_metadata,
		   sha256_original = EXCLUDED.sha256_original,
		   hmac_seal = EXCLUDED.hmac_seal`,
		ir.Recording.RecordingID, ir.ConversationID, ir.UserID, ir.Recording.SourceType, ir.Recording.MimeType,
		ir.Recording.SampleRateHz, ir.Recording.Channels, ir.Recording.DurationMS, ir.Recording.ByteSize,
		ir.Recording.StorageURI, ir.Recording.S3Bucket, ir.Recording.S3ObjectKey, s3Status,
		ir.Recording.S3ETag, uploadedPtr, ir.Recording.CallerName, ir.Recording.CallerPhoneMasked, ir.Recording.CallerPhoneHash,
		callerSrc, ir.Recording.CallerConfidence, callDir, string(amJSON),
		ir.Recording.Integrity.EncryptionKeyVersion, ir.Recording.QualityReport.QualityScore,
		ir.Recording.QualityReport.SNRDB, ir.Recording.QualityReport.ClippingRatio, ir.Recording.QualityReport.SpeechRatio,
		ir.Recording.QualityReport.NoiseFloorDBFS, ir.Recording.QualityReport.RoutingStrategy, string(qrJSON),
		string(vadJSON), ir.Recording.Integrity.ConsentGranted, ir.Recording.Integrity.ConsentScope,
		ir.Recording.Integrity.SHA256Original, ir.Recording.Integrity.HMACSeal, ir.Recording.Integrity.LegalHold,
	)
	if err != nil {
		return ConversationIR{}, fmt.Errorf("save voice recording: %w", err)
	}

	// Upsert Knowledge Entities first so we get canonical UUIDs for Knowledge Edges
	entityIDByKey := make(map[string]string, len(ir.ExtractedKnowledge.Entities)*2)
	for _, ent := range ir.ExtractedKnowledge.Entities {
		eid := ent.EntityID
		if eid == "" {
			eid = uuid.NewString()
		}
		eType := ent.EntityType
		if eType == "" {
			eType = "topic"
		}
		attrJSON := marshalNonNullJSON(ent.Attributes, "{}")
		var canonicalID string
		qErr := tx.QueryRow(ctx,
			`INSERT INTO voice.knowledge_entities (id, user_id, conversation_id, canonical_name, entity_type, aliases, attributes, embedding)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,$8)
			 ON CONFLICT (user_id, entity_type, canonical_name) DO UPDATE SET
			   conversation_id = EXCLUDED.conversation_id,
			   aliases = EXCLUDED.aliases,
			   attributes = EXCLUDED.attributes,
			   embedding = CASE WHEN COALESCE(array_length(EXCLUDED.embedding, 1), 0) > 0 THEN EXCLUDED.embedding ELSE voice.knowledge_entities.embedding END,
			   last_seen_at = now()
			 RETURNING id::text`,
			eid, ir.UserID, ir.ConversationID, ent.CanonicalName, eType, nonNilStrings(ent.Aliases), attrJSON, ent.Embedding,
		).Scan(&canonicalID)
		if qErr != nil {
			return ConversationIR{}, fmt.Errorf("save voice knowledge entity: %w", qErr)
		}
		entityIDByKey[eid] = canonicalID
		entityIDByKey[strings.ToLower(strings.TrimSpace(ent.CanonicalName))] = canonicalID
	}

	resolveOrCreateEntityID := func(nameOrID string) (string, error) {
		trimmed := strings.TrimSpace(nameOrID)
		if id, ok := entityIDByKey[trimmed]; ok {
			return id, nil
		}
		if id, ok := entityIDByKey[strings.ToLower(trimmed)]; ok {
			return id, nil
		}
		if trimmed == "" {
			trimmed = "Conversation Topic"
		}
		var canonicalID string
		qErr := tx.QueryRow(ctx,
			`INSERT INTO voice.knowledge_entities (id, user_id, conversation_id, canonical_name, entity_type)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,'topic')
			 ON CONFLICT (user_id, entity_type, canonical_name) DO UPDATE SET last_seen_at = now()
			 RETURNING id::text`,
			uuid.NewString(), ir.UserID, ir.ConversationID, trimmed,
		).Scan(&canonicalID)
		if qErr != nil {
			return "", qErr
		}
		entityIDByKey[strings.ToLower(trimmed)] = canonicalID
		return canonicalID, nil
	}

	// Pipeline all child row inserts in a single pgx.Batch roundtrip
	batch := &pgx.Batch{}
	partIDBySpeaker := make(map[string]string, len(ir.Participants))
	for _, part := range ir.Participants {
		partIDBySpeaker[part.SpeakerLabel] = part.ParticipantID
		batch.Queue(
			`INSERT INTO voice.participants (id, conversation_id, user_id, speaker_label, display_name, role, voiceprint_ref, is_verified, talk_time_ms, utterance_count)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10)
			 ON CONFLICT (conversation_id, speaker_label) DO UPDATE SET
			   display_name = EXCLUDED.display_name,
			   role = EXCLUDED.role,
			   is_verified = EXCLUDED.is_verified,
			   talk_time_ms = EXCLUDED.talk_time_ms,
			   utterance_count = EXCLUDED.utterance_count`,
			part.ParticipantID, ir.ConversationID, ir.UserID, part.SpeakerLabel, part.DisplayName,
			part.Role, part.VoiceprintRef, part.IsVerified, part.TalkTimeMS, part.UtteranceCount,
		)
	}

	for _, u := range ir.Utterances {
		wtJSON := marshalNonNullJSON(u.WordTimestamps, "[]")
		var addrPtr, partPtr *string
		if u.AddressedUtteranceID != "" {
			addrPtr = &u.AddressedUtteranceID
		}
		if pid, ok := partIDBySpeaker[u.SpeakerLabel]; ok && pid != "" {
			partPtr = &pid
		}
		batch.Queue(
			`INSERT INTO voice.utterances (id, conversation_id, recording_id, participant_id, speaker_label, seq_index, start_ms, end_ms, original_text, word_timestamps, language, confidence, uncertainty_reason, overlap_detected, audio_segment_ref, to_speakers, addressing_mode, addressed_utterance_id, what_is_spoken)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18::uuid,$19)
			 ON CONFLICT (id) DO UPDATE SET
			   participant_id = EXCLUDED.participant_id,
			   to_speakers = EXCLUDED.to_speakers,
			   addressing_mode = EXCLUDED.addressing_mode,
			   addressed_utterance_id = EXCLUDED.addressed_utterance_id,
			   what_is_spoken = EXCLUDED.what_is_spoken`,
			u.UtteranceID, ir.ConversationID, ir.Recording.RecordingID, partPtr, u.SpeakerLabel, u.SeqIndex, u.StartMS, u.EndMS,
			u.OriginalText, wtJSON, defaultString(u.Language, "en"), u.Confidence, u.UncertaintyReason, u.OverlapDetected, u.AudioSegmentRef,
			nonNilStrings(u.ToSpeakers), defaultString(u.AddressingMode, "group_broadcast"), addrPtr, u.WhatIsSpoken,
		)
	}

	for _, ev := range ir.ConversationEvents {
		var duePtr *time.Time
		if ev.DueAt != "" {
			if t, pErr := time.Parse(time.RFC3339Nano, ev.DueAt); pErr == nil {
				duePtr = &t
			}
		}
		batch.Queue(
			`INSERT INTO voice.conversation_events (id, conversation_id, event_type, summary, actor_speaker, topic, dialogue_act, intent, due_at, confidence, source_utterance_ids, status)
			 VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12) ON CONFLICT (id) DO NOTHING`,
			ev.EventID, ir.ConversationID, ev.EventType, ev.Summary, ev.ActorSpeaker, ev.Topic, ev.DialogueAct, ev.Intent, duePtr, ev.Confidence, nonNilStrings(ev.SourceUtteranceIDs), defaultString(ev.Status, "open"),
		)
	}

	for _, f := range ir.ReasoningResults {
		batch.Queue(
			`INSERT INTO voice.reasoning_findings (id, conversation_id, finding_type, severity, title, explanation, evidence_utterance_ids, confidence)
			 VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7::uuid[],$8) ON CONFLICT (id) DO NOTHING`,
			f.FindingID, ir.ConversationID, f.FindingType, defaultString(f.Severity, "medium"), f.Title, f.Explanation, nonNilStrings(f.EvidenceUtteranceIDs), f.Confidence,
		)
	}

	for _, edge := range ir.ExtractedKnowledge.Edges {
		fromID, fErr := resolveOrCreateEntityID(edge.FromEntity)
		toID, tErr := resolveOrCreateEntityID(edge.ToEntity)
		if fErr != nil || tErr != nil {
			continue
		}
		validFrom := time.Now().UTC()
		if edge.ValidFrom != "" {
			if t, pErr := time.Parse(time.RFC3339Nano, edge.ValidFrom); pErr == nil {
				validFrom = t
			}
		}
		evRefJSON, _ := json.Marshal(map[string]any{"utterance_id": edge.EvidenceUtteranceID})
		batch.Queue(
			`INSERT INTO voice.knowledge_edges (id, user_id, conversation_id, from_entity_id, to_entity_id, relation_type, valid_from, confidence, evidence_ref)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::jsonb) ON CONFLICT (id) DO NOTHING`,
			uuid.NewSHA1(uuid.NameSpaceDNS, []byte(fmt.Sprintf("%s:%s->%s:%s", ir.ConversationID, fromID, toID, edge.RelationType))).String(),
			ir.UserID, ir.ConversationID, fromID, toID, edge.RelationType, validFrom, edge.Confidence, string(evRefJSON),
		)
	}

	for _, a := range ir.ActionSuggestions {
		payloadJSON := marshalNonNullJSON(a.Payload, "{}")
		refsJSON := marshalNonNullJSON(a.EvidenceRefs, "[]")
		batch.Queue(
			`INSERT INTO voice.action_suggestions (id, user_id, conversation_id, action_type, title, rationale, payload, confidence, evidence_refs, status)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10) ON CONFLICT (id) DO NOTHING`,
			a.ActionID, ir.UserID, ir.ConversationID, a.ActionType, a.Title, a.Rationale, payloadJSON, a.Confidence, refsJSON, defaultString(a.Status, "pending_approval"),
		)
	}

	if ir.Evidence != nil {
		refsJSON := marshalNonNullJSON(ir.SourceEvidenceRefs, "[]")
		batch.Queue(
			`INSERT INTO voice.evidence_records (id, user_id, conversation_id, recording_id, merkle_root, chain_head_hash, source_refs)
			 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::jsonb)
			 ON CONFLICT (conversation_id) DO UPDATE SET merkle_root = EXCLUDED.merkle_root, chain_head_hash = EXCLUDED.chain_head_hash, source_refs = EXCLUDED.source_refs`,
			ir.Evidence.EvidenceID, ir.UserID, ir.ConversationID, ir.Recording.RecordingID,
			ir.Evidence.MerkleRoot, ir.Evidence.ChainHeadHash, refsJSON,
		)
		for _, ce := range ir.Evidence.CustodyEvents {
			detJSON := marshalNonNullJSON(ce.Details, "{}")
			batch.Queue(
				`INSERT INTO voice.custody_events (id, evidence_id, conversation_id, actor_id, event_action, prev_hash, event_hash, details)
				 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::jsonb) ON CONFLICT (id) DO NOTHING`,
				ce.ID, ce.EvidenceID, ce.ConversationID, ce.ActorID, ce.EventAction, ce.PrevHash, ce.EventHash, detJSON,
			)
		}
	}

	for _, tel := range ir.ModelTelemetry {
		batch.Queue(
			`INSERT INTO voice.model_telemetry (conversation_id, stage, adapter_name, routing_reason, fallback_used, latency_ms, confidence, cost_units)
			 VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8)`,
			ir.ConversationID, tel.Stage, tel.AdapterName, tel.RoutingReason, tel.FallbackUsed, tel.LatencyMS, tel.Confidence, tel.CostUnits,
		)
	}

	br := tx.SendBatch(ctx, batch)
	for i := 0; i < batch.Len(); i++ {
		if _, execErr := br.Exec(); execErr != nil {
			_ = br.Close()
			return ConversationIR{}, fmt.Errorf("save voice child batch item %d: %w", i, execErr)
		}
	}
	if closeErr := br.Close(); closeErr != nil {
		return ConversationIR{}, fmt.Errorf("close voice batch: %w", closeErr)
	}

	_ = events.EnqueueOutbox(ctx, tx, "voice.conversation.understood.v1", "voice_conversation", ir.ConversationID, ir.UserID, map[string]any{
		"conversation_id": ir.ConversationID,
		"user_id":         ir.UserID,
		"topics":          ir.Topics,
		"event_count":     len(ir.ConversationEvents),
		"finding_count":   len(ir.ReasoningResults),
		"entity_count":    len(ir.ExtractedKnowledge.Entities),
	})

	if err := tx.Commit(ctx); err != nil {
		return ConversationIR{}, err
	}
	return ir, nil
}

func (p *PostgresRepository) AddCorrection(ctx context.Context, userID, conversationID string, req CorrectionRequest, vault *VoiceVault) (HumanCorrectionIR, error) {
	hc := HumanCorrectionIR{
		CorrectionID:   uuid.NewString(),
		TargetType:     req.TargetType,
		TargetID:       req.TargetID,
		OriginalValue:  "(preserved in immutable utterance)",
		CorrectedValue: req.CorrectedValue,
		Reason:         req.Reason,
		CorrectedBy:    userID,
		CreatedAt:      time.Now().UTC().Format(time.RFC3339Nano),
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO voice.human_corrections (id, user_id, conversation_id, target_type, target_id, original_value, corrected_value, reason, corrected_by)
		 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,$9::uuid)`,
		hc.CorrectionID, userID, conversationID, hc.TargetType, hc.TargetID, hc.OriginalValue, hc.CorrectedValue, hc.Reason, userID,
	)
	if err != nil {
		return HumanCorrectionIR{}, err
	}
	_, _ = p.pool.Exec(ctx, `UPDATE voice.conversations SET status = 'verified' WHERE id = $1::uuid AND user_id = $2::uuid`, conversationID, userID)
	return hc, nil
}

func (p *PostgresRepository) DecideAction(ctx context.Context, userID, actionID, decision string, _ *VoiceVault) (ActionSuggestionIR, error) {
	var a ActionSuggestionIR
	var dAt time.Time
	err := p.pool.QueryRow(ctx,
		`UPDATE voice.action_suggestions SET status = $1, decided_at = now()
		 WHERE id = $2::uuid AND user_id = $3::uuid
		 RETURNING id::text, action_type, title, rationale, confidence, status, decided_at`,
		decision, actionID, userID,
	).Scan(&a.ActionID, &a.ActionType, &a.Title, &a.Rationale, &a.Confidence, &a.Status, &dAt)
	if err != nil {
		return ActionSuggestionIR{}, ErrNotFound
	}
	a.DecidedAt = dAt.UTC().Format(time.RFC3339Nano)
	a.RequiresApproval = true
	return a, nil
}

func (p *PostgresRepository) appendCustodyEvent(ctx context.Context, ev *EvidenceRecord, userID, conversationID, actor, action, detailsJSON string, vault *VoiceVault) {
	if ev == nil || ev.EvidenceID == "" {
		return
	}
	if actor == "" {
		actor = userID
	}
	prevHash := ev.ChainHeadHash
	if prevHash == "" {
		prevHash = "GENESIS"
	}
	nowTime := time.Now().UTC().Truncate(time.Microsecond)
	occurredAt := nowTime.Format(time.RFC3339Nano)
	evHash := ComputeSHA256([]byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s", ev.EvidenceID, conversationID, actor, action, prevHash, occurredAt)))
	if vault != nil {
		evHash = vault.ComputeCustodyHash(ev.EvidenceID, conversationID, actor, action, prevHash, occurredAt)
	}
	_, _ = p.pool.Exec(ctx,
		`INSERT INTO voice.custody_events (id, evidence_id, conversation_id, actor_id, event_action, prev_hash, event_hash, details, occurred_at)
		 VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::jsonb,$9)`,
		uuid.NewString(), ev.EvidenceID, conversationID, actor, action, prevHash, evHash, detailsJSON, nowTime,
	)
	_, _ = p.pool.Exec(ctx,
		`UPDATE voice.evidence_records SET chain_head_hash = $1, last_verified_at = now() WHERE id = $2::uuid`,
		evHash, ev.EvidenceID,
	)
}

func (p *PostgresRepository) ToggleLegalHold(ctx context.Context, userID, conversationID string, hold bool, actor string, vault *VoiceVault) (EvidenceRecord, error) {
	_, err := p.pool.Exec(ctx, `UPDATE voice.recordings SET legal_hold = $1 WHERE conversation_id = $2::uuid AND user_id = $3::uuid`, hold, conversationID, userID)
	if err != nil {
		return EvidenceRecord{}, err
	}
	ir, err := p.GetConversation(ctx, userID, conversationID)
	if err != nil || ir.Evidence == nil {
		return EvidenceRecord{}, ErrNotFound
	}
	action := "legal_hold_released"
	if hold {
		action = "legal_hold_enabled"
	}
	p.appendCustodyEvent(ctx, ir.Evidence, userID, conversationID, actor, action, fmt.Sprintf(`{"legal_hold":%t}`, hold), vault)
	updated, err := p.GetConversation(ctx, userID, conversationID)
	if err == nil && updated.Evidence != nil {
		return *updated.Evidence, nil
	}
	return *ir.Evidence, nil
}

func (p *PostgresRepository) IncrementExportCount(ctx context.Context, userID, conversationID string, vault *VoiceVault) (EvidenceRecord, error) {
	_, err := p.pool.Exec(ctx, `UPDATE voice.evidence_records SET export_count = export_count + 1, last_verified_at = now() WHERE conversation_id = $1::uuid AND user_id = $2::uuid`, conversationID, userID)
	if err != nil {
		return EvidenceRecord{}, err
	}
	ir, err := p.GetConversation(ctx, userID, conversationID)
	if err != nil || ir.Evidence == nil {
		return EvidenceRecord{}, ErrNotFound
	}
	p.appendCustodyEvent(ctx, ir.Evidence, userID, conversationID, userID, "exported", fmt.Sprintf(`{"export_count":%d}`, ir.Evidence.ExportCount), vault)
	updated, err := p.GetConversation(ctx, userID, conversationID)
	if err == nil && updated.Evidence != nil {
		return *updated.Evidence, nil
	}
	return *ir.Evidence, nil
}

func (p *PostgresRepository) SearchUtterances(ctx context.Context, userID, query string) ([]map[string]any, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT c.id::text, c.title, u.id::text, u.speaker_label, u.start_ms, u.end_ms, u.original_text
		 FROM voice.utterances u
		 JOIN voice.conversations c ON c.id = u.conversation_id
		 WHERE c.user_id = $1::uuid AND c.deleted_at IS NULL
		   AND ($2 = '' OR u.original_text ILIKE '%' || $2 || '%' OR c.title ILIKE '%' || $2 || '%')
		 ORDER BY u.created_at DESC LIMIT 20`,
		userID, strings.TrimSpace(query),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []map[string]any
	for rows.Next() {
		var cid, title, uid, spk, txt string
		var sMS, eMS int
		if rows.Scan(&cid, &title, &uid, &spk, &sMS, &eMS, &txt) == nil {
			results = append(results, map[string]any{
				"conversation_id":    cid,
				"conversation_title": title,
				"utterance_id":       uid,
				"speaker_label":      spk,
				"start_ms":           sMS,
				"end_ms":             eMS,
				"text":               txt,
				"score":              0.9,
			})
		}
	}
	return results, nil
}

func (p *PostgresRepository) UpsertCallerDirectory(ctx context.Context, entry CallerDirectoryEntry) error {
	if entry.UserID == "" || entry.PhoneHash == "" {
		return nil
	}
	obsJSON, _ := json.Marshal(entry.ObservedIdentities)
	var lastCall *time.Time
	if entry.LastCallAt != "" {
		if t, parseErr := time.Parse(time.RFC3339Nano, entry.LastCallAt); parseErr == nil {
			lastCall = &t
		}
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO voice.caller_directory (
		     user_id, phone_hash, phone_masked, display_name, source, confidence, spam_risk,
		     spam_reports, spam_score, company, business_category, organization, known_purpose,
		     relationship_label, call_count, last_call_at, observed_identities, identity_conflict,
		     needs_classification, voiceprint_ref
		 ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)
		 ON CONFLICT (user_id, phone_hash) DO UPDATE SET
		   display_name = COALESCE(NULLIF(EXCLUDED.display_name,''), voice.caller_directory.display_name),
		   phone_masked = COALESCE(NULLIF(EXCLUDED.phone_masked,''), voice.caller_directory.phone_masked),
		   source = EXCLUDED.source,
		   confidence = GREATEST(voice.caller_directory.confidence, EXCLUDED.confidence),
		   spam_risk = EXCLUDED.spam_risk,
		   spam_reports = GREATEST(voice.caller_directory.spam_reports, EXCLUDED.spam_reports),
		   spam_score = EXCLUDED.spam_score,
		   company = COALESCE(NULLIF(EXCLUDED.company,''), voice.caller_directory.company),
		   business_category = COALESCE(NULLIF(EXCLUDED.business_category,''), voice.caller_directory.business_category),
		   organization = COALESCE(NULLIF(EXCLUDED.organization,''), voice.caller_directory.organization),
		   known_purpose = COALESCE(NULLIF(EXCLUDED.known_purpose,''), voice.caller_directory.known_purpose),
		   relationship_label = CASE WHEN EXCLUDED.relationship_label <> 'unknown' THEN EXCLUDED.relationship_label ELSE voice.caller_directory.relationship_label END,
		   call_count = EXCLUDED.call_count,
		   last_call_at = COALESCE(EXCLUDED.last_call_at, voice.caller_directory.last_call_at),
		   observed_identities = EXCLUDED.observed_identities,
		   identity_conflict = EXCLUDED.identity_conflict,
		   needs_classification = EXCLUDED.needs_classification,
		   updated_at = now()`,
		entry.UserID, entry.PhoneHash, entry.PhoneMasked, entry.DisplayName,
		defaultString(entry.Source, "unknown"), entry.Confidence,
		defaultString(entry.SpamRisk, "low"), entry.SpamReports, entry.SpamScore,
		entry.Company, entry.BusinessCategory, entry.Organization, entry.KnownPurpose,
		defaultString(entry.RelationshipLabel, "unknown"), max(1, entry.CallCount), lastCall,
		string(obsJSON), entry.IdentityConflict, entry.NeedsClassification, entry.VoiceprintRef,
	)
	return err
}

func (p *PostgresRepository) LookupCallerDirectory(ctx context.Context, userID, phoneHash string) (CallerDirectoryEntry, bool) {
	if userID == "" || phoneHash == "" {
		return CallerDirectoryEntry{}, false
	}
	var e CallerDirectoryEntry
	var obsRaw []byte
	var lastCall *time.Time
	err := p.pool.QueryRow(ctx,
		`SELECT user_id::text, phone_hash, phone_masked, display_name, source, confidence, spam_risk,
		        spam_reports, spam_score, company, business_category, organization, known_purpose,
		        relationship_label, call_count, last_call_at, observed_identities, identity_conflict,
		        needs_classification, voiceprint_ref, updated_at
		 FROM voice.caller_directory WHERE user_id = $1::uuid AND phone_hash = $2`,
		userID, phoneHash,
	).Scan(
		&e.UserID, &e.PhoneHash, &e.PhoneMasked, &e.DisplayName, &e.Source, &e.Confidence, &e.SpamRisk,
		&e.SpamReports, &e.SpamScore, &e.Company, &e.BusinessCategory, &e.Organization, &e.KnownPurpose,
		&e.RelationshipLabel, &e.CallCount, &lastCall, &obsRaw, &e.IdentityConflict,
		&e.NeedsClassification, &e.VoiceprintRef, &e.UpdatedAt,
	)
	if err != nil {
		return CallerDirectoryEntry{}, false
	}
	if lastCall != nil {
		e.LastCallAt = lastCall.UTC().Format(time.RFC3339Nano)
	}
	_ = json.Unmarshal(obsRaw, &e.ObservedIdentities)
	return e, true
}

func (p *PostgresRepository) ListCallerDirectory(ctx context.Context, userID string) ([]CallerDirectoryEntry, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT user_id::text, phone_hash, phone_masked, display_name, source, confidence, spam_risk,
		        spam_reports, spam_score, company, business_category, organization, known_purpose,
		        relationship_label, call_count, last_call_at, observed_identities, identity_conflict,
		        needs_classification, voiceprint_ref, updated_at
		 FROM voice.caller_directory WHERE user_id = $1::uuid ORDER BY updated_at DESC LIMIT 200`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CallerDirectoryEntry
	for rows.Next() {
		var e CallerDirectoryEntry
		var obsRaw []byte
		var lastCall *time.Time
		if rows.Scan(
			&e.UserID, &e.PhoneHash, &e.PhoneMasked, &e.DisplayName, &e.Source, &e.Confidence, &e.SpamRisk,
			&e.SpamReports, &e.SpamScore, &e.Company, &e.BusinessCategory, &e.Organization, &e.KnownPurpose,
			&e.RelationshipLabel, &e.CallCount, &lastCall, &obsRaw, &e.IdentityConflict,
			&e.NeedsClassification, &e.VoiceprintRef, &e.UpdatedAt,
		) == nil {
			if lastCall != nil {
				e.LastCallAt = lastCall.UTC().Format(time.RFC3339Nano)
			}
			_ = json.Unmarshal(obsRaw, &e.ObservedIdentities)
			out = append(out, e)
		}
	}
	return out, nil
}

func (p *PostgresRepository) GetCallerTimeline(ctx context.Context, userID, phoneHash string) ([]CallerTimelineItem, error) {
	rows, err := p.pool.Query(ctx,
		`SELECT c.id::text, r.id::text, c.title, c.summary, r.call_direction, r.storage_uri,
		        r.s3_presigned_status, r.duration_ms, c.created_at
		 FROM voice.conversations c
		 JOIN voice.recordings r ON r.conversation_id = c.id
		 WHERE c.user_id = $1::uuid AND r.caller_phone_hash = $2 AND c.deleted_at IS NULL
		 ORDER BY c.created_at DESC LIMIT 30`,
		userID, phoneHash,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []CallerTimelineItem
	for rows.Next() {
		var it CallerTimelineItem
		var createdAt time.Time
		if rows.Scan(&it.ConversationID, &it.RecordingID, &it.Title, &it.Summary, &it.CallDirection,
			&it.StorageURI, &it.S3PresignedStatus, &it.DurationMS, &createdAt) == nil {
			it.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
			items = append(items, it)
		}
	}
	return items, nil
}

func (p *PostgresRepository) GetConversationByRecordingID(ctx context.Context, userID, recordingID string) (ConversationIR, error) {
	var convID string
	err := p.pool.QueryRow(ctx,
		`SELECT conversation_id::text FROM voice.recordings WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
		recordingID, userID,
	).Scan(&convID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ConversationIR{}, ErrNotFound
		}
		return ConversationIR{}, err
	}
	return p.GetConversation(ctx, userID, convID)
}

func (p *PostgresRepository) BindCallerIdentity(ctx context.Context, userID, conversationID, speakerLabel string, caller CallerDirectoryEntry, callDirection string, vault *VoiceVault) (ConversationIR, error) {
	ir, err := p.GetConversation(ctx, userID, conversationID)
	if err != nil {
		return ConversationIR{}, err
	}
	ir = applyCallerToConversation(ir, speakerLabel, caller, callDirection)
	if caller.PhoneHash != "" && caller.DisplayName != "" {
		caller.UserID = userID
		_ = p.UpsertCallerDirectory(ctx, caller)
	}
	return p.SaveConversationIR(ctx, ir, vault, "caller_identified")
}

func (p *PostgresRepository) SaveCaptureSession(ctx context.Context, sess *CaptureSession) error {
	if sess == nil || sess.SessionID == "" {
		return nil
	}
	_, err := p.pool.Exec(ctx,
		`INSERT INTO voice.capture_sessions (id, user_id, conversation_id, title, capture_mode, source_type, state, chunk_count, last_chunk_seq, processed_seqs, os_capture_guidance)
		 VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11)
		 ON CONFLICT (id) DO UPDATE SET
		   state = EXCLUDED.state,
		   chunk_count = EXCLUDED.chunk_count,
		   last_chunk_seq = EXCLUDED.last_chunk_seq,
		   processed_seqs = EXCLUDED.processed_seqs,
		   updated_at = now()`,
		sess.SessionID, sess.UserID, sess.ConversationID, sess.Title, sess.CaptureMode, sess.SourceType,
		sess.State, sess.ChunkCount, sess.LastChunkSeq, nonNilInts(sess.ProcessedSeqs), sess.OSCaptureGuidance,
	)
	return err
}

func (p *PostgresRepository) GetCaptureSession(ctx context.Context, sessionID string) (*CaptureSession, bool) {
	var s CaptureSession
	err := p.pool.QueryRow(ctx,
		`SELECT id::text, user_id::text, conversation_id::text, title, capture_mode, source_type, state,
		        chunk_count, last_chunk_seq, processed_seqs, os_capture_guidance, created_at, updated_at
		 FROM voice.capture_sessions WHERE id = $1::uuid`,
		sessionID,
	).Scan(&s.SessionID, &s.UserID, &s.ConversationID, &s.Title, &s.CaptureMode, &s.SourceType, &s.State,
		&s.ChunkCount, &s.LastChunkSeq, &s.ProcessedSeqs, &s.OSCaptureGuidance, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, false
	}
	return &s, true
}

func (m *MemoryRepository) BulkUpsertCallLogs(_ context.Context, userID string, entries []CallLogEntry) (int, error) {
	if userID == "" || len(entries) == 0 {
		return 0, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	existing := m.callLogs[userID]
	byKey := make(map[string]int, len(existing))
	for i, e := range existing {
		k := fmt.Sprintf("%s|%s|%s", e.PhoneHash, e.StartedAt.UTC().Format(time.RFC3339), e.Direction)
		byKey[k] = i
	}
	upserted := 0
	for _, item := range entries {
		if item.PhoneHash == "" {
			continue
		}
		if item.ID == "" {
			item.ID = uuid.NewString()
		}
		item.UserID = userID
		if item.CreatedAt.IsZero() {
			item.CreatedAt = time.Now().UTC()
		}
		k := fmt.Sprintf("%s|%s|%s", item.PhoneHash, item.StartedAt.UTC().Format(time.RFC3339), item.Direction)
		if idx, ok := byKey[k]; ok {
			existing[idx] = item
		} else {
			byKey[k] = len(existing)
			existing = append(existing, item)
		}
		upserted++
	}
	slices.SortFunc(existing, func(a, b CallLogEntry) int {
		return b.StartedAt.Compare(a.StartedAt)
	})
	m.callLogs[userID] = existing
	return upserted, nil
}

func (m *MemoryRepository) ListCallLogs(_ context.Context, userID string, limit int) ([]CallLogEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	logs := m.callLogs[userID]
	if limit <= 0 || limit > len(logs) {
		limit = len(logs)
	}
	out := make([]CallLogEntry, limit)
	copy(out, logs[:limit])
	return out, nil
}

func (p *PostgresRepository) BulkUpsertCallLogs(ctx context.Context, userID string, entries []CallLogEntry) (int, error) {
	if userID == "" || len(entries) == 0 {
		return 0, nil
	}
	batch := &pgx.Batch{}
	queued := 0
	for _, item := range entries {
		if item.PhoneHash == "" {
			continue
		}
		id := item.ID
		if id == "" {
			id = uuid.NewString()
		}
		var convPtr *string
		if item.ConversationID != "" {
			convPtr = &item.ConversationID
		}
		batch.Queue(
			`INSERT INTO voice.call_logs (
			     id, user_id, device_call_id, phone_hash, phone_masked, contact_name,
			     direction, duration_sec, started_at, sim_slot, source, conversation_id, spam_risk
			 ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid,$13)
			 ON CONFLICT (user_id, phone_hash, started_at, direction) DO UPDATE SET
			   contact_name = COALESCE(NULLIF(EXCLUDED.contact_name,''), voice.call_logs.contact_name),
			   duration_sec = GREATEST(voice.call_logs.duration_sec, EXCLUDED.duration_sec),
			   device_call_id = COALESCE(NULLIF(EXCLUDED.device_call_id,''), voice.call_logs.device_call_id),
			   conversation_id = COALESCE(EXCLUDED.conversation_id, voice.call_logs.conversation_id),
			   spam_risk = EXCLUDED.spam_risk`,
			id, userID, item.DeviceCallID, item.PhoneHash, item.PhoneMasked, item.ContactName,
			item.Direction, item.DurationSec, item.StartedAt.UTC(), item.SimSlot,
			defaultString(item.Source, "device_call_log"), convPtr, defaultString(item.SpamRisk, "low"),
		)
		queued++
	}
	if queued == 0 {
		return 0, nil
	}
	br := p.pool.SendBatch(ctx, batch)
	defer br.Close()
	for i := 0; i < queued; i++ {
		if _, err := br.Exec(); err != nil {
			return i, fmt.Errorf("bulk upsert call log %d: %w", i, err)
		}
	}
	return queued, nil
}

func (p *PostgresRepository) ListCallLogs(ctx context.Context, userID string, limit int) ([]CallLogEntry, error) {
	if limit <= 0 {
		limit = 500
	}
	rows, err := p.pool.Query(ctx,
		`SELECT id::text, user_id::text, device_call_id, phone_hash, phone_masked, contact_name,
		        direction, duration_sec, started_at, sim_slot, source, COALESCE(conversation_id::text,''), spam_risk, created_at
		 FROM voice.call_logs
		 WHERE user_id = $1::uuid
		 ORDER BY started_at DESC
		 LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CallLogEntry
	for rows.Next() {
		var e CallLogEntry
		if rows.Scan(
			&e.ID, &e.UserID, &e.DeviceCallID, &e.PhoneHash, &e.PhoneMasked, &e.ContactName,
			&e.Direction, &e.DurationSec, &e.StartedAt, &e.SimSlot, &e.Source, &e.ConversationID, &e.SpamRisk, &e.CreatedAt,
		) == nil {
			out = append(out, e)
		}
	}
	return out, nil
}
