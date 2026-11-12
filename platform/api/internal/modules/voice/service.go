package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/nexora/platform/api/internal/platform/cache"
	"github.com/nexora/platform/api/internal/platform/identity"
)

// Service orchestrates the NEXORA Voice Intelligence Control Plane across all 10 workstreams.
type Service struct {
	repo      Repository
	ml        *MLClient
	vault     *VoiceVault
	cache     *cache.Client
	presigner *S3Presigner
	callerDir CallerDirectoryProvider
	logger    *slog.Logger

	subMu       sync.RWMutex
	subscribers map[string][]chan []byte

	sessMu      sync.RWMutex
	sessions    map[string]*CaptureSession
	sessCallers map[string]CallerDirectoryEntry

	localObjMu   sync.RWMutex
	localObjects map[string][]byte
}

// NewService constructs a Voice Intelligence service.
func NewService(repo Repository, ml *MLClient, vault *VoiceVault, logger *slog.Logger) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	if vault == nil {
		vault = NewVoiceVault("")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		repo:         repo,
		ml:           ml,
		vault:        vault,
		presigner:    NewS3PresignerFromEnv("nexora-local-presign-secret"),
		callerDir:    NewCallerDirectoryResolver(repo),
		logger:       logger,
		subscribers:  make(map[string][]chan []byte),
		sessions:     make(map[string]*CaptureSession),
		sessCallers:  make(map[string]CallerDirectoryEntry),
		localObjects: make(map[string][]byte),
	}
}

// WithCache attaches a Redis read-through cache.
func (s *Service) WithCache(c *cache.Client) *Service {
	s.cache = c
	return s
}

// Mount registers all /voice/* routes on the given Chi router.
func Mount(r chi.Router, svc *Service) {
	if svc == nil {
		svc = NewService(nil, nil, nil, slog.Default())
	}
	r.Route("/voice", func(v chi.Router) {
		v.Get("/overview", svc.GetOverview)
		v.Get("/conversations", svc.ListConversations)
		v.Post("/conversations/capture", svc.CaptureConversation)
		v.Post("/conversations/import", svc.ImportConversation)
		v.Post("/sessions/start", svc.StartSession)
		v.Get("/sessions/{id}", svc.GetSession)
		v.Post("/sessions/{id}/chunk", svc.StreamSessionChunk)
		v.Post("/sessions/{id}/state", svc.UpdateSessionState)
		v.Post("/sessions/{id}/finalize", svc.FinalizeSession)
		v.Get("/conversations/{id}", svc.GetConversation)
		v.Post("/conversations/{id}/process", svc.ReprocessConversation)
		v.Post("/conversations/{id}/corrections", svc.AddCorrection)
		v.Post("/conversations/{id}/caller", svc.BindCaller)
		v.Post("/caller/resolve", svc.ResolveCaller)
		v.Post("/caller/classify", svc.ClassifyUnknownCaller)
		v.Post("/caller/report-spam", svc.ReportCallerSpam)
		v.Get("/caller/directory-sync", svc.SyncCallerDirectory)
		v.Post("/caller/sync-contacts", svc.SyncDeviceContacts)
		v.Get("/caller/timeline", svc.GetCallerTimeline)
		v.Post("/caller/import-logs", svc.ImportCallLogs)
		v.Get("/caller/logs", svc.ListCallLogs)
		v.Get("/caller/insights", svc.GetCallLogInsights)
		v.Post("/recordings/presign-upload", svc.PresignRecordingUpload)
		v.Put("/recordings/local-upload", svc.LocalUploadFallback)
		v.Get("/recordings/local-download", svc.LocalDownloadFallback)
		v.Post("/recordings/{id}/complete-upload", svc.CompleteRecordingUpload)
		v.Get("/recordings/{id}/presign-download", svc.PresignRecordingDownload)
		v.Post("/actions/{id}/decide", svc.DecideAction)
		v.Get("/memory/search", svc.SearchMemory)
		v.Post("/qa", svc.AnswerQA)
		v.Get("/evidence/{id}/export", svc.ExportEvidence)
		v.Post("/evidence/{id}/legal-hold", svc.ToggleLegalHold)
		v.Get("/models/status", svc.GetModelStatus)
		v.Get("/stream", svc.StreamEvents)
	})
}

func resolveUserID(r *http.Request, bodyUserID string) string {
	if strings.TrimSpace(bodyUserID) != "" {
		return strings.TrimSpace(bodyUserID)
	}
	if q := strings.TrimSpace(r.URL.Query().Get("user_id")); q != "" {
		return q
	}
	return identity.TestUserID
}

func overviewCacheKey(userID string) string {
	return "voice:overview:v1:" + userID
}

func conversationsListCacheKey(userID string) string {
	return "voice:convs:v1:" + userID
}

func (s *Service) invalidateAndBroadcast(ctx context.Context, userID string, event map[string]any) {
	if s.cache != nil {
		s.cache.Del(ctx, overviewCacheKey(userID))
		s.cache.Del(ctx, conversationsListCacheKey(userID))
	}
	raw, err := json.Marshal(event)
	if err != nil {
		return
	}
	s.subMu.RLock()
	chans := s.subscribers[userID]
	s.subMu.RUnlock()
	for _, ch := range chans {
		select {
		case ch <- raw:
		default:
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, msg string, retryable bool) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":       code,
			"message":    msg,
			"retryable":  retryable,
			"request_id": middleware.GetReqID(r.Context()),
		},
	})
}

