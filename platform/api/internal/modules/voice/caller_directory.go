package voice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"
)

// CallerDirectoryProvider resolves an incoming/outgoing phone number using:
// ₹0 native sources first (Android CallScreeningService / iOS CallDirectory / device Contacts /
// Nexora local Caller Intelligence DB + user spam reports), with optional third-party lookup later.
type CallerDirectoryProvider interface {
	Resolve(ctx context.Context, userID, phone, callerNameHint, sourceHint string) CallerDirectoryEntry
}

// DefaultCallerDirectoryResolver implements the ₹0-cost local-first Caller Intelligence engine.
type DefaultCallerDirectoryResolver struct {
	Repo       Repository
	LookupURL  string
	HTTPClient *http.Client
}

func NewCallerDirectoryResolver(repo Repository) *DefaultCallerDirectoryResolver {
	return &DefaultCallerDirectoryResolver{
		Repo:       repo,
		LookupURL:  strings.TrimSpace(os.Getenv("CALLER_INTEL_WEBHOOK_URL")),
		HTTPClient: &http.Client{Timeout: 3 * time.Second},
	}
}

// HashPhoneNumber returns a privacy-preserving SHA-256 hex digest of a normalized phone number.
func HashPhoneNumber(phone string) string {
	clean := normalizePhone(phone)
	if clean == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("nexora.phone:" + clean))
	return hex.EncodeToString(sum[:])
}

// MaskPhoneNumber masks middle digits so raw numbers are never exposed unnecessarily.
func MaskPhoneNumber(phone string) string {
	clean := normalizePhone(phone)
	if len(clean) <= 4 {
		return clean
	}
	prefix := ""
	digits := clean
	if strings.HasPrefix(clean, "+") && len(clean) > 6 {
		prefix = clean[:3]
		digits = clean[3:]
	}
	if len(digits) <= 4 {
		return prefix + digits
	}
	return prefix + strings.Repeat("*", len(digits)-4) + digits[len(digits)-4:]
}

