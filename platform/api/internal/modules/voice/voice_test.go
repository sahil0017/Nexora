package voice

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func setupVoiceRouter() chi.Router {
	r := chi.NewRouter()
	svc := NewService(NewMemoryRepository(), nil, NewVoiceVault("unit-test-voice-master"), nil)
	Mount(r, svc)
	return r
}

func TestVoiceVaultMerkleCustodyAndPIIScrubbing(t *testing.T) {
	v := NewVoiceVault("voice-test-key")
	sha := ComputeSHA256([]byte("raw-audio-sample"))
	seal := v.SealRecording("user-1", "rec-1", sha)
	if seal == "" || len(seal) != 64 {
		t.Fatalf("expected 64-char hmac seal, got %q", seal)
	}

	ev1Hash := v.ComputeCustodyHash("ev-1", "conv-1", "user-1", "captured", "GENESIS", "2026-11-12T10:00:00Z")
	ev2Hash := v.ComputeCustodyHash("ev-1", "conv-1", "user-1", "verified", ev1Hash, "2026-11-12T10:05:00Z")
	chain := []CustodyEvent{
		{
			ID:             "1",
			EvidenceID:     "ev-1",
			ConversationID: "conv-1",
			ActorID:        "user-1",
			EventAction:    "captured",
			PrevHash:       "GENESIS",
			EventHash:      ev1Hash,
			OccurredAt:     "2026-11-12T10:00:00Z",
		},
		{
			ID:             "2",
			EvidenceID:     "ev-1",
			ConversationID: "conv-1",
			ActorID:        "user-1",
			EventAction:    "verified",
			PrevHash:       ev1Hash,
			EventHash:      ev2Hash,
			OccurredAt:     "2026-11-12T10:05:00Z",
		},
	}
	if !v.VerifyCustodyChain(chain) {
		t.Fatalf("expected valid custody chain")
	}
	chain[1].EventAction = "tampered"
	if v.VerifyCustodyChain(chain) {
		t.Fatalf("expected tampered custody chain to fail verification")
	}

	scrubbed, cnt := ScrubVoicePII("Call +91 9876543210 or email founder@nexora.ai with PAN ABCDE1234F")
	if cnt != 3 {
		t.Fatalf("expected 3 redacted PII tokens, got %d (%s)", cnt, scrubbed)
	}
}