func (s *Service) GetOverview(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	if s.cache != nil {
		if cached, ok := s.cache.Get(r.Context(), overviewCacheKey(userID)); ok {
			var out map[string]any
			if json.Unmarshal([]byte(cached), &out) == nil {
				out["cache_hit"] = true
				writeJSON(w, http.StatusOK, out)
				return
			}
		}
	}

	convs, err := s.repo.ListConversations(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "VOICE_LIST_ERR", err.Error(), true)
		return
	}

	totalUtterances := 0
	totalCommitments := 0
	totalFindings := 0
	pendingActions := 0
	verifiedChains := 0
	avgQuality := 0.0
	for _, c := range convs {
		totalUtterances += len(c.Utterances)
		totalFindings += len(c.ReasoningResults)
		avgQuality += c.Recording.QualityReport.QualityScore
		for _, ev := range c.ConversationEvents {
			if ev.EventType == "commitment" || ev.EventType == "decision" {
				totalCommitments++
			}
		}
		for _, act := range c.ActionSuggestions {
			if act.Status == "suggested" {
				pendingActions++
			}
		}
		if c.Evidence != nil && c.Evidence.ChainValid {
			verifiedChains++
		}
	}
	if len(convs) > 0 {
		avgQuality = avgQuality / float64(len(convs))
	}

	out := map[string]any{
		"user_id":               userID,
		"workstreams_active":    10,
		"conversation_count":    len(convs),
		"utterance_count":       totalUtterances,
		"commitments_decisions": totalCommitments,
		"reasoning_findings":    totalFindings,
		"pending_approvals":     pendingActions,
		"verified_chains":       verifiedChains,
		"avg_audio_quality":     avgQuality,
		"conversations":         convs,
		"cache_hit":             false,
	}
	if s.cache != nil {
		if raw, mErr := json.Marshal(out); mErr == nil {
			s.cache.Set(r.Context(), overviewCacheKey(userID), string(raw), 30*time.Second)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Service) ListConversations(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	if s.cache != nil {
		if cached, ok := s.cache.Get(r.Context(), conversationsListCacheKey(userID)); ok {
			var out map[string]any
			if json.Unmarshal([]byte(cached), &out) == nil {
				out["cache_hit"] = true
				writeJSON(w, http.StatusOK, out)
				return
			}
		}
	}
	convs, err := s.repo.ListConversations(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "VOICE_LIST_ERR", err.Error(), true)
		return
	}
	out := map[string]any{"conversations": convs, "count": len(convs), "cache_hit": false}
	if s.cache != nil {
		if raw, mErr := json.Marshal(out); mErr == nil {
			s.cache.Set(r.Context(), conversationsListCacheKey(userID), string(raw), 30*time.Second)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Service) CaptureConversation(w http.ResponseWriter, r *http.Request) {
	s.ingestAndProcess(w, r, "captured", "mobile_mic")
}

func (s *Service) ImportConversation(w http.ResponseWriter, r *http.Request) {
	s.ingestAndProcess(w, r, "imported", "imported_file")
}

func (s *Service) ingestAndProcess(w http.ResponseWriter, r *http.Request, custodyAction, defaultSource string) {
	var req CaptureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid voice capture payload", false)
		return
	}
	if strings.TrimSpace(req.Title) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "title is required", false)
		return
	}
	if req.ConsentGranted != nil && !*req.ConsentGranted {
		writeError(w, r, http.StatusForbidden, "CONSENT_REQUIRED", "explicit voice capture consent is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	if strings.TrimSpace(req.SourceType) == "" {
		req.SourceType = defaultSource
	}

	convID := uuid.NewString()
	recID := uuid.NewString()

	// Scrub PII before invoking external/ML adapters while keeping local encrypted/hashed record intact
	scrubbedTranscript, redactedCount := ScrubVoicePII(req.TranscriptText)
	callerEntry := CallerDirectoryEntry{}
	if req.PhoneNumber != "" || req.CallerName != "" {
		callerEntry = s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
		if req.CallerName == "" && callerEntry.DisplayName != "" {
			req.CallerName = callerEntry.DisplayName
		}
	}

	var ir ConversationIR
	mlPayload := map[string]any{
		"user_id":           userID,
		"conversation_id":   convID,
		"recording_id":      recID,
		"title":             req.Title,
		"source_type":       req.SourceType,
		"mime_type":         req.MimeType,
		"language":          req.Language,
		"consent_granted":   true,
		"consent_scope":     req.ConsentScope,
		"audio_base64":      req.AudioBase64,
		"transcript_text":   scrubbedTranscript,
		"turns":             req.Turns,
		"snr_db":            req.SNRDB,
		"duration_ms":       req.DurationMS,
		"overlap_suspected": req.OverlapSuspected,
	}
	if callerEntry.DisplayName != "" {
		mlPayload["caller_identity"] = map[string]any{
			"caller_name":       callerEntry.DisplayName,
			"caller_source":     callerEntry.Source,
			"caller_confidence": callerEntry.Confidence,
			"phone_masked":      callerEntry.PhoneMasked,
			"call_direction":    defaultString(req.CallDirection, "inbound"),
		}
	}
	if !s.ml.PostJSON(r.Context(), "/v1/voice/conversation/process", mlPayload, &ir) || ir.ConversationID == "" {
		ir = DeterministicFallbackProcess(userID, convID, recID, req)
	}
	if callerEntry.DisplayName != "" {
		ir = applyCallerToConversation(ir, "", callerEntry, defaultString(req.CallDirection, "inbound"))
	}
	ir.CreatedAt = time.Now().UTC()
	ir.UpdatedAt = ir.CreatedAt

	saved, err := s.repo.SaveConversationIR(r.Context(), ir, s.vault, custodyAction)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "VOICE_SAVE_ERR", err.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "voice.conversation." + custodyAction,
		"conversation_id": saved.ConversationID,
		"pii_redacted":    redactedCount,
	})
	writeJSON(w, http.StatusCreated, saved)
}

func (s *Service) GetConversation(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	convID := chi.URLParam(r, "id")
	ir, err := s.repo.GetConversation(r.Context(), userID, convID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, r, status, "VOICE_NOT_FOUND", err.Error(), false)
		return
	}
	writeJSON(w, http.StatusOK, ir)
}

func (s *Service) ReprocessConversation(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	convID := chi.URLParam(r, "id")
	existing, err := s.repo.GetConversation(r.Context(), userID, convID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "VOICE_NOT_FOUND", err.Error(), false)
		return
	}

	turns := make([]map[string]any, 0, len(existing.Utterances))
	for _, u := range existing.Utterances {
		turns = append(turns, map[string]any{
			"speaker":  u.SpeakerLabel,
			"text":     u.OriginalText,
			"start_ms": u.StartMS,
			"end_ms":   u.EndMS,
			"overlap":  u.OverlapDetected,
		})
	}
	var updated ConversationIR
	mlReq := map[string]any{
		"user_id":         userID,
		"conversation_id": existing.ConversationID,
		"recording_id":    existing.Recording.RecordingID,
		"title":           existing.Title,
		"source_type":     existing.Recording.SourceType,
		"language":        existing.PrimaryLanguage,
		"snr_db":          existing.Recording.QualityReport.SNRDB,
		"duration_ms":     existing.Recording.DurationMS,
		"turns":           turns,
	}
	if !s.ml.PostJSON(r.Context(), "/v1/voice/conversation/process", mlReq, &updated) || updated.ConversationID == "" {
		updated = existing
	} else {
		updated.HumanCorrections = existing.HumanCorrections
		updated.Evidence = existing.Evidence
		updated.CreatedAt = existing.CreatedAt
	}
	saved, saveErr := s.repo.SaveConversationIR(r.Context(), updated, s.vault, "analyzed")
	if saveErr != nil {
		writeError(w, r, http.StatusInternalServerError, "VOICE_REPROCESS_ERR", saveErr.Error(), true)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.conversation.reprocessed", "conversation_id": convID})
	writeJSON(w, http.StatusOK, saved)
}