func normalizePhone(phone string) string {
	var b strings.Builder
	for i, r := range strings.TrimSpace(phone) {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else if r == '+' && i == 0 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// MergeCallerIntelligence merges a new observed identity into an existing CallerDirectoryEntry,
// computing spam pattern risk and detecting identity conflicts across sources.
func MergeCallerIntelligence(existing *CallerDirectoryEntry, incoming CallerDirectoryEntry) CallerDirectoryEntry {
	now := time.Now().UTC()
	out := CallerDirectoryEntry{
		UserID:             incoming.UserID,
		PhoneHash:          incoming.PhoneHash,
		PhoneMasked:        incoming.PhoneMasked,
		DisplayName:        strings.TrimSpace(incoming.DisplayName),
		Source:             defaultString(incoming.Source, "unknown"),
		Confidence:         incoming.Confidence,
		SpamRisk:           defaultString(incoming.SpamRisk, "low"),
		SpamReports:        incoming.SpamReports,
		SpamScore:          incoming.SpamScore,
		Company:            incoming.Company,
		BusinessCategory:   incoming.BusinessCategory,
		Organization:       incoming.Organization,
		KnownPurpose:       incoming.KnownPurpose,
		RelationshipLabel:  defaultString(incoming.RelationshipLabel, "unknown"),
		CallCount:          max(1, incoming.CallCount),
		LastCallAt:         now.Format(time.RFC3339Nano),
		ObservedIdentities: append([]ObservedIdentity{}, incoming.ObservedIdentities...),
		VoiceprintRef:      incoming.VoiceprintRef,
		UpdatedAt:          now,
	}

	if existing != nil {
		out.ObservedIdentities = append([]ObservedIdentity{}, existing.ObservedIdentities...)
		out.CallCount = max(1, existing.CallCount) + max(0, incoming.CallCount)
		out.SpamReports = max(existing.SpamReports, incoming.SpamReports)
		if existing.DisplayName != "" && out.DisplayName == "" {
			out.DisplayName = existing.DisplayName
			out.Source = existing.Source
			out.Confidence = existing.Confidence
		}
		if out.Company == "" {
			out.Company = existing.Company
		}
		if out.BusinessCategory == "" {
			out.BusinessCategory = existing.BusinessCategory
		}
		if out.Organization == "" {
			out.Organization = existing.Organization
		}
		if out.KnownPurpose == "" {
			out.KnownPurpose = existing.KnownPurpose
		}
		if out.RelationshipLabel == "unknown" && existing.RelationshipLabel != "" {
			out.RelationshipLabel = existing.RelationshipLabel
		}
		if existing.Confidence > out.Confidence && out.Source != "user_confirmed" && existing.DisplayName != "" {
			out.DisplayName = existing.DisplayName
			out.Source = existing.Source
			out.Confidence = existing.Confidence
		}
	}

	if incomingName := strings.TrimSpace(incoming.DisplayName); incomingName != "" {
		foundSame := false
		for i := range out.ObservedIdentities {
			if strings.EqualFold(out.ObservedIdentities[i].Source, out.Source) && strings.EqualFold(out.ObservedIdentities[i].Name, incomingName) {
				out.ObservedIdentities[i].SeenAt = now.Format(time.RFC3339Nano)
				out.ObservedIdentities[i].Confidence = maxFloat(out.ObservedIdentities[i].Confidence, incoming.Confidence)
				foundSame = true
				break
			}
		}
		if !foundSame {
			out.ObservedIdentities = append(out.ObservedIdentities, ObservedIdentity{
				Source:     defaultString(incoming.Source, "unknown"),
				Name:       incomingName,
				Confidence: maxFloat(0.5, incoming.Confidence),
				SeenAt:     now.Format(time.RFC3339Nano),
			})
		}
	}

	// Detect Identity Conflict when distinct normalized names appear across sources
	distinctNames := map[string]bool{}
	for _, obs := range out.ObservedIdentities {
		n := strings.ToLower(strings.TrimSpace(obs.Name))
		if n != "" {
			distinctNames[n] = true
		}
	}
	out.IdentityConflict = len(distinctNames) > 1
	out.NeedsClassification = out.DisplayName == "" || (out.RelationshipLabel == "unknown" && out.BusinessCategory == "" && out.SpamReports == 0)

	// Spam Pattern Intelligence: combine user reports + repeated unknown high-frequency calls
	score := float64(out.SpamReports) * 0.32
	if out.CallCount >= 5 && out.RelationshipLabel == "unknown" && out.DisplayName == "" {
		score += 0.28
	}
	if score > 1.0 {
		score = 1.0
	}
	out.SpamScore = score
	if out.SpamReports >= 3 || score >= 0.7 {
		out.SpamRisk = "high"
	} else if out.SpamReports >= 1 || score >= 0.3 {
		out.SpamRisk = "medium"
	} else {
		out.SpamRisk = "low"
	}

	// Infer lightweight Business Intelligence category from organization/name keywords if unset
	if out.BusinessCategory == "" && (out.Organization != "" || out.DisplayName != "") {
		lower := strings.ToLower(out.Organization + " " + out.DisplayName)
		switch {
		case strings.Contains(lower, "bank") || strings.Contains(lower, "hdfc") || strings.Contains(lower, "icici"):
			out.BusinessCategory = "financial_services"
		case strings.Contains(lower, "clinic") || strings.Contains(lower, "hospital") || strings.Contains(lower, "dr."):
			out.BusinessCategory = "healthcare"
		case strings.Contains(lower, "delivery") || strings.Contains(lower, "courier") || strings.Contains(lower, "logistics"):
			out.BusinessCategory = "delivery_logistics"
		case strings.Contains(lower, "corp") || strings.Contains(lower, "tech") || strings.Contains(lower, "solutions") || strings.Contains(lower, "vendor"):
			out.BusinessCategory = "enterprise_vendor"
		}
	}
	return out
}

func (d *DefaultCallerDirectoryResolver) Resolve(ctx context.Context, userID, phone, callerNameHint, sourceHint string) CallerDirectoryEntry {
	phoneHash := HashPhoneNumber(phone)
	phoneMasked := MaskPhoneNumber(phone)
	src := defaultString(sourceHint, "android_call_screening")

	var existing *CallerDirectoryEntry
	if d.Repo != nil && phoneHash != "" {
		if cached, ok := d.Repo.LookupCallerDirectory(ctx, userID, phoneHash); ok {
			existing = &cached
		}
	}

	// 1. If device Contacts / Android CallScreeningService / iOS CallDirectory / User provided a name, merge & persist
	if name := strings.TrimSpace(callerNameHint); name != "" {
		conf := 0.88
		if src == "user_confirmed" || src == "device_contacts" {
			conf = 0.96
		}
		merged := MergeCallerIntelligence(existing, CallerDirectoryEntry{
			UserID:      userID,
			PhoneHash:   phoneHash,
			PhoneMasked: phoneMasked,
			DisplayName: name,
			Source:      src,
			Confidence:  conf,
			CallCount:   1,
		})
		if d.Repo != nil && phoneHash != "" {
			_ = d.Repo.UpsertCallerDirectory(ctx, merged)
		}
		return merged
	}

	// 2. Return cached local Caller Intelligence entry if present
	if existing != nil {
		updated := MergeCallerIntelligence(existing, CallerDirectoryEntry{
			UserID:      userID,
			PhoneHash:   phoneHash,
			PhoneMasked: phoneMasked,
			CallCount:   1,
		})
		if d.Repo != nil && phoneHash != "" {
			_ = d.Repo.UpsertCallerDirectory(ctx, updated)
		}
		return updated
	}

	// 3. Optional external provider webhook (only if operator explicitly configures one later)
	if d.LookupURL != "" && phone != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, d.LookupURL+"?phone="+normalizePhone(phone), nil)
		if err == nil {
			if resp, doErr := d.HTTPClient.Do(req); doErr == nil {
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					var ext struct {
						Name             string  `json:"name"`
						Confidence       float64 `json:"confidence"`
						SpamRisk         string  `json:"spam_risk"`
						Company          string  `json:"company"`
						BusinessCategory string  `json:"business_category"`
					}
					if json.NewDecoder(resp.Body).Decode(&ext) == nil && strings.TrimSpace(ext.Name) != "" {
						merged := MergeCallerIntelligence(nil, CallerDirectoryEntry{
							UserID:           userID,
							PhoneHash:        phoneHash,
							PhoneMasked:      phoneMasked,
							DisplayName:      strings.TrimSpace(ext.Name),
							Source:           "external_provider",
							Confidence:       maxFloat(0.85, ext.Confidence),
							SpamRisk:         defaultString(ext.SpamRisk, "low"),
							Company:          ext.Company,
							BusinessCategory: ext.BusinessCategory,
							CallCount:        1,
						})
						if d.Repo != nil && phoneHash != "" {
							_ = d.Repo.UpsertCallerDirectory(ctx, merged)
						}
						return merged
					}
				}
			}
		}
	}

	// 4. Unknown caller -> flag needs_classification so UI prompts user post-call
	unknown := MergeCallerIntelligence(nil, CallerDirectoryEntry{
		UserID:              userID,
		PhoneHash:           phoneHash,
		PhoneMasked:         phoneMasked,
		Source:              "unknown",
		Confidence:          0.0,
		NeedsClassification: true,
		CallCount:           1,
	})
	if d.Repo != nil && phoneHash != "" {
		_ = d.Repo.UpsertCallerDirectory(ctx, unknown)
	}
	return unknown
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func defaultString(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