func TestVoiceCaptureConsentCorrectionActionAndEvidenceFlow(t *testing.T) {
	r := setupVoiceRouter()

	// 1. Consent gate must block capture when consent_granted=false
	noConsentReq := httptest.NewRequest(
		http.MethodPost,
		"/voice/conversations/capture",
		bytes.NewBufferString(`{"title":"Blocked","consent_granted":false,"transcript_text":"Hello"}`),
	)
	wBlocked := httptest.NewRecorder()
	r.ServeHTTP(wBlocked, noConsentReq)
	if wBlocked.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when consent_granted=false, got %d", wBlocked.Code)
	}

	// 2. Capture valid conversation
	capReq := httptest.NewRequest(
		http.MethodPost,
		"/voice/conversations/capture",
		bytes.NewBufferString(`{
			"title":"Product Architecture Sync",
			"source_type":"meeting",
			"consent_granted":true,
			"snr_db":24.0,
			"transcript_text":"Sahil: Please prepare the migration spec.\nRiya: I will deliver the spec by Friday."
		}`),
	)
	wCap := httptest.NewRecorder()
	r.ServeHTTP(wCap, capReq)
	if wCap.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", wCap.Code, wCap.Body.String())
	}
	var ir ConversationIR
	if err := json.Unmarshal(wCap.Body.Bytes(), &ir); err != nil {
		t.Fatalf("decode ConversationIR: %v", err)
	}
	if len(ir.Utterances) != 2 || len(ir.Participants) != 2 {
		t.Fatalf("expected 2 utterances and 2 speakers, got %d / %d", len(ir.Utterances), len(ir.Participants))
	}
	if ir.Evidence == nil || !ir.Evidence.ChainValid {
		t.Fatalf("expected sealed valid evidence chain")
	}

	// 3. Add immutable Human Correction (Workstream 8)
	corrPayload, _ := json.Marshal(map[string]any{
		"target_type":     "utterance_text",
		"target_id":       ir.Utterances[1].UtteranceID,
		"corrected_value": "I will deliver the signed spec by Thursday.",
		"reason":          "Speaker clarified Thursday",
	})
	wCorr := httptest.NewRecorder()
	r.ServeHTTP(wCorr, httptest.NewRequest(http.MethodPost, "/voice/conversations/"+ir.ConversationID+"/corrections", bytes.NewReader(corrPayload)))
	if wCorr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on correction, got %d: %s", wCorr.Code, wCorr.Body.String())
	}

	// 4. Approve suggested action (Workstream 7)
	if len(ir.ActionSuggestions) == 0 {
		t.Fatalf("expected at least 1 action suggestion")
	}
	actionID := ir.ActionSuggestions[0].ActionID
	wAct := httptest.NewRecorder()
	r.ServeHTTP(wAct, httptest.NewRequest(http.MethodPost, "/voice/actions/"+actionID+"/decide", bytes.NewBufferString(`{"decision":"approved"}`)))
	if wAct.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on action decide, got %d: %s", wAct.Code, wAct.Body.String())
	}

	// 5. Legal hold & evidence export (Workstream 9)
	wHold := httptest.NewRecorder()
	r.ServeHTTP(wHold, httptest.NewRequest(http.MethodPost, "/voice/evidence/"+ir.ConversationID+"/legal-hold", bytes.NewBufferString(`{"legal_hold":true,"reason":"Compliance audit"}`)))
	if wHold.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on legal-hold, got %d", wHold.Code)
	}

	wExp := httptest.NewRecorder()
	r.ServeHTTP(wExp, httptest.NewRequest(http.MethodGet, "/voice/evidence/"+ir.ConversationID+"/export", nil))
	if wExp.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on evidence export, got %d", wExp.Code)
	}
	var exp map[string]any
	_ = json.Unmarshal(wExp.Body.Bytes(), &exp)
	if exp["legal_hold"] != true {
		t.Fatalf("expected legal_hold=true in exported evidence package, got %v", exp["legal_hold"])
	}

	// 6. Grounded Q&A (Workstream 8)
	wQA := httptest.NewRecorder()
	r.ServeHTTP(wQA, httptest.NewRequest(http.MethodPost, "/voice/qa", bytes.NewBufferString(`{"question":"Who will deliver the spec by Friday?"}`)))
	if wQA.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on qa, got %d", wQA.Code)
	}
	var qa map[string]any
	_ = json.Unmarshal(wQA.Body.Bytes(), &qa)
	if qa["confidence_tier"] == "INSUFFICIENT_DATA" {
		t.Fatalf("expected grounded answer, got %v", qa)
	}

	// 7. Overview & Model Status
	wOv := httptest.NewRecorder()
	r.ServeHTTP(wOv, httptest.NewRequest(http.MethodGet, "/voice/overview", nil))
	if wOv.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on overview, got %d", wOv.Code)
	}
	wMod := httptest.NewRecorder()
	r.ServeHTTP(wMod, httptest.NewRequest(http.MethodGet, "/voice/models/status", nil))
	if wMod.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on models/status, got %d", wMod.Code)
	}
}