func (s *Service) AddCorrection(w http.ResponseWriter, r *http.Request) {
	var req CorrectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid correction payload", false)
		return
	}
	if strings.TrimSpace(req.TargetID) == "" || strings.TrimSpace(req.CorrectedValue) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "target_id and corrected_value are required", false)
		return
	}
	if req.TargetType == "" {
		req.TargetType = "utterance_text"
	}
	userID := resolveUserID(r, req.UserID)
	convID := chi.URLParam(r, "id")
	corr, err := s.repo.AddCorrection(r.Context(), userID, convID, req, s.vault)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, r, status, "VOICE_CORRECTION_ERR", err.Error(), false)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.correction.added", "conversation_id": convID})
	writeJSON(w, http.StatusCreated, corr)
}

func (s *Service) DecideAction(w http.ResponseWriter, r *http.Request) {
	var req ActionDecisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid decision payload", false)
		return
	}
	dec := strings.ToLower(strings.TrimSpace(req.Decision))
	if dec != "approved" && dec != "rejected" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "decision must be approved or rejected", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	actionID := chi.URLParam(r, "id")
	updated, err := s.repo.DecideAction(r.Context(), userID, actionID, dec, s.vault)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "VOICE_ACTION_NOT_FOUND", err.Error(), false)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.action.decided", "action_id": actionID, "status": dec})
	writeJSON(w, http.StatusOK, updated)
}

func (s *Service) SearchMemory(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	convs, err := s.repo.ListConversations(r.Context(), userID)
	if err == nil && s.ml != nil {
		var mlRes map[string]any
		if s.ml.PostJSON(r.Context(), "/v1/voice/memory/search", map[string]any{"query": query, "conversations": convs}, &mlRes) {
			writeJSON(w, http.StatusOK, mlRes)
			return
		}
	}
	results, sErr := s.repo.SearchUtterances(r.Context(), userID, query)
	if sErr != nil {
		writeError(w, r, http.StatusInternalServerError, "VOICE_SEARCH_ERR", sErr.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"query": query, "count": len(results), "results": results})
}

func (s *Service) AnswerQA(w http.ResponseWriter, r *http.Request) {
	var req QARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid qa payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	convs, _ := s.repo.ListConversations(r.Context(), userID)
	if req.ConversationID != "" {
		if single, err := s.repo.GetConversation(r.Context(), userID, req.ConversationID); err == nil {
			convs = []ConversationIR{single}
		}
	}
	var mlRes map[string]any
	if s.ml.PostJSON(r.Context(), "/v1/voice/qa", map[string]any{"question": req.Question, "conversations": convs}, &mlRes) {
		writeJSON(w, http.StatusOK, mlRes)
		return
	}

	// Deterministic Go fallback Q&A strictly grounded in utterance matches
	matches, _ := s.repo.SearchUtterances(r.Context(), userID, req.Question)
	if len(matches) == 0 {
		// Retry keyword search over longest token
		for _, tok := range strings.Fields(req.Question) {
			if len(tok) >= 4 {
				matches, _ = s.repo.SearchUtterances(r.Context(), userID, tok)
				if len(matches) > 0 {
					break
				}
			}
		}
	}
	if len(matches) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"answer":          "No grounded utterance evidence matched your question.",
			"confidence":      0.15,
			"confidence_tier": "INSUFFICIENT_DATA",
			"citations":       []any{},
		})
		return
	}
	first := matches[0]
	writeJSON(w, http.StatusOK, map[string]any{
		"answer":          fmt.Sprintf("Grounded in %s: %v stated \"%v\"", first["conversation_title"], first["speaker_label"], first["text"]),
		"confidence":      0.82,
		"confidence_tier": "HIGH",
		"citations":       matches[:min(3, len(matches))],
	})
}

func (s *Service) ExportEvidence(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	convID := chi.URLParam(r, "id")
	ev, err := s.repo.IncrementExportCount(r.Context(), userID, convID, s.vault)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "VOICE_EVIDENCE_NOT_FOUND", err.Error(), false)
		return
	}
	ir, _ := s.repo.GetConversation(r.Context(), userID, convID)
	writeJSON(w, http.StatusOK, map[string]any{
		"package_version": "nexora-voice-evidence-v1",
		"exported_at":     time.Now().UTC().Format(time.RFC3339Nano),
		"conversation_id": convID,
		"recording_sha":   ir.Recording.Integrity.SHA256Original,
		"hmac_seal":       ir.Recording.Integrity.HMACSeal,
		"legal_hold":      ir.Recording.Integrity.LegalHold,
		"evidence":        ev,
		"utterances":      ir.Utterances,
		"corrections":     ir.HumanCorrections,
	})
}

func (s *Service) ToggleLegalHold(w http.ResponseWriter, r *http.Request) {
	var req LegalHoldRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid legal hold payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	convID := chi.URLParam(r, "id")
	ev, err := s.repo.ToggleLegalHold(r.Context(), userID, convID, req.LegalHold, req.Reason, s.vault)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "VOICE_NOT_FOUND", err.Error(), false)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.evidence.legal_hold", "conversation_id": convID, "legal_hold": req.LegalHold})
	writeJSON(w, http.StatusOK, ev)
}

func (s *Service) GetModelStatus(w http.ResponseWriter, r *http.Request) {
	var mlBench map[string]any
	if s.ml.GetJSON(r.Context(), "/v1/voice/models/benchmarks", &mlBench) {
		mlBench["ml_service_reachable"] = true
		writeJSON(w, http.StatusOK, mlBench)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ml_service_reachable": false,
		"registered_adapters": []map[string]any{
			{"name": "tagspeech-whisper-baseline-v1", "role": "clean_tagspeech_asr", "cost_per_min": 0.02},
			{"name": "diarization-guided-multilingual-asr-v1", "role": "noisy_overlap_multilingual_asr", "cost_per_min": 0.04},
			{"name": "go-deterministic-voice-baseline-v1", "role": "resilient_control_plane_fallback", "cost_per_min": 0.0},
		},
		"total_runs": 0,
	})
}

func (s *Service) StreamEvents(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "SSE_UNSUPPORTED", "streaming unsupported", false)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan []byte, 16)
	s.subMu.Lock()
	s.subscribers[userID] = append(s.subscribers[userID], ch)
	s.subMu.Unlock()

	defer func() {
		s.subMu.Lock()
		list := s.subscribers[userID]
		for i, c := range list {
			if c == ch {
				s.subscribers[userID] = append(list[:i], list[i+1:]...)
				break
			}
		}
		s.subMu.Unlock()
		close(ch)
	}()

	_, _ = fmt.Fprintf(w, "event: connected\ndata: {\"module\":\"voice\",\"user_id\":%q}\n\n", userID)
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			_, _ = fmt.Fprintf(w, "event: voice\ndata: %s\n\n", msg)
			flusher.Flush()
		case <-heartbeat.C:
			_, _ = fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

