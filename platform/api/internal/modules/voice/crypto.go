package voice

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
)

// VoiceVault implements Workstream 9 cryptographic preservation, tamper-evident
// HMAC sealing, Merkle roots over utterances, chain-of-custody verification, and PII scrubbing.
type VoiceVault struct {
	masterKey []byte
}

// NewVoiceVault initializes a deterministic/KMS-seeded vault for Voice Evidence.
func NewVoiceVault(secret string) *VoiceVault {
	if strings.TrimSpace(secret) == "" {
		secret = "nexora-voice-evidence-vault-seed-v1"
	}
	sum := sha256.Sum256([]byte(secret))
	return &VoiceVault{masterKey: sum[:]}
}

// ComputeSHA256 returns the lowercase hex SHA-256 digest of raw bytes/text.
func ComputeSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// SealRecording computes an HMAC-SHA256 integrity seal binding user, recording, and SHA-256 hash.
func (v *VoiceVault) SealRecording(userID, recordingID, sha256Original string) string {
	mac := hmac.New(sha256.New, v.masterKey)
	mac.Write([]byte(fmt.Sprintf("voice:seal:%s:%s:%s", userID, recordingID, sha256Original)))
	return hex.EncodeToString(mac.Sum(nil))
}

// ComputeUtteranceMerkleRoot computes a binary Merkle root over ordered utterance texts/IDs.
func ComputeUtteranceMerkleRoot(utterances []UtteranceIR) string {
	if len(utterances) == 0 {
		return ComputeSHA256([]byte("empty-utterance-tree"))
	}
	layer := make([]string, len(utterances))
	for i, u := range utterances {
		layer[i] = ComputeSHA256([]byte(fmt.Sprintf("%s|%s|%d|%d|%s", u.UtteranceID, u.SpeakerLabel, u.StartMS, u.EndMS, u.OriginalText)))
	}
	for len(layer) > 1 {
		var next []string
		for i := 0; i < len(layer); i += 2 {
			left := layer[i]
			right := left
			if i+1 < len(layer) {
				right = layer[i+1]
			}
			next = append(next, ComputeSHA256([]byte(left+":"+right)))
		}
		layer = next
	}
	return layer[0]
}

// ComputeCustodyHash links a new custody event to the previous event hash.
func (v *VoiceVault) ComputeCustodyHash(evidenceID, conversationID, actorID, action, prevHash, occurredAt string) string {
	mac := hmac.New(sha256.New, v.masterKey)
	mac.Write([]byte(fmt.Sprintf("%s|%s|%s|%s|%s|%s", evidenceID, conversationID, actorID, action, prevHash, occurredAt)))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyCustodyChain validates every hash link in an ordered custody event slice.
func (v *VoiceVault) VerifyCustodyChain(events []CustodyEvent) bool {
	if len(events) == 0 {
		return false
	}
	expectedPrev := "GENESIS"
	for _, ev := range events {
		if ev.PrevHash != expectedPrev {
			return false
		}
		recomputed := v.ComputeCustodyHash(ev.EvidenceID, ev.ConversationID, ev.ActorID, ev.EventAction, ev.PrevHash, ev.OccurredAt)
		if ev.EventHash != recomputed {
			return false
		}
		expectedPrev = ev.EventHash
	}
	return true
}

var (
	reVoicePAN   = regexp.MustCompile(`\b[A-Z]{5}[0-9]{4}[A-Z]\b`)
	reVoicePhone = regexp.MustCompile(`\b(?:\+91[-\s]?)?[6-9][0-9]{9}\b`)
	reVoiceEmail = regexp.MustCompile(`\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b`)
)

// ScrubVoicePII masks sensitive identifiers before sending text to external/cloud model adapters.
func ScrubVoicePII(text string) (string, int) {
	redacted := text
	count := 0
	for _, pair := range []struct {
		re  *regexp.Regexp
		tok string
	}{
		{reVoicePAN, "[PAN_REDACTED]"},
		{reVoiceEmail, "[EMAIL_REDACTED]"},
		{reVoicePhone, "[PHONE_REDACTED]"},
	} {
		matches := pair.re.FindAllStringIndex(redacted, -1)
		if len(matches) > 0 {
			count += len(matches)
			redacted = pair.re.ReplaceAllString(redacted, pair.tok)
		}
	}
	return redacted, count
}