func TestStreamingBackgroundCallSessionsAndWhoToWhomGraph(t *testing.T) {
	r := setupVoiceRouter()

	// 1. Start streaming call session (background_service_mic)
	startBody := `{"title":"Vendor Renewal Call","capture_mode":"background_service_mic","source_type":"call","language":"en","consent_granted":true}`
	wStart := httptest.NewRecorder()
	r.ServeHTTP(wStart, httptest.NewRequest(http.MethodPost, "/voice/sessions/start", bytes.NewBufferString(startBody)))
	if wStart.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on session start, got %d (%s)", wStart.Code, wStart.Body.String())
	}
	var sess CaptureSession
	if err := json.Unmarshal(wStart.Body.Bytes(), &sess); err != nil {
		t.Fatalf("decode session start: %v", err)
	}
	if sess.SessionID == "" || sess.CaptureMode != "background_service_mic" {
		t.Fatalf("unexpected session metadata: %+v", sess)
	}
	if sess.OSCaptureGuidance == "" {
		t.Fatalf("expected OS capture guidance in session response")
	}

	// 2. Toggle app into background mode
	wState := httptest.NewRecorder()
	r.ServeHTTP(wState, httptest.NewRequest(http.MethodPost, "/voice/sessions/"+sess.SessionID+"/state", bytes.NewBufferString(`{"state":"background"}`)))
	if wState.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on state update, got %d", wState.Code)
	}

	// 3. Stream local_mic chunk #1 while app is in background
	c1Body := `{"chunk_seq":1,"channel_hint":"local_mic","in_background":true,"duration_ms":3000,"transcript_text":"Hi, I'm Sahil. Ananya, I will send the proposal today."}`
	wC1 := httptest.NewRecorder()
	r.ServeHTTP(wC1, httptest.NewRequest(http.MethodPost, "/voice/sessions/"+sess.SessionID+"/chunk", bytes.NewBufferString(c1Body)))
	if wC1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on chunk 1, got %d (%s)", wC1.Code, wC1.Body.String())
	}

	// 4. Duplicate chunk_seq must be deduplicated cleanly
	wDup := httptest.NewRecorder()
	r.ServeHTTP(wDup, httptest.NewRequest(http.MethodPost, "/voice/sessions/"+sess.SessionID+"/chunk", bytes.NewBufferString(c1Body)))
	if wDup.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on duplicate chunk, got %d", wDup.Code)
	}
	var dupResp struct {
		Deduplicated bool `json:"deduplicated"`
	}
	_ = json.Unmarshal(wDup.Body.Bytes(), &dupResp)
	if !dupResp.Deduplicated {
		t.Fatalf("expected duplicate chunk_seq=1 to return deduplicated=true")
	}

	// 5. Stream remote_track chunk #2 and verify dynamic who->whom interaction edges
	c2Body := `{"chunk_seq":2,"channel_hint":"remote_track","in_background":true,"duration_ms":3500,"transcript_text":"Hi, I'm Ananya. Actually let's move the deadline to Monday instead."}`
	wC2 := httptest.NewRecorder()
	r.ServeHTTP(wC2, httptest.NewRequest(http.MethodPost, "/voice/sessions/"+sess.SessionID+"/chunk", bytes.NewBufferString(c2Body)))
	if wC2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on chunk 2, got %d (%s)", wC2.Code, wC2.Body.String())
	}
	var c2Resp struct {
		Session CaptureSession `json:"session"`
		IR      ConversationIR `json:"ir"`
	}
	if err := json.Unmarshal(wC2.Body.Bytes(), &c2Resp); err != nil {
		t.Fatalf("decode chunk 2 response: %v", err)
	}
	if c2Resp.Session.ChunkCount != 2 || c2Resp.Session.State != "background" {
		t.Fatalf("unexpected session counters: %+v", c2Resp.Session)
	}
	if len(c2Resp.IR.Utterances) < 2 {
		t.Fatalf("expected at least 2 utterances, got %d", len(c2Resp.IR.Utterances))
	}
	if c2Resp.IR.Utterances[1].WhatIsSpoken == "" {
		t.Fatalf("expected what_is_spoken populated on utterance")
	}
	if len(c2Resp.IR.InteractionEdges) == 0 {
		t.Fatalf("expected non-empty interaction_edges for who->whom graph")
	}

	// 6. Finalize session and verify sealed status
	wFin := httptest.NewRecorder()
	r.ServeHTTP(wFin, httptest.NewRequest(http.MethodPost, "/voice/sessions/"+sess.SessionID+"/finalize", bytes.NewBufferString(`{}`)))
	if wFin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on finalize, got %d (%s)", wFin.Code, wFin.Body.String())
	}
	var finResp struct {
		Session CaptureSession `json:"session"`
		IR      ConversationIR `json:"ir"`
	}
	_ = json.Unmarshal(wFin.Body.Bytes(), &finResp)
	if finResp.Session.State != "finalized" || finResp.IR.Status != "understood" {
		t.Fatalf("expected finalized session and understood IR, got state=%q status=%q", finResp.Session.State, finResp.IR.Status)
	}

	// 7. Verify persisted session lookup via GET /voice/sessions/{id}
	wGet := httptest.NewRecorder()
	r.ServeHTTP(wGet, httptest.NewRequest(http.MethodGet, "/voice/sessions/"+sess.SessionID, nil))
	if wGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET session, got %d", wGet.Code)
	}
	var gotSess CaptureSession
	if err := json.Unmarshal(wGet.Body.Bytes(), &gotSess); err != nil {
		t.Fatalf("decode GET session: %v", err)
	}
	if gotSess.State != "finalized" || gotSess.ChunkCount != 2 || gotSess.LastChunkSeq != 2 {
		t.Fatalf("expected persisted session with state=finalized chunk_count=2 last_chunk_seq=2, got %+v", gotSess)
	}
}