func osCaptureGuidance(mode string) string {
	switch mode {
	case "background_service_mic":
		return "Android Foreground Microphone Service / iOS active AVAudioSession with visible recording indicator."
	case "call_dual_track":
		return "VoIP/CallKit dual-track or speaker-separated stream; OS blocks silent third-party cellular PSTN tapping."
	default:
		return "Foreground microphone or uploaded recording stream."
	}
}

func (s *Service) StartSession(w http.ResponseWriter, r *http.Request) {
	var req StartSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid session payload", false)
		return
	}
	if req.ConsentGranted != nil && !*req.ConsentGranted {
		writeError(w, r, http.StatusForbidden, "CONSENT_REQUIRED", "explicit capture consent is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Live Call / Voice Session"
	}
	mode := strings.TrimSpace(req.CaptureMode)
	if mode == "" {
		mode = "call_dual_track"
	}
	src := strings.TrimSpace(req.SourceType)
	if src == "" {
		src = "call"
	}
	lang := strings.TrimSpace(req.Language)
	if lang == "" {
		lang = "en"
	}
	sid := uuid.NewString()
	now := time.Now().UTC()
	sess := &CaptureSession{
		SessionID:         sid,
		ConversationID:    sid,
		UserID:            userID,
		Title:             title,
		CaptureMode:       mode,
		SourceType:        src,
		State:             "active",
		LastChunkSeq:      -1,
		ProcessedSeqs:     []int{},
		OSCaptureGuidance: osCaptureGuidance(mode),
		CreatedAt:         now,
		UpdatedAt:         now,
	}

	var callerEntry CallerDirectoryEntry
	if req.PhoneNumber != "" || req.CallerName != "" {
		callerEntry = s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
	}

	// Ensure parent voice.conversations row exists BEFORE inserting voice.capture_sessions (FK constraint).
	recID := uuid.NewSHA1(uuid.NameSpaceDNS, []byte("rec:"+sid)).String()
	draftIR := ConversationIR{
		ConversationID:    sid,
		UserID:            userID,
		Title:             title,
		Summary:           "Live capture session active.",
		Status:            "captured",
		PrimaryLanguage:   lang,
		DetectedLanguages: []string{lang},
		Topics:            []string{"live_call"},
		OverallConfidence: 0.75,
		ConfidenceTier:    "MEDIUM",
		Recording: RecordingIR{
			RecordingID:       recID,
			SourceType:        src,
			MimeType:          "audio/wav",
			SampleRateHz:      16000,
			Channels:          1,
			S3PresignedStatus: "pending",
			CallerName:        callerEntry.DisplayName,
			CallerPhoneMasked: callerEntry.PhoneMasked,
			CallerPhoneHash:   callerEntry.PhoneHash,
			CallerSource:      callerEntry.Source,
			CallerConfidence:  callerEntry.Confidence,
			CallDirection:     defaultString(req.CallDirection, "inbound"),
			QualityReport: AudioQualityReport{
				RoutingStrategy: "direct_asr",
				VadSegments:     []VadSegment{},
			},
			AudioMetadata: map[string]any{"capture_mode": mode},
			Integrity: IntegrityMetadata{
				SHA256Original:       ComputeSHA256([]byte("session:" + sid)),
				EncryptionKeyVersion: 1,
				ConsentGranted:       true,
				ConsentScope:         src,
			},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := s.repo.SaveConversationIR(r.Context(), draftIR, s.vault, "captured"); err != nil {
		writeError(w, r, http.StatusInternalServerError, "SESSION_START_ERR", err.Error(), true)
		return
	}
	if err := s.repo.SaveCaptureSession(r.Context(), sess); err != nil {
		writeError(w, r, http.StatusInternalServerError, "SESSION_SAVE_ERR", err.Error(), true)
		return
	}

	var mlResp map[string]any
	_ = s.ml.PostJSON(r.Context(), "/v1/voice/sessions/start", map[string]any{
		"session_id":      sid,
		"user_id":         userID,
		"title":           title,
		"capture_mode":    mode,
		"source_type":     src,
		"language":        lang,
		"consent_granted": true,
	}, &mlResp)

	s.sessMu.Lock()
	s.sessions[sid] = sess
	if callerEntry.DisplayName != "" || callerEntry.PhoneHash != "" {
		s.sessCallers[sid] = callerEntry
	}
	s.sessMu.Unlock()

	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.session.started", "session_id": sid})
	writeJSON(w, http.StatusCreated, sess)
}

func (s *Service) GetSession(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "id")
	s.sessMu.RLock()
	sess, ok := s.sessions[sid]
	s.sessMu.RUnlock()
	if !ok {
		if persisted, found := s.repo.GetCaptureSession(r.Context(), sid); found {
			s.sessMu.Lock()
			s.sessions[sid] = persisted
			s.sessMu.Unlock()
			sess, ok = persisted, true
		}
	}
	if !ok {
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "capture session not found", false)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (s *Service) StreamSessionChunk(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "id")
	var req SessionChunkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid chunk payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)

	s.sessMu.Lock()
	sess, ok := s.sessions[sid]
	if !ok {
		if persisted, found := s.repo.GetCaptureSession(r.Context(), sid); found {
			sess = persisted
			s.sessions[sid] = sess
			ok = true
		}
	}
	if !ok {
		now := time.Now().UTC()
		sess = &CaptureSession{
			SessionID:         sid,
			ConversationID:    sid,
			UserID:            userID,
			Title:             "Live Call Session",
			CaptureMode:       "call_dual_track",
			SourceType:        "call",
			State:             "active",
			LastChunkSeq:      -1,
			OSCaptureGuidance: osCaptureGuidance("call_dual_track"),
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		s.sessions[sid] = sess
	}
	for _, seq := range sess.ProcessedSeqs {
		if seq == req.ChunkSeq {
			s.sessMu.Unlock()
			existing, _ := s.repo.GetConversation(r.Context(), userID, sess.ConversationID)
			writeJSON(w, http.StatusOK, map[string]any{"deduplicated": true, "session": sess, "ir": existing})
			return
		}
	}
	if req.InBackground {
		sess.State = "background"
	}
	sess.ProcessedSeqs = append(sess.ProcessedSeqs, req.ChunkSeq)
	sess.ChunkCount = len(sess.ProcessedSeqs)
	sess.LastChunkSeq = req.ChunkSeq
	sess.UpdatedAt = time.Now().UTC()
	if req.PhoneNumber != "" || req.CallerName != "" {
		s.sessCallers[sid] = s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
	}
	callerEntry := s.sessCallers[sid]
	s.sessMu.Unlock()

	scrubbedText, _ := ScrubVoicePII(req.TranscriptText)
	var mlOut struct {
		IR ConversationIR `json:"ir"`
	}
	var ir ConversationIR
	mlPayload := map[string]any{
		"chunk_seq":         req.ChunkSeq,
		"channel_hint":      req.ChannelHint,
		"in_background":     req.InBackground,
		"audio_base64":      req.AudioBase64,
		"transcript_text":   scrubbedText,
		"turns":             req.Turns,
		"snr_db":            req.SNRDB,
		"duration_ms":       req.DurationMS,
		"overlap_suspected": req.OverlapSuspected,
		"title":             sess.Title,
		"source_type":       sess.SourceType,
		"user_id":           userID,
	}
	if callerEntry.DisplayName != "" {
		mlPayload["caller_identity"] = map[string]any{
			"caller_name":       callerEntry.DisplayName,
			"caller_source":     callerEntry.Source,
			"caller_confidence": callerEntry.Confidence,
			"phone_masked":      callerEntry.PhoneMasked,
			"call_direction":    defaultString(req.CallDirection, "inbound"),
		}
	}
	if s.ml.PostJSON(r.Context(), "/v1/voice/sessions/"+sid+"/chunk", mlPayload, &mlOut) && mlOut.IR.ConversationID != "" {
		ir = mlOut.IR
	} else {
		// Go fallback: merge new utterances onto existing conversation
		existing, getErr := s.repo.GetConversation(r.Context(), userID, sid)
		chunkIR := DeterministicFallbackProcess(userID, sid, uuid.NewSHA1(uuid.NameSpaceDNS, []byte("rec:"+sid)).String(), CaptureRequest{
			UserID:           userID,
			Title:            sess.Title,
			SourceType:       sess.SourceType,
			AudioBase64:      req.AudioBase64,
			TranscriptText:   scrubbedText,
			Turns:            req.Turns,
			SNRDB:            req.SNRDB,
			DurationMS:       req.DurationMS,
			OverlapSuspected: req.OverlapSuspected,
			PhoneNumber:      req.PhoneNumber,
			CallerName:       callerEntry.DisplayName,
			CallerSource:     callerEntry.Source,
			CallDirection:    req.CallDirection,
		})
		if getErr == nil {
			offset := 0
			if len(existing.Utterances) > 0 {
				offset = existing.Utterances[len(existing.Utterances)-1].EndMS
			}
			for i := range chunkIR.Utterances {
				chunkIR.Utterances[i].SeqIndex = len(existing.Utterances) + i
				chunkIR.Utterances[i].StartMS += offset
				chunkIR.Utterances[i].EndMS += offset
				chunkIR.Utterances[i].UtteranceID = uuid.NewSHA1(uuid.NameSpaceDNS, []byte(fmt.Sprintf("%s:utt:%d", sid, chunkIR.Utterances[i].SeqIndex))).String()
			}
			existing.Utterances = append(existing.Utterances, chunkIR.Utterances...)
			pSeen := map[string]bool{}
			for _, p := range existing.Participants {
				pSeen[p.SpeakerLabel] = true
			}
			for _, p := range chunkIR.Participants {
				if !pSeen[p.SpeakerLabel] {
					existing.Participants = append(existing.Participants, p)
				}
			}
			existing.InteractionEdges = ResolveGoInteractionDynamics(existing.Utterances, existing.Participants)
			existing.ConversationEvents = append(existing.ConversationEvents, chunkIR.ConversationEvents...)
			existing.ActionSuggestions = append(existing.ActionSuggestions, chunkIR.ActionSuggestions...)
			existing.Status = "analyzing"
			existing.Summary = fmt.Sprintf("%d live turn(s) across %d speaker(s)", len(existing.Utterances), len(existing.Participants))
			ir = existing
		} else {
			chunkIR.Status = "analyzing"
			ir = chunkIR
		}
	}

	saved, err := s.repo.SaveConversationIR(r.Context(), ir, s.vault, "analyzed")
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "SESSION_CHUNK_ERR", err.Error(), true)
		return
	}
	_ = s.repo.SaveCaptureSession(r.Context(), sess)
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "voice.session.chunk",
		"session_id":      sid,
		"chunk_seq":       req.ChunkSeq,
		"state":           sess.State,
		"utterance_count": len(saved.Utterances),
	})
	writeJSON(w, http.StatusOK, map[string]any{"deduplicated": false, "session": sess, "ir": saved})
}

