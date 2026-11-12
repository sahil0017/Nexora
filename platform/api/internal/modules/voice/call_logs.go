package voice

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func normalizeCallDirection(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "inbound", "incoming", "in", "1":
		return "inbound"
	case "outbound", "outgoing", "out", "2":
		return "outbound"
	case "missed", "3":
		return "missed"
	case "rejected", "declined", "5", "6":
		return "rejected"
	case "voicemail", "4":
		return "voicemail"
	default:
		return "unknown"
	}
}

func parseFlexibleTimestamp(raw string) time.Time {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Now().UTC()
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		if n > 1e12 {
			return time.UnixMilli(n).UTC()
		}
		if n > 1e9 {
			return time.Unix(n, 0).UTC()
		}
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC()
		}
	}
	return time.Now().UTC()
}

func parseCallLogsCSV(rawCSV, defaultSource string) []ImportCallLogItem {
	reader := csv.NewReader(strings.NewReader(strings.TrimSpace(rawCSV)))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = true

	header, err := reader.Read()
	if err != nil || len(header) == 0 {
		return nil
	}
	colIdx := make(map[string]int, len(header))
	for i, h := range header {
		colIdx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	getField := func(row []string, names ...string) string {
		for _, n := range names {
			if idx, ok := colIdx[n]; ok && idx < len(row) {
				return strings.TrimSpace(row[idx])
			}
		}
		return ""
	}

	var items []ImportCallLogItem
	for {
		row, rErr := reader.Read()
		if rErr == io.EOF {
			break
		}
		if rErr != nil || len(row) == 0 {
			continue
		}
		phone := getField(row, "phone_number", "phone", "number", "caller_number")
		if normalizePhone(phone) == "" {
			continue
		}
		dur, _ := strconv.Atoi(getField(row, "duration_sec", "duration", "duration_seconds"))
		items = append(items, ImportCallLogItem{
			DeviceCallID:   getField(row, "device_call_id", "call_id", "id"),
			PhoneNumber:    phone,
			ContactName:    getField(row, "contact_name", "name", "caller_name"),
			Direction:      getField(row, "direction", "type", "call_type"),
			DurationSec:    max(0, dur),
			StartedAt:      getField(row, "started_at", "timestamp", "date", "called_at"),
			SimSlot:        getField(row, "sim_slot", "sim"),
			Source:         defaultString(getField(row, "source"), defaultSource),
			TranscriptText: getField(row, "transcript_text", "transcript", "notes"),
		})
	}
	return items
}

// ComputeCallLogInsights dynamically aggregates loaded call_logs + caller_directory into
// quantitative call metrics, top contacts, and actionable follow-up alerts.
func ComputeCallLogInsights(logs []CallLogEntry, dirEntries []CallerDirectoryEntry) CallLogInsights {
	out := CallLogInsights{
		TopContacts:    []CallLogContactSummary{},
		FollowUpAlerts: []CallLogAlert{},
		RecentLogs:     logs,
	}
	if len(logs) == 0 {
		return out
	}

	dirByHash := make(map[string]CallerDirectoryEntry, len(dirEntries))
	for _, d := range dirEntries {
		dirByHash[d.PhoneHash] = d
	}

	hourBuckets := make(map[int]int)
	contactMap := make(map[string]*CallLogContactSummary)
	unknownSet := make(map[string]bool)
	highRiskSet := make(map[string]bool)
	longUntranscribed := make(map[string]int)

	for _, l := range logs {
		out.TotalCalls++
		switch l.Direction {
		case "inbound":
			out.InboundCount++
		case "outbound":
			out.OutboundCount++
		case "missed":
			out.MissedCount++
		case "rejected":
			out.RejectedCount++
		}
		out.TotalTalkDurationSec += max(0, l.DurationSec)
		hourBuckets[l.StartedAt.UTC().Hour()]++

		c, exists := contactMap[l.PhoneHash]
		if !exists {
			dir := dirByHash[l.PhoneHash]
			name := strings.TrimSpace(l.ContactName)
			if name == "" {
				name = strings.TrimSpace(dir.DisplayName)
			}
			risk := l.SpamRisk
			if dir.SpamRisk != "" && (risk == "" || dir.SpamRisk == "high") {
				risk = dir.SpamRisk
			}
			if risk == "" {
				risk = "low"
			}
			c = &CallLogContactSummary{
				PhoneHash:   l.PhoneHash,
				PhoneMasked: l.PhoneMasked,
				DisplayName: name,
				LastCallAt:  l.StartedAt.UTC().Format(time.RFC3339Nano),
				SpamRisk:    risk,
			}
			contactMap[l.PhoneHash] = c
		} else if c.DisplayName == "" && strings.TrimSpace(l.ContactName) != "" {
			c.DisplayName = strings.TrimSpace(l.ContactName)
		}

		c.CallCount++
		if l.Direction == "missed" {
			c.MissedCount++
		}
		c.TotalDurationSec += max(0, l.DurationSec)
		if tStr := l.StartedAt.UTC().Format(time.RFC3339Nano); tStr > c.LastCallAt {
			c.LastCallAt = tStr
		}
		if c.DisplayName == "" {
			unknownSet[l.PhoneHash] = true
		}
		if c.SpamRisk == "high" {
			highRiskSet[l.PhoneHash] = true
		}
		if l.DurationSec >= 180 && l.ConversationID == "" {
			longUntranscribed[l.PhoneHash] = max(longUntranscribed[l.PhoneHash], l.DurationSec)
		}
	}

	if out.TotalCalls > 0 {
		out.AvgCallDurationSec = float64(out.TotalTalkDurationSec) / float64(out.TotalCalls)
	}
	out.UniqueContacts = len(contactMap)
	out.UnknownNumbers = len(unknownSet)
	out.HighRiskSpamCount = len(highRiskSet)

	maxHourHits := -1
	for h, cnt := range hourBuckets {
		if cnt > maxHourHits {
			maxHourHits = cnt
			out.PeakCallHourUTC = h
		}
	}

	contacts := make([]CallLogContactSummary, 0, len(contactMap))
	for _, c := range contactMap {
		contacts = append(contacts, *c)
		if c.MissedCount >= 2 {
			label := c.DisplayName
			if label == "" {
				label = c.PhoneMasked
			}
			out.FollowUpAlerts = append(out.FollowUpAlerts, CallLogAlert{
				AlertType:      "missed_repeat",
				Title:          fmt.Sprintf("%d missed calls from %s", c.MissedCount, label),
				PhoneMasked:    c.PhoneMasked,
				PhoneHash:      c.PhoneHash,
				Count:          c.MissedCount,
				Recommendation: "Call back or inspect caller relationship timeline.",
			})
		}
		if c.DisplayName == "" && c.CallCount >= 2 && c.SpamRisk != "high" {
			out.FollowUpAlerts = append(out.FollowUpAlerts, CallLogAlert{
				AlertType:      "unknown_frequent",
				Title:          fmt.Sprintf("Unclassified frequent caller %s (%d calls)", c.PhoneMasked, c.CallCount),
				PhoneMasked:    c.PhoneMasked,
				PhoneHash:      c.PhoneHash,
				Count:          c.CallCount,
				Recommendation: "Classify caller identity to update local Caller Directory.",
			})
		}
		if c.SpamRisk == "high" {
			out.FollowUpAlerts = append(out.FollowUpAlerts, CallLogAlert{
				AlertType:      "spam_burst",
				Title:          fmt.Sprintf("High-risk spam pattern detected (%s · %d calls)", c.PhoneMasked, c.CallCount),
				PhoneMasked:    c.PhoneMasked,
				PhoneHash:      c.PhoneHash,
				Count:          c.CallCount,
				Recommendation: "Block in Android CallScreeningService / iOS Call Directory.",
			})
		}
		if dur, ok := longUntranscribed[c.PhoneHash]; ok {
			out.FollowUpAlerts = append(out.FollowUpAlerts, CallLogAlert{
				AlertType:      "untranscribed_long_call",
				Title:          fmt.Sprintf("Long call (%ds) without linked Voice IR (%s)", dur, defaultString(c.DisplayName, c.PhoneMasked)),
				PhoneMasked:    c.PhoneMasked,
				PhoneHash:      c.PhoneHash,
				Count:          1,
				Recommendation: "Attach call recording or upload via Presigned S3 to extract commitments.",
			})
		}
	}

	slices.SortFunc(contacts, func(a, b CallLogContactSummary) int {
		if b.CallCount != a.CallCount {
			return b.CallCount - a.CallCount
		}
		return b.TotalDurationSec - a.TotalDurationSec
	})
	if len(contacts) > 10 {
		contacts = contacts[:10]
	}
	out.TopContacts = contacts
	if len(out.RecentLogs) > 50 {
		out.RecentLogs = out.RecentLogs[:50]
	}
	return out
}

// ImportCallLogs dynamically parses device JSON logs or CSV exports, loads rows into voice.call_logs
// and voice.caller_directory, optionally links transcripts into ConversationIR, and returns dynamic insights.
func (s *Service) ImportCallLogs(w http.ResponseWriter, r *http.Request) {
	var req ImportCallLogsRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 8*1024*1024)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid call log import payload", false)
		return
	}
	userID := resolveUserID(r, req.UserID)
	srcDefault := defaultString(req.Source, "device_call_log")

	rawItems := append([]ImportCallLogItem{}, req.Logs...)
	if strings.TrimSpace(req.RawCSV) != "" {
		rawItems = append(rawItems, parseCallLogsCSV(req.RawCSV, srcDefault)...)
	}
	if len(rawItems) == 0 {
		writeError(w, r, http.StatusBadRequest, "EMPTY_CALL_LOGS", "provide logs array or non-empty raw_csv", false)
		return
	}

	entries := make([]CallLogEntry, 0, len(rawItems))
	dirAgg := make(map[string]CallerDirectoryEntry)
	linkedConvs := 0

	for _, item := range rawItems {
		if normalizePhone(item.PhoneNumber) == "" {
			continue
		}
		pHash := HashPhoneNumber(item.PhoneNumber)
		pMasked := MaskPhoneNumber(item.PhoneNumber)
		dir := normalizeCallDirection(item.Direction)
		startedAt := parseFlexibleTimestamp(item.StartedAt)
		itemSrc := defaultString(item.Source, srcDefault)

		var existingPtr *CallerDirectoryEntry
		if cached, ok := dirAgg[pHash]; ok {
			existingPtr = &cached
		} else if loaded, ok := s.repo.LookupCallerDirectory(r.Context(), userID, pHash); ok {
			existingPtr = &loaded
		}

		incomingDir := CallerDirectoryEntry{
			UserID:      userID,
			PhoneHash:   pHash,
			PhoneMasked: pMasked,
			DisplayName: strings.TrimSpace(item.ContactName),
			Source:      itemSrc,
			CallCount:   1,
		}
		if existingPtr == nil && incomingDir.DisplayName == "" {
			incomingDir.NeedsClassification = true
		} else if incomingDir.DisplayName != "" {
			incomingDir.Confidence = 0.90
		}
		merged := MergeCallerIntelligence(existingPtr, incomingDir)
		dirAgg[pHash] = merged

		convID := ""
		if strings.TrimSpace(item.TranscriptText) != "" {
			convID = uuid.NewString()
			recID := uuid.NewString()
			ir := DeterministicFallbackProcess(userID, convID, recID, CaptureRequest{
				UserID:         userID,
				Title:          fmt.Sprintf("Call with %s", defaultString(merged.DisplayName, pMasked)),
				SourceType:     "call",
				Language:       "en",
				TranscriptText: item.TranscriptText,
				DurationMS:     max(0, item.DurationSec) * 1000,
				PhoneNumber:    item.PhoneNumber,
				CallerName:     merged.DisplayName,
				CallerSource:   merged.Source,
				CallDirection:  dir,
			})
			if _, err := s.repo.SaveConversationIR(r.Context(), ir, s.vault, "imported"); err == nil {
				linkedConvs++
			} else {
				convID = ""
			}
		}

		entries = append(entries, CallLogEntry{
			ID:             uuid.NewString(),
			UserID:         userID,
			DeviceCallID:   item.DeviceCallID,
			PhoneHash:      pHash,
			PhoneMasked:    pMasked,
			ContactName:    merged.DisplayName,
			Direction:      dir,
			DurationSec:    max(0, item.DurationSec),
			StartedAt:      startedAt,
			SimSlot:        item.SimSlot,
			Source:         itemSrc,
			ConversationID: convID,
			SpamRisk:       defaultString(merged.SpamRisk, "low"),
		})
	}

	if len(entries) == 0 {
		writeError(w, r, http.StatusBadRequest, "NO_VALID_PHONE_LOGS", "no valid phone numbers parsed from call logs", false)
		return
	}

	for _, d := range dirAgg {
		_ = s.repo.UpsertCallerDirectory(r.Context(), d)
	}
	importedCount, err := s.repo.BulkUpsertCallLogs(r.Context(), userID, entries)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "CALL_LOGS_IMPORT_ERR", err.Error(), true)
		return
	}

	allLogs, err := s.repo.ListCallLogs(r.Context(), userID, 500)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "CALL_LOGS_LIST_ERR", err.Error(), true)
		return
	}
	dirEntries, _ := s.repo.ListCallerDirectory(r.Context(), userID)
	insights := ComputeCallLogInsights(allLogs, dirEntries)

	s.invalidateAndBroadcast(r.Context(), userID, map[string]any{
		"type":            "voice.call_logs.imported",
		"imported_count":  importedCount,
		"total_calls":     insights.TotalCalls,
		"linked_convs":    linkedConvs,
		"follow_up_count": len(insights.FollowUpAlerts),
	})

	writeJSON(w, http.StatusCreated, map[string]any{
		"imported_count":       importedCount,
		"linked_conversations": linkedConvs,
		"insights":             insights,
	})
}

// ListCallLogs returns loaded historic call logs and computed insights.
func (s *Service) ListCallLogs(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	logs, err := s.repo.ListCallLogs(r.Context(), userID, limit)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "CALL_LOGS_LIST_ERR", err.Error(), true)
		return
	}
	dirEntries, _ := s.repo.ListCallerDirectory(r.Context(), userID)
	insights := ComputeCallLogInsights(logs, dirEntries)
	writeJSON(w, http.StatusOK, map[string]any{
		"logs":     logs,
		"count":    len(logs),
		"insights": insights,
	})
}

// GetCallLogInsights returns dynamically generated analytics across all historic call logs.
func (s *Service) GetCallLogInsights(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r, "")
	logs, err := s.repo.ListCallLogs(r.Context(), userID, 500)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "CALL_LOGS_INSIGHTS_ERR", err.Error(), true)
		return
	}
	dirEntries, _ := s.repo.ListCallerDirectory(r.Context(), userID)
	writeJSON(w, http.StatusOK, ComputeCallLogInsights(logs, dirEntries))
}