func TestPresignedS3RecordingLinkAndFreeNativeCallerIntelligence(t *testing.T) {
	r := setupVoiceRouter()

	// 1. Unknown number call arrival triggers needs_classification=true (₹0 local-first DB)
	wResUnknown := httptest.NewRecorder()
	r.ServeHTTP(wResUnknown, httptest.NewRequest(http.MethodPost, "/voice/caller/resolve",
		bytes.NewBufferString(`{"phone_number":"+919876504210","caller_source":"android_call_screening"}`)))
	if wResUnknown.Code != http.StatusOK {
		t.Fatalf("expected 200 OK resolving unknown caller, got %d", wResUnknown.Code)
	}
	var unknownCtx CallerContextResponse
	_ = json.Unmarshal(wResUnknown.Body.Bytes(), &unknownCtx)
	if !unknownCtx.Caller.NeedsClassification || unknownCtx.Caller.PhoneHash == "" {
		t.Fatalf("expected needs_classification=true and phone_hash, got %+v", unknownCtx.Caller)
	}

	// 2. User classifies unknown caller post-call with business & relationship intelligence
	wClassify := httptest.NewRecorder()
	r.ServeHTTP(wClassify, httptest.NewRequest(http.MethodPost, "/voice/caller/classify",
		bytes.NewBufferString(`{"phone_number":"+919876504210","display_name":"Vikram Patel","relationship_label":"vendor","business_category":"enterprise_vendor","organization":"Apex Tech Solutions","known_purpose":"Quarterly cloud renewal"}`)))
	if wClassify.Code != http.StatusOK {
		t.Fatalf("expected 200 OK classifying caller, got %d (%s)", wClassify.Code, wClassify.Body.String())
	}

	// 3. Reserve presigned S3 upload linked to Postgres + no-greeting caller identification
	wPresign := httptest.NewRecorder()
	r.ServeHTTP(wPresign, httptest.NewRequest(http.MethodPost, "/voice/recordings/presign-upload",
		bytes.NewBufferString(`{"title":"Renewal Call No Greeting","source_type":"call","mime_type":"audio/wav","phone_number":"+919876504210","call_direction":"inbound","consent_granted":true}`)))
	if wPresign.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on presign-upload, got %d (%s)", wPresign.Code, wPresign.Body.String())
	}
	var presigned PresignUploadResponse
	_ = json.Unmarshal(wPresign.Body.Bytes(), &presigned)
	if presigned.UploadURL == "" || presigned.RecordingID == "" || presigned.S3ObjectKey == "" {
		t.Fatalf("expected presigned URL, recording_id and object_key, got %+v", presigned)
	}
	if presigned.Caller == nil || presigned.Caller.DisplayName != "Vikram Patel" {
		t.Fatalf("expected automatic local directory resolution to Vikram Patel, got %+v", presigned.Caller)
	}

	// 4. Upload raw bytes to the signed upload URL (local signed fallback when S3 env unset)
	uploadPath := presigned.UploadURL
	if len(uploadPath) > 7 && uploadPath[:7] == "/api/v1" {
		uploadPath = uploadPath[7:]
	}
	wPut := httptest.NewRecorder()
	r.ServeHTTP(wPut, httptest.NewRequest(http.MethodPut, uploadPath, bytes.NewBufferString("RIFFfakewavbytes")))
	if wPut.Code != http.StatusOK {
		t.Fatalf("expected 200 OK uploading to signed URL, got %d (%s)", wPut.Code, wPut.Body.String())
	}

	// 5. Complete upload -> links Postgres recording row, seals custody, processes no-greeting turns
	completeBody := `{"byte_size":16,"duration_ms":4200,"phone_number":"+919876504210","call_direction":"inbound","turns":[{"channel_hint":"remote_track","text":"Send the revised SLA by Thursday."},{"channel_hint":"local_mic","text":"Done, I will send it today."}]}`
	wComp := httptest.NewRecorder()
	r.ServeHTTP(wComp, httptest.NewRequest(http.MethodPost, "/voice/recordings/"+presigned.RecordingID+"/complete-upload", bytes.NewBufferString(completeBody)))
	if wComp.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on complete-upload, got %d (%s)", wComp.Code, wComp.Body.String())
	}
	var compOut struct {
		IR          ConversationIR `json:"ir"`
		DownloadURL string         `json:"download_url"`
	}
	_ = json.Unmarshal(wComp.Body.Bytes(), &compOut)
	if compOut.IR.Recording.S3PresignedStatus != "uploaded" || compOut.IR.Recording.S3ObjectKey == "" || compOut.DownloadURL == "" {
		t.Fatalf("expected uploaded S3 link + download URL, got rec=%+v dl=%q", compOut.IR.Recording, compOut.DownloadURL)
	}
	if compOut.IR.Recording.CallerName != "Vikram Patel" {
		t.Fatalf("expected caller_name Vikram Patel bound with zero greeting, got %q", compOut.IR.Recording.CallerName)
	}

	// 6. Verify Call Timeline + Conflict Detection + Spam Pattern Intelligence + iOS Directory Sync
	wTl := httptest.NewRecorder()
	r.ServeHTTP(wTl, httptest.NewRequest(http.MethodGet, "/voice/caller/timeline?phone_number=%2B919876504210", nil))
	if wTl.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on caller timeline, got %d", wTl.Code)
	}
	var tlResp CallerContextResponse
	_ = json.Unmarshal(wTl.Body.Bytes(), &tlResp)
	if len(tlResp.Timeline) != 1 || tlResp.Timeline[0].RecordingID != presigned.RecordingID {
		t.Fatalf("expected linked conversation in caller timeline, got %+v", tlResp.Timeline)
	}

	// Different source returns conflicting name -> identity_conflict=true
	wConflict := httptest.NewRecorder()
	r.ServeHTTP(wConflict, httptest.NewRequest(http.MethodPost, "/voice/caller/resolve",
		bytes.NewBufferString(`{"phone_number":"+919876504210","caller_name":"Apex Support Desk","caller_source":"ios_call_directory"}`)))
	if wConflict.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on conflicting assertion, got %d", wConflict.Code)
	}
	var conflictCtx CallerContextResponse
	_ = json.Unmarshal(wConflict.Body.Bytes(), &conflictCtx)
	if !conflictCtx.Caller.IdentityConflict {
		t.Fatalf("expected identity_conflict=true when two sources disagree, got %+v", conflictCtx.Caller)
	}

	// Repeated spam reports escalate spam_risk -> high
	for i := 0; i < 3; i++ {
		wSpam := httptest.NewRecorder()
		r.ServeHTTP(wSpam, httptest.NewRequest(http.MethodPost, "/voice/caller/report-spam",
			bytes.NewBufferString(`{"phone_number":"+919999900001","reason":"Automated loan robocall"}`)))
		if wSpam.Code != http.StatusOK {
			t.Fatalf("expected 200 OK reporting spam, got %d", wSpam.Code)
		}
		if i == 2 {
			var spamEntry CallerDirectoryEntry
			_ = json.Unmarshal(wSpam.Body.Bytes(), &spamEntry)
			if spamEntry.SpamRisk != "high" || spamEntry.SpamReports < 3 {
				t.Fatalf("expected spam_risk=high after 3 reports, got %+v", spamEntry)
			}
		}
	}

	// Sync endpoint for iOS CXCallDirectoryProvider / Android CallScreeningService
	wSync := httptest.NewRecorder()
	r.ServeHTTP(wSync, httptest.NewRequest(http.MethodGet, "/voice/caller/directory-sync", nil))
	if wSync.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on directory-sync, got %d", wSync.Code)
	}
}