func (s *Service) UpdateSessionState(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "id")
	var req SessionStateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid session state payload", false)
		return
	}
	st := strings.ToLower(strings.TrimSpace(req.State))
	if st != "active" && st != "paused" && st != "background" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "state must be active, paused, or background", false)
		return
	}
	s.sessMu.Lock()
	sess, ok := s.sessions[sid]
	if !ok {
		if persisted, found := s.repo.GetCaptureSession(r.Context(), sid); found {
			sess = persisted
			s.sessions[sid] = sess
			ok = true
		}
	}
	if ok {
		sess.State = st
		sess.UpdatedAt = time.Now().UTC()
	}
	s.sessMu.Unlock()
	if !ok {
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "capture session not found", false)
		return
	}
	_ = s.repo.SaveCaptureSession(r.Context(), sess)
	writeJSON(w, http.StatusOK, sess)
}

func (s *Service) FinalizeSession(w http.ResponseWriter, r *http.Request) {
	sid := chi.URLParam(r, "id")
	userID := resolveUserID(r, "")
	s.sessMu.Lock()
	sess, ok := s.sessions[sid]
	if !ok {
		if persisted, found := s.repo.GetCaptureSession(r.Context(), sid); found {
			sess = persisted
			s.sessions[sid] = sess
			ok = true
		}
	}
	if ok {
		sess.State = "finalized"
		sess.UpdatedAt = time.Now().UTC()
	}
	s.sessMu.Unlock()
	if !ok {
		writeError(w, r, http.StatusNotFound, "SESSION_NOT_FOUND", "capture session not found", false)
		return
	}

	var mlOut map[string]any
	_ = s.ml.PostJSON(r.Context(), "/v1/voice/sessions/"+sid+"/finalize", map[string]any{}, &mlOut)

	existing, err := s.repo.GetConversation(r.Context(), userID, sess.ConversationID)
	if err == nil {
		existing.Status = "understood"
		existing, _ = s.repo.SaveConversationIR(r.Context(), existing, s.vault, "verified")
	}
	_ = s.repo.SaveCaptureSession(r.Context(), sess)
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{"type": "voice.session.finalized", "session_id": sid})
	writeJSON(w, http.StatusOK, map[string]any{"session": sess, "ir": existing})
}

