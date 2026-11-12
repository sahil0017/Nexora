package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// MLClient invokes the Python FastAPI Voice Intelligence endpoints (/v1/voice/*).
type MLClient struct {
	baseURL string
	client  *http.Client
}

// NewMLClient builds a timeout-bounded HTTP client for nexora-ml.
func NewMLClient(baseURL string) *MLClient {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		return nil
	}
	return &MLClient{
		baseURL: trimmed,
		client:  &http.Client{Timeout: 6 * time.Second},
	}
}

// PostJSON posts payload to path and decodes JSON into target.
func (c *MLClient) PostJSON(ctx context.Context, path string, payload any, target any) bool {
	if c == nil || c.baseURL == "" {
		return false
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return false
	}
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return false
	}
	return true
}

// GetJSON fetches JSON from path and decodes into target.
func (c *MLClient) GetJSON(ctx context.Context, path string, target any) bool {
	if c == nil || c.baseURL == "" {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return false
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return false
	}
	return json.NewDecoder(resp.Body).Decode(target) == nil
}

var reSpeakerPrefix = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z0-9 _.-]{0,30})\s*:\s*(.+)$`)

// DeterministicFallbackProcess runs a baseline Conversation IR pipeline in Go when nexora-ml is offline.
func DeterministicFallbackProcess(userID, convID, recID string, req CaptureRequest) ConversationIR {
	now := time.Now().UTC()
	sourceType := strings.TrimSpace(req.SourceType)
	if sourceType == "" {
		sourceType = "mobile_mic"
	}
	mimeType := strings.TrimSpace(req.MimeType)
	if mimeType == "" {
		mimeType = "audio/wav"
	}
	lang := strings.TrimSpace(req.Language)
	if lang == "" {
		lang = "en"
	}
	consent := true
	if req.ConsentGranted != nil {
		consent = *req.ConsentGranted
	}
	scope := strings.TrimSpace(req.ConsentScope)
	if scope == "" {
		scope = "voice.capture"
	}

	rawSeed := req.AudioBase64
	if rawSeed == "" {
		rawSeed = req.TranscriptText
	}
	if rawSeed == "" {
		rawSeed = req.Title
	}
	sha := ComputeSHA256([]byte(rawSeed))

	type rawLine struct {
		speaker string
		text    string
	}
	var lines []rawLine
	if len(req.Turns) > 0 {
		for _, t := range req.Turns {
			txt, _ := t["text"].(string)
			txt = strings.TrimSpace(txt)
			if txt == "" {
				continue
			}
			spk, _ := t["speaker"].(string)
			if spk == "" {
				ch, _ := t["channel_hint"].(string)
				switch ch {
				case "local_mic":
					spk = "User (Local Mic)"
				case "remote_track":
					if strings.TrimSpace(req.CallerName) != "" {
						spk = strings.TrimSpace(req.CallerName)
					} else {
						spk = "Remote Caller 1"
					}
				default:
					spk = "Speaker 1"
				}
			}
			lines = append(lines, rawLine{speaker: spk, text: txt})
		}
	} else {
		for _, part := range strings.Split(req.TranscriptText, "\n") {
			clean := strings.TrimSpace(part)
			if clean == "" {
				continue
			}
			if m := reSpeakerPrefix.FindStringSubmatch(clean); len(m) == 3 {
				lines = append(lines, rawLine{speaker: strings.TrimSpace(m[1]), text: strings.TrimSpace(m[2])})
			} else {
				lines = append(lines, rawLine{speaker: "Speaker 1", text: clean})
			}
		}
	}
	if len(lines) == 0 {
		lines = append(lines, rawLine{speaker: "Speaker 1", text: "Captured voice note awaiting transcription."})
	}

	snr := req.SNRDB
	if snr == 0 {
		snr = 22.0
	}
	score := 88.0
	strategy := "direct_asr"
	if snr < 10.0 {
		score = 44.0
		strategy = "low_snr_fallback"
	} else if req.OverlapSuspected {
		score = 76.0
		strategy = "overlap_aware_diarize"
	} else if snr < 16.0 {
		score = 72.0
		strategy = "denoise_then_asr"
	}

	spkMap := map[string]*ParticipantIR{}
	var spkOrder []string
	var utterances []UtteranceIR
	var events []ConversationEventIR
	var refs []SourceEvidenceRef
	var actions []ActionSuggestionIR

	cursorMS := 0
	for idx, ln := range lines {
		key := strings.ToLower(ln.speaker)
		p, ok := spkMap[key]
		if !ok {
			lbl := fmt.Sprintf("SPK_%02d", len(spkMap)+1)
			p = &ParticipantIR{
				ParticipantID: uuid.NewSHA1(uuid.NameSpaceDNS, []byte("nexora.voice.spk."+key)).String(),
				SpeakerLabel:  lbl,
				DisplayName:   ln.speaker,
				Role:          "participant",
				VoiceprintRef: "vp:" + strings.ToLower(lbl),
			}
			spkMap[key] = p
			spkOrder = append(spkOrder, key)
		}
		words := strings.Fields(ln.text)
		durMS := max(1000, len(words)*360)
		startMS := cursorMS
		endMS := startMS + durMS
		cursorMS = endMS

		p.TalkTimeMS += durMS
		p.UtteranceCount++

		step := max(50, durMS/max(1, len(words)))
		wts := make([]WordTimestamp, 0, len(words))
		wc := startMS
		for _, w := range words {
			we := min(endMS, wc+step)
			wts = append(wts, WordTimestamp{
				Word:         w,
				StartMS:      wc,
				EndMS:        we,
				SpeakerLabel: p.SpeakerLabel,
				Confidence:   0.86,
			})
			wc = we
		}

		uttID := uuid.NewSHA1(uuid.NameSpaceDNS, []byte(fmt.Sprintf("%s:utt:%d", recID, idx))).String()
		utterances = append(utterances, UtteranceIR{
			UtteranceID:     uttID,
			RecordingID:     recID,
			SpeakerLabel:    p.SpeakerLabel,
			SeqIndex:        idx,
			StartMS:         startMS,
			EndMS:           endMS,
			OriginalText:    ln.text,
			Language:        lang,
			Confidence:      0.86,
			WordTimestamps:  wts,
			OverlapDetected: req.OverlapSuspected && idx > 0,
			AudioSegmentRef: fmt.Sprintf("%s#t=%d,%d", recID, startMS, endMS),
		})

		lower := strings.ToLower(ln.text)
		evType := ""
		dAct := "inform"
		if strings.Contains(ln.text, "?") {
			evType = "question"
			dAct = "question"
		} else if strings.Contains(lower, "disagree") || strings.Contains(lower, "concern") || strings.Contains(lower, "can't") {
			evType = "disagreement"
			dAct = "reject"
		} else if strings.Contains(lower, "decided") || strings.Contains(lower, "approved") || strings.Contains(lower, "agreed") {
			evType = "decision"
			dAct = "declaration"
		} else if strings.Contains(lower, "will ") || strings.Contains(lower, "i'll") || strings.Contains(lower, "we'll") || strings.Contains(lower, "by friday") || strings.Contains(lower, "by tomorrow") {
			evType = "commitment"
			dAct = "commissive"
		} else if strings.Contains(lower, "propose") || strings.Contains(lower, "suggest") {
			evType = "proposal"
			dAct = "offer"
		} else if strings.Contains(lower, "please") || strings.Contains(lower, "send ") || strings.Contains(lower, "share ") {
			evType = "request"
			dAct = "directive"
		}

		if evType != "" {
			evID := uuid.NewSHA1(uuid.NameSpaceDNS, []byte(convID+":ev:"+uttID)).String()
			events = append(events, ConversationEventIR{
				EventID:            evID,
				EventType:          evType,
				Summary:            ln.text,
				ActorSpeaker:       p.SpeakerLabel,
				Topic:              "general",
				DialogueAct:        dAct,
				Intent:             evType,
				Confidence:         0.84,
				SourceUtteranceIDs: []string{uttID},
				Status:             "open",
			})
			ref := SourceEvidenceRef{
				RefID:        uuid.NewSHA1(uuid.NameSpaceDNS, []byte("ref:"+evID)).String(),
				TargetKind:   "conversation_event",
				TargetID:     evID,
				UtteranceID:  uttID,
				SpeakerLabel: p.SpeakerLabel,
				StartMS:      startMS,
				EndMS:        endMS,
				Quote:        ln.text,
				Confidence:   0.84,
			}
			refs = append(refs, ref)

			if evType == "commitment" || evType == "request" || evType == "decision" || evType == "question" {
				actType := "task"
				if evType == "question" {
					actType = "follow_up"
				}
				actions = append(actions, ActionSuggestionIR{
					ActionID:         uuid.NewSHA1(uuid.NameSpaceDNS, []byte(convID+":act:"+evID)).String(),
					ActionType:       actType,
					Title:            ln.text,
					Rationale:        fmt.Sprintf("Extracted %s from %s", evType, p.SpeakerLabel),
					Confidence:       0.84,
					RequiresApproval: true,
					Status:           "suggested",
					EvidenceRefs:     []SourceEvidenceRef{ref},
				})
			}
		}
	}

	participants := make([]ParticipantIR, 0, len(spkOrder))
	for _, k := range spkOrder {
		participants = append(participants, *spkMap[k])
	}

	interactionEdges := ResolveGoInteractionDynamics(utterances, participants)

	if len(actions) == 0 {
		actions = append(actions, ActionSuggestionIR{
			ActionID:         uuid.NewSHA1(uuid.NameSpaceDNS, []byte(convID+":act:note")).String(),
			ActionType:       "note",
			Title:            "Structured conversation note: " + req.Title,
			Rationale:        "Baseline summary note for captured recording",
			Confidence:       0.82,
			RequiresApproval: true,
			Status:           "suggested",
		})
	}

	totalDur := max(cursorMS, req.DurationMS)
	return ConversationIR{
		ConversationID:    convID,
		UserID:            userID,
		Title:             req.Title,
		Summary:           fmt.Sprintf("%d utterance(s) · %d event(s) · baseline Go fallback", len(utterances), len(events)),
		Status:            "understood",
		PrimaryLanguage:   lang,
		DetectedLanguages: []string{lang},
		Topics:            []string{"general"},
		OverallConfidence: 0.84,
		ConfidenceTier:    "MEDIUM",
		CreatedAt:         now,
		UpdatedAt:         now,
		Recording: RecordingIR{
			RecordingID:  recID,
			SourceType:   sourceType,
			MimeType:     mimeType,
			SampleRateHz: 16000,
			Channels:     1,
			DurationMS:   totalDur,
			ByteSize:     int64(len(rawSeed)),
			StorageURI:   fmt.Sprintf("s3://nexora-voice-vault/%s/%s.enc", userID, recID),
			QualityReport: AudioQualityReport{
				QualityScore:    score,
				SNRDB:           snr,
				SpeechRatio:     0.78,
				NoiseFloorDBFS:  -48.0,
				RoutingStrategy: strategy,
				VadSegments: []VadSegment{
					{StartMS: 0, EndMS: totalDur, EnergyDBFS: -22.0, SpeechProb: 0.88},
				},
			},
			Integrity: IntegrityMetadata{
				SHA256Original:       sha,
				EncryptionKeyVersion: 1,
				ConsentGranted:       consent,
				ConsentScope:         scope,
			},
		},
		Participants:       participants,
		Utterances:         utterances,
		ConversationEvents: events,
		ExtractedKnowledge: ExtractedKnowledgeIR{},
		ReasoningResults:   []ReasoningResultIR{},
		ActionSuggestions:  actions,
		HumanCorrections:   []HumanCorrectionIR{},
		SourceEvidenceRefs: refs,
		InteractionEdges:   interactionEdges,
		ModelTelemetry: []ModelTelemetryIR{
			{
				Stage:         "asr",
				AdapterName:   "go-deterministic-voice-baseline-v1",
				RoutingReason: "Python ML service unavailable; deterministic Go fallback active",
				FallbackUsed:  true,
				LatencyMS:     1.2,
				Confidence:    0.84,
				CostUnits:     0.0,
			},
		},
	}
}

// ResolveGoInteractionDynamics computes who is speaking to whom and what is spoken in Go fallback mode.
func ResolveGoInteractionDynamics(utterances []UtteranceIR, participants []ParticipantIR) []InteractionEdgeIR {
	nameByLbl := make(map[string]string, len(participants))
	lblByFirst := make(map[string]string, len(participants))
	for _, p := range participants {
		nameByLbl[p.SpeakerLabel] = p.DisplayName
		fields := strings.Fields(strings.ToLower(p.DisplayName))
		if len(fields) > 0 && len(fields[0]) >= 2 && fields[0] != "speaker" {
			lblByFirst[fields[0]] = p.SpeakerLabel
		}
	}

	type acc struct {
		edge InteractionEdgeIR
		seen map[string]bool
	}
	edgeMap := map[string]*acc{}
	var edgeOrder []string

	for i := range utterances {
		u := &utterances[i]
		lower := strings.ToLower(u.OriginalText)
		tokens := strings.Fields(strings.NewReplacer(",", " ", ".", " ", "?", " ", "!", " ", ":", " ").Replace(lower))
		var vocative []string
		for _, tok := range tokens {
			if targetLbl, ok := lblByFirst[tok]; ok && targetLbl != u.SpeakerLabel {
				vocative = append(vocative, targetLbl)
			}
		}

		var prev *UtteranceIR
		if i > 0 && utterances[i-1].SpeakerLabel != u.SpeakerLabel {
			prev = &utterances[i-1]
		}

		if len(vocative) > 0 {
			u.ToSpeakers = vocative
			u.AddressingMode = "direct_vocative"
			for j := i - 1; j >= 0; j-- {
				if utterances[j].SpeakerLabel == vocative[0] {
					u.AddressedUtteranceID = utterances[j].UtteranceID
					break
				}
			}
		} else if prev != nil {
			u.ToSpeakers = []string{prev.SpeakerLabel}
			u.AddressingMode = "reply_to_previous"
			u.AddressedUtteranceID = prev.UtteranceID
		} else {
			u.ToSpeakers = []string{"ALL"}
			u.AddressingMode = "group_broadcast"
		}

		fromName := nameByLbl[u.SpeakerLabel]
		if fromName == "" {
			fromName = u.SpeakerLabel
		}
		toNames := make([]string, 0, len(u.ToSpeakers))
		for _, tl := range u.ToSpeakers {
			if tl == "ALL" {
				toNames = append(toNames, "All Participants")
			} else if tn := nameByLbl[tl]; tn != "" {
				toNames = append(toNames, tn)
			} else {
				toNames = append(toNames, tl)
			}
		}
		act := "statement"
		if strings.Contains(u.OriginalText, "?") {
			act = "question"
		} else if strings.Contains(lower, "propose") || strings.Contains(lower, "suggest") {
			act = "proposal"
		} else if strings.Contains(lower, "will ") || strings.Contains(lower, "agreed") {
			act = "commitment"
		} else if strings.Contains(lower, "disagree") || strings.Contains(lower, "concern") {
			act = "disagreement"
		}
		u.WhatIsSpoken = fmt.Sprintf("%s -> %s: %s (%s)", fromName, strings.Join(toNames, ", "), act, u.OriginalText)
		if len(u.WhatIsSpoken) > 140 {
			u.WhatIsSpoken = u.WhatIsSpoken[:137] + "..."
		}

		for _, tl := range u.ToSpeakers {
			key := u.SpeakerLabel + "->" + tl
			a, ok := edgeMap[key]
			if !ok {
				toName := "All Participants"
				if tl != "ALL" && nameByLbl[tl] != "" {
					toName = nameByLbl[tl]
				}
				a = &acc{
					edge: InteractionEdgeIR{
						FromSpeaker: u.SpeakerLabel,
						FromName:    fromName,
						ToSpeaker:   tl,
						ToName:      toName,
						LastTopic:   "general",
					},
					seen: map[string]bool{},
				}
				edgeMap[key] = a
				edgeOrder = append(edgeOrder, key)
			}
			a.edge.TurnCount++
			a.edge.SampleSummary = u.WhatIsSpoken
			if !a.seen[act] {
				a.seen[act] = true
				a.edge.PrimaryActs = append(a.edge.PrimaryActs, act)
			}
		}
	}

	total := max(1, len(utterances))
	out := make([]InteractionEdgeIR, 0, len(edgeOrder))
	for _, k := range edgeOrder {
		e := edgeMap[k].edge
		e.Strength = float64(e.TurnCount) / float64(total)
		out = append(out, e)
	}
	return out
}