func TestDynamicHistoricCallLogsImportAndInsights(t *testing.T) {
	r := setupVoiceRouter()

	// 0. Verify zero manual/hardcoded seed records exist initially
	wInit := httptest.NewRecorder()
	r.ServeHTTP(wInit, httptest.NewRequest(http.MethodGet, "/voice/overview", nil))
	if wInit.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on initial overview, got %d", wInit.Code)
	}
	var initOv struct {
		ConversationCount int `json:"conversation_count"`
	}
	_ = json.Unmarshal(wInit.Body.Bytes(), &initOv)
	if initOv.ConversationCount != 0 {
		t.Fatalf("expected 0 seeded conversations (no manual insertion), got %d", initOv.ConversationCount)
	}

	// 1. Dynamically import historic call logs via CSV
	csvPayload := "phone_number,contact_name,direction,duration_sec,started_at,transcript_text\n" +
		"+919876543210,Ananya Rao,inbound,245,2026-11-10T10:15:00Z,Ananya: Let us confirm Friday rollout.\n" +
		"+919876543210,Ananya Rao,outbound,190,2026-11-11T14:20:00Z,\n" +
		"+919811122233,,missed,0,2026-11-11T15:00:00Z,\n" +
		"+919811122233,,missed,0,2026-11-11T15:05:00Z,"
	bodyBytes, _ := json.Marshal(ImportCallLogsRequest{
		Source: "csv_import",
		RawCSV: csvPayload,
	})
	wImp := httptest.NewRecorder()
	r.ServeHTTP(wImp, httptest.NewRequest(http.MethodPost, "/voice/caller/import-logs", bytes.NewReader(bodyBytes)))
	if wImp.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created on import-logs, got %d (%s)", wImp.Code, wImp.Body.String())
	}
	var impResp struct {
		ImportedCount       int             `json:"imported_count"`
		LinkedConversations int             `json:"linked_conversations"`
		Insights            CallLogInsights `json:"insights"`
	}
	if err := json.Unmarshal(wImp.Body.Bytes(), &impResp); err != nil {
		t.Fatalf("decode import-logs: %v", err)
	}
	if impResp.ImportedCount != 4 || impResp.LinkedConversations != 1 {
		t.Fatalf("expected 4 imported logs and 1 linked conversation, got %+v", impResp)
	}
	if impResp.Insights.TotalCalls != 4 || impResp.Insights.MissedCount != 2 || len(impResp.Insights.FollowUpAlerts) == 0 {
		t.Fatalf("expected dynamic insights with missed_repeat alerts, got %+v", impResp.Insights)
	}

	// 2. Verify GET /voice/caller/logs and GET /voice/caller/insights return loaded rows
	wLogs := httptest.NewRecorder()
	r.ServeHTTP(wLogs, httptest.NewRequest(http.MethodGet, "/voice/caller/logs", nil))
	if wLogs.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /voice/caller/logs, got %d", wLogs.Code)
	}
	var logsOut struct {
		Count int `json:"count"`
	}
	_ = json.Unmarshal(wLogs.Body.Bytes(), &logsOut)
	if logsOut.Count != 4 {
		t.Fatalf("expected 4 loaded call logs, got %d", logsOut.Count)
	}

	wIns := httptest.NewRecorder()
	r.ServeHTTP(wIns, httptest.NewRequest(http.MethodGet, "/voice/caller/insights", nil))
	if wIns.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on GET /voice/caller/insights, got %d", wIns.Code)
	}

	// 3. Verify POST /voice/caller/sync-contacts and Postgres persistence normalization guard
	wContacts := httptest.NewRecorder()
	contactsBody := `{"source":"ios_contacts","contacts":[{"phone_number":"+919811112222","display_name":"Ananya Rao","organization":"Acme Labs"}]}`
	r.ServeHTTP(wContacts, httptest.NewRequest(http.MethodPost, "/voice/caller/sync-contacts", bytes.NewBufferString(contactsBody)))
	if wContacts.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on POST /voice/caller/sync-contacts, got %d: %s", wContacts.Code, wContacts.Body.String())
	}
	var cResp struct {
		SyncedCount int `json:"synced_count"`
	}
	_ = json.Unmarshal(wContacts.Body.Bytes(), &cResp)
	if cResp.SyncedCount != 1 {
		t.Fatalf("expected 1 synced contact, got %+v", cResp)
	}

	var emptyIR ConversationIR
	normalizeConversationIRForPersist(&emptyIR)
	if emptyIR.DetectedLanguages == nil || len(emptyIR.DetectedLanguages) == 0 || emptyIR.Topics == nil || emptyIR.ConfidenceTier == "" || emptyIR.Recording.QualityReport.RoutingStrategy == "" {
		t.Fatalf("normalizeConversationIRForPersist failed to initialize required non-null Postgres fields: %+v", emptyIR)
	}
}