// ResolveCaller resolves who called using Truecaller/Contacts/CallDirectory + PostgreSQL cache
// even before or without any spoken greeting in the audio.
func (s *Service) ResolveCaller(w http.ResponseWriter, r *http.Request) {
	var req ResolveCallerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid caller lookup payload", false)
		return
	}
	if strings.TrimSpace(req.PhoneNumber) == "" && strings.TrimSpace(req.CallerName) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "phone_number or caller_name is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	entry := s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
	timeline, _ := s.repo.GetCallerTimeline(r.Context(), userID, entry.PhoneHash)
	writeJSON(w, http.StatusOK, CallerContextResponse{
		Caller:   entry,
		Timeline: timeline,
	})
}

// ClassifyUnknownCaller stores user-confirmed identity, relationship, business category,
// and known purpose for an unknown number post-call (and links to any conversation if provided).
func (s *Service) ClassifyUnknownCaller(w http.ResponseWriter, r *http.Request) {
	var req ClassifyCallerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid classify payload", false)
		return
	}
	if strings.TrimSpace(req.PhoneNumber) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "phone_number is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	phoneHash := HashPhoneNumber(req.PhoneNumber)
	var existingPtr *CallerDirectoryEntry
	if cached, ok := s.repo.LookupCallerDirectory(r.Context(), userID, phoneHash); ok {
		existingPtr = &cached
	}
	reports := 0
	if req.IsSpam {
		reports = 1
		if existingPtr != nil {
			reports = existingPtr.SpamReports + 1
		}
	}
	merged := MergeCallerIntelligence(existingPtr, CallerDirectoryEntry{
		UserID:            userID,
		PhoneHash:         phoneHash,
		PhoneMasked:       MaskPhoneNumber(req.PhoneNumber),
		DisplayName:       strings.TrimSpace(req.DisplayName),
		Source:            "user_confirmed",
		Confidence:        0.98,
		SpamReports:       reports,
		BusinessCategory:  strings.TrimSpace(req.BusinessCategory),
		Organization:      strings.TrimSpace(req.Organization),
		KnownPurpose:      strings.TrimSpace(req.KnownPurpose),
		RelationshipLabel: defaultString(req.RelationshipLabel, "client"),
		CallCount:         0,
	})
	merged.NeedsClassification = false
	if err := s.repo.UpsertCallerDirectory(r.Context(), merged); err != nil {
		writeError(w, r, http.StatusInternalServerError, "CALLER_CLASSIFY_ERR", err.Error(), true)
		return
	}
	if strings.TrimSpace(req.ConversationID) != "" {
		_, _ = s.repo.BindCallerIdentity(r.Context(), userID, req.ConversationID, "", merged, "inbound", s.vault)
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":       "voice.caller.classified",
		"phone_hash": phoneHash,
		"name":       merged.DisplayName,
	})
	writeJSON(w, http.StatusOK, merged)
}

// ReportCallerSpam records a user-submitted spam report and updates pattern risk scoring.
func (s *Service) ReportCallerSpam(w http.ResponseWriter, r *http.Request) {
	var req ReportSpamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid spam report payload", false)
		return
	}
	if strings.TrimSpace(req.PhoneNumber) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "phone_number is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	phoneHash := HashPhoneNumber(req.PhoneNumber)
	var existingPtr *CallerDirectoryEntry
	prevReports := 0
	if cached, ok := s.repo.LookupCallerDirectory(r.Context(), userID, phoneHash); ok {
		existingPtr = &cached
		prevReports = cached.SpamReports
	}
	merged := MergeCallerIntelligence(existingPtr, CallerDirectoryEntry{
		UserID:       userID,
		PhoneHash:    phoneHash,
		PhoneMasked:  MaskPhoneNumber(req.PhoneNumber),
		Source:       "user_spam_report",
		SpamReports:  prevReports + 1,
		KnownPurpose: defaultString(req.Reason, "Reported suspicious / spam caller"),
		CallCount:    0,
	})
	merged.NeedsClassification = false
	if err := s.repo.UpsertCallerDirectory(r.Context(), merged); err != nil {
		writeError(w, r, http.StatusInternalServerError, "SPAM_REPORT_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, merged)
}

// SyncCallerDirectory exports the local caller intelligence DB for iOS CXCallDirectoryProvider
// and Android CallScreeningService offline-first matching.
func (s *Service) SyncCallerDirectory(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	entries, err := s.repo.ListCallerDirectory(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "DIR_SYNC_ERR", err.Error(), true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"entries": entries,
		"count":   len(entries),
		"mode":    "free_native_os_directory",
	})
}

// SyncDeviceContacts imports consented device contacts into voice.caller_directory using SHA-256
// phone hashing so raw phone numbers never leave the user's device unmasked.
func (s *Service) SyncDeviceContacts(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID   string `json:"user_id"`
		Source   string `json:"source"`
		Contacts []struct {
			PhoneNumber  string `json:"phone_number"`
			DisplayName  string `json:"display_name"`
			Organization string `json:"organization"`
		} `json:"contacts"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4*1024*1024)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid contacts sync payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	src := defaultString(req.Source, "device_contacts")
	synced := make([]CallerDirectoryEntry, 0, len(req.Contacts))
	for _, c := range req.Contacts {
		if normalizePhone(c.PhoneNumber) == "" || strings.TrimSpace(c.DisplayName) == "" {
			continue
		}
		pHash := HashPhoneNumber(c.PhoneNumber)
		var existingPtr *CallerDirectoryEntry
		if loaded, ok := s.repo.LookupCallerDirectory(r.Context(), userID, pHash); ok {
			existingPtr = &loaded
		}
		merged := MergeCallerIntelligence(existingPtr, CallerDirectoryEntry{
			UserID:            userID,
			PhoneHash:         pHash,
			PhoneMasked:       MaskPhoneNumber(c.PhoneNumber),
			DisplayName:       strings.TrimSpace(c.DisplayName),
			Organization:      strings.TrimSpace(c.Organization),
			Source:            src,
			Confidence:        0.92,
			RelationshipLabel: "contact",
			CallCount:         0,
		})
		merged.NeedsClassification = false
		if err := s.repo.UpsertCallerDirectory(r.Context(), merged); err == nil {
			synced = append(synced, merged)
		}
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":         "voice.caller.contacts_synced",
		"synced_count": len(synced),
		"source":       src,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"synced_count": len(synced),
		"entries":      synced,
	})
}

// GetCallerTimeline returns Caller Context + chronological Call Timeline for a number.
func (s *Service) GetCallerTimeline(w http.ResponseWriter, r *http.Request) {
	phone := strings.TrimSpace(r.URL.Query().Get("phone_number"))
	if phone == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION", "phone_number query param is required", false)
		return
	}
	userID := resolveUserID(r, "")
	phoneHash := HashPhoneNumber(phone)
	caller, ok := s.repo.LookupCallerDirectory(r.Context(), userID, phoneHash)
	if !ok {
		caller = CallerDirectoryEntry{
			UserID:              userID,
			PhoneHash:           phoneHash,
			PhoneMasked:         MaskPhoneNumber(phone),
			Source:              "unknown",
			NeedsClassification: true,
		}
	}
	timeline, _ := s.repo.GetCallerTimeline(r.Context(), userID, phoneHash)
	writeJSON(w, http.StatusOK, CallerContextResponse{
		Caller:   caller,
		Timeline: timeline,
	})
}

// BindCaller links a Truecaller/CallDirectory/user caller identity directly to a conversation's
// remote speaker when the call audio contains no greeting or self-introduction.
func (s *Service) BindCaller(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "id")
	var req BindCallerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid bind caller payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	caller := s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
	if req.Confidence > 0 {
		caller.Confidence = req.Confidence
	}
	if caller.DisplayName == "" {
		writeError(w, r, http.StatusNotFound, "CALLER_NOT_RESOLVED", "no caller identity found in directory; provide caller_name or classify via /voice/caller/classify", false)
		return
	}
	updated, err := s.repo.BindCallerIdentity(r.Context(), userID, convID, req.SpeakerLabel, caller, defaultString(req.CallDirection, "inbound"), s.vault)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, r, status, "BIND_CALLER_ERR", err.Error(), false)
		return
	}
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "voice.caller.identified",
		"conversation_id": convID,
		"caller_name":     caller.DisplayName,
		"caller_source":   caller.Source,
	})
	writeJSON(w, http.StatusOK, updated)
}

// PresignRecordingUpload reserves a PostgreSQL-linked recording & conversation row in state
// `presigned` and issues an AWS S3 SigV4 PUT presigned URL (or signed local dev fallback URL).
func (s *Service) PresignRecordingUpload(w http.ResponseWriter, r *http.Request) {
	var req PresignUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid presign payload", false)
		return
	}
	if req.ConsentGranted != nil && !*req.ConsentGranted {
		writeError(w, r, http.StatusForbidden, "CONSENT_REQUIRED", "explicit voice capture consent is required", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	convID := uuid.NewString()
	recID := uuid.NewString()
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "Uploaded Call Recording"
	}
	src := defaultString(req.SourceType, "call")
	mime := defaultString(req.MimeType, "audio/wav")
	ext := defaultString(req.FileExt, "wav")
	if req.FileExt == "" && strings.Contains(mime, "mp4") {
		ext = "m4a"
	}

	objectKey := s.presigner.ObjectKey(userID, convID, recID, ext)
	uploadURL, bucket, storageURI, uploadMode := s.presigner.PresignPut(objectKey, mime, 15*time.Minute)

	var caller *CallerDirectoryEntry
	if req.PhoneNumber != "" || req.CallerName != "" {
		c := s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
		if c.DisplayName != "" || c.PhoneMasked != "" {
			caller = &c
		}
	}

	now := time.Now().UTC()
	draft := ConversationIR{
		ConversationID:    convID,
		UserID:            userID,
		Title:             title,
		Summary:           "Awaiting presigned S3 audio upload completion.",
		Status:            "captured",
		PrimaryLanguage:   defaultString(req.Language, "en"),
		DetectedLanguages: []string{defaultString(req.Language, "en")},
		Topics:            []string{"call_capture"},
		OverallConfidence: 0.5,
		ConfidenceTier:    "MEDIUM",
		CreatedAt:         now,
		UpdatedAt:         now,
		Recording: RecordingIR{
			RecordingID:       recID,
			SourceType:        src,
			MimeType:          mime,
			SampleRateHz:      16000,
			Channels:          1,
			ByteSize:          req.ByteSize,
			StorageURI:        storageURI,
			S3Bucket:          bucket,
			S3ObjectKey:       objectKey,
			S3PresignedStatus: "presigned",
			CallDirection:     defaultString(req.CallDirection, "inbound"),
			QualityReport: AudioQualityReport{
				RoutingStrategy: "direct_asr",
			},
			Integrity: IntegrityMetadata{
				SHA256Original:       ComputeSHA256([]byte(recID + ":" + objectKey)),
				EncryptionKeyVersion: 1,
				ConsentGranted:       true,
				ConsentScope:         "voice.capture",
			},
		},
	}
	if caller != nil {
		draft.Recording.CallerName = caller.DisplayName
		draft.Recording.CallerPhoneMasked = caller.PhoneMasked
		draft.Recording.CallerPhoneHash = caller.PhoneHash
		draft.Recording.CallerSource = caller.Source
		draft.Recording.CallerConfidence = caller.Confidence
	}
	if _, err := s.repo.SaveConversationIR(r.Context(), draft, s.vault, "captured"); err != nil {
		writeError(w, r, http.StatusInternalServerError, "PRESIGN_SAVE_ERR", err.Error(), true)
		return
	}

	writeJSON(w, http.StatusCreated, PresignUploadResponse{
		RecordingID:     recID,
		ConversationID:  convID,
		UploadURL:       uploadURL,
		UploadMethod:    http.MethodPut,
		UploadMode:      uploadMode,
		RequiredHeaders: map[string]string{"Content-Type": mime},
		ExpiresInSec:    900,
		S3Bucket:        bucket,
		S3ObjectKey:     objectKey,
		StorageURI:      storageURI,
		Caller:          caller,
	})
}

// LocalUploadFallback accepts PUT bytes when running locally without AWS S3 env vars.
func (s *Service) LocalUploadFallback(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	expStr := r.URL.Query().Get("exp")
	sig := r.URL.Query().Get("sig")
	exp, _ := strconv.ParseInt(expStr, 10, 64)
	if !s.presigner.VerifyLocalSignature(http.MethodPut, key, exp, sig) {
		writeError(w, r, http.StatusForbidden, "INVALID_PRESIGN_SIG", "expired or invalid presigned upload signature", false)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 32*1024*1024))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "READ_ERR", err.Error(), false)
		return
	}
	s.localObjMu.Lock()
	s.localObjects[key] = data
	s.localObjMu.Unlock()
	sha := ComputeSHA256(data)
	etag := `"` + sha[:32] + `"`
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{
		"s3_object_key":   key,
		"s3_etag":         etag,
		"sha256_original": sha,
		"byte_size":       len(data),
	})
}

func (s *Service) LocalDownloadFallback(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	expStr := r.URL.Query().Get("exp")
	sig := r.URL.Query().Get("sig")
	exp, _ := strconv.ParseInt(expStr, 10, 64)
	if !s.presigner.VerifyLocalSignature(http.MethodGet, key, exp, sig) {
		writeError(w, r, http.StatusForbidden, "INVALID_PRESIGN_SIG", "expired or invalid download signature", false)
		return
	}
	s.localObjMu.RLock()
	data, ok := s.localObjects[key]
	s.localObjMu.RUnlock()
	if !ok {
		writeError(w, r, http.StatusNotFound, "OBJECT_NOT_FOUND", "recording object not found", false)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// CompleteRecordingUpload links the finished S3 object in PostgreSQL, resolves any caller ID
// (even with zero spoken greeting), runs the 10-workstream pipeline, and seals evidence custody.
func (s *Service) CompleteRecordingUpload(w http.ResponseWriter, r *http.Request) {
	recID := chi.URLParam(r, "id")
	var req CompleteUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid complete-upload payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	existing, err := s.repo.GetConversationByRecordingID(r.Context(), userID, recID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		}
		writeError(w, r, status, "RECORDING_NOT_FOUND", err.Error(), false)
		return
	}

	caller := CallerDirectoryEntry{
		UserID:      userID,
		DisplayName: existing.Recording.CallerName,
		PhoneMasked: existing.Recording.CallerPhoneMasked,
		PhoneHash:   existing.Recording.CallerPhoneHash,
		Source:      existing.Recording.CallerSource,
		Confidence:  existing.Recording.CallerConfidence,
	}
	if req.PhoneNumber != "" || req.CallerName != "" {
		caller = s.callerDir.Resolve(r.Context(), userID, req.PhoneNumber, req.CallerName, req.CallerSource)
	}

	var updated ConversationIR
	mlPayload := map[string]any{
		"user_id":           userID,
		"conversation_id":   existing.ConversationID,
		"recording_id":      recID,
		"title":             existing.Title,
		"source_type":       existing.Recording.SourceType,
		"mime_type":         existing.Recording.MimeType,
		"language":          existing.PrimaryLanguage,
		"consent_granted":   true,
		"audio_base64":      req.AudioBase64,
		"transcript_text":   req.TranscriptText,
		"turns":             req.Turns,
		"snr_db":            req.SNRDB,
		"duration_ms":       req.DurationMS,
		"overlap_suspected": req.OverlapSuspected,
	}
	if caller.DisplayName != "" {
		mlPayload["caller_identity"] = map[string]any{
			"caller_name":       caller.DisplayName,
			"caller_source":     caller.Source,
			"caller_confidence": caller.Confidence,
			"phone_masked":      caller.PhoneMasked,
			"call_direction":    defaultString(req.CallDirection, existing.Recording.CallDirection),
		}
	}
	if req.TranscriptText != "" || len(req.Turns) > 0 || req.AudioBase64 != "" {
		if !s.ml.PostJSON(r.Context(), "/v1/voice/conversation/process", mlPayload, &updated) || updated.ConversationID == "" {
			updated = DeterministicFallbackProcess(userID, existing.ConversationID, recID, CaptureRequest{
				UserID:           userID,
				Title:            existing.Title,
				SourceType:       existing.Recording.SourceType,
				Language:         existing.PrimaryLanguage,
				AudioBase64:      req.AudioBase64,
				TranscriptText:   req.TranscriptText,
				Turns:            req.Turns,
				SNRDB:            req.SNRDB,
				DurationMS:       req.DurationMS,
				OverlapSuspected: req.OverlapSuspected,
				PhoneNumber:      req.PhoneNumber,
				CallerName:       caller.DisplayName,
				CallerSource:     caller.Source,
				CallDirection:    req.CallDirection,
			})
		}
	} else {
		updated = existing
	}

	// Preserve & finalize S3 object link + PostgreSQL upload metadata
	updated.Recording.StorageURI = existing.Recording.StorageURI
	updated.Recording.S3Bucket = existing.Recording.S3Bucket
	updated.Recording.S3ObjectKey = existing.Recording.S3ObjectKey
	updated.Recording.S3PresignedStatus = "uploaded"
	if req.S3ETag != "" {
		updated.Recording.S3ETag = req.S3ETag
	}
	if req.SHA256Original != "" {
		updated.Recording.Integrity.SHA256Original = req.SHA256Original
	} else if updated.Recording.Integrity.SHA256Original == "" {
		updated.Recording.Integrity.SHA256Original = existing.Recording.Integrity.SHA256Original
	}
	if req.ByteSize > 0 {
		updated.Recording.ByteSize = req.ByteSize
	} else if updated.Recording.ByteSize == 0 {
		updated.Recording.ByteSize = existing.Recording.ByteSize
	}
	updated.Recording.UploadedAt = time.Now().UTC().Format(time.RFC3339Nano)
	updated.CreatedAt = existing.CreatedAt
	updated.UpdatedAt = time.Now().UTC()

	if caller.DisplayName != "" {
		updated = applyCallerToConversation(updated, "", caller, defaultString(req.CallDirection, existing.Recording.CallDirection))
	}

	saved, err := s.repo.SaveConversationIR(r.Context(), updated, s.vault, "uploaded")
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "COMPLETE_UPLOAD_ERR", err.Error(), true)
		return
	}
	dlURL, dlMode := s.presigner.PresignGet(saved.Recording.S3ObjectKey, 10*time.Minute)
	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "voice.recording.uploaded",
		"conversation_id": saved.ConversationID,
		"recording_id":    recID,
		"s3_object_key":   saved.Recording.S3ObjectKey,
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"ir":           saved,
		"download_url": dlURL,
		"storage_mode": dlMode,
	})
}

// PresignRecordingDownload returns a time-limited S3 GET URL for a PostgreSQL-linked recording.
func (s *Service) PresignRecordingDownload(w http.ResponseWriter, r *http.Request) {
	recID := chi.URLParam(r, "id")
	userID := resolveUserID(r, "")
	ir, err := s.repo.GetConversationByRecordingID(r.Context(), userID, recID)
	if err != nil {
		writeError(w, r, http.StatusNotFound, "RECORDING_NOT_FOUND", err.Error(), false)
		return
	}
	key := ir.Recording.S3ObjectKey
	if key == "" {
		key = s.presigner.ObjectKey(userID, ir.ConversationID, recID, "wav")
	}
	dlURL, mode := s.presigner.PresignGet(key, 10*time.Minute)
	writeJSON(w, http.StatusOK, map[string]any{
		"recording_id":        recID,
		"conversation_id":     ir.ConversationID,
		"s3_bucket":           ir.Recording.S3Bucket,
		"s3_object_key":       key,
		"s3_presigned_status": ir.Recording.S3PresignedStatus,
		"storage_uri":         ir.Recording.StorageURI,
		"download_url":        dlURL,
		"storage_mode":        mode,
		"expires_in_sec":      600,
	})
}
