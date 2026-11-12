// Package finance implements the NEXORA Financial Intelligence Network control plane.
package finance

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// EnvelopeVault provides per-user AES-256-GCM envelope encryption, keyed HMAC-SHA256
// blind indexing, and LLM Privacy Firewall pseudonymization.
type EnvelopeVault struct {
	masterKey []byte
}

// NewEnvelopeVault initializes the anti-spy cryptographic vault.
func NewEnvelopeVault(secret string) *EnvelopeVault {
	if strings.TrimSpace(secret) == "" {
		secret = "nexora-finance-default-kms-envelope-seed-v1"
	}
	sum := sha256.Sum256([]byte(secret))
	return &EnvelopeVault{masterKey: sum[:]}
}

func (v *EnvelopeVault) userDEK(userID string) []byte {
	mac := hmac.New(sha256.New, v.masterKey)
	mac.Write([]byte("dek:" + userID))
	return mac.Sum(nil)
}

// EncryptField encrypts sensitive plaintext using the user's derived AES-256-GCM DEK.
func (v *EnvelopeVault) EncryptField(userID, plaintext string) ([]byte, error) {
	if plaintext == "" {
		return nil, nil
	}
	block, err := aes.NewCipher(v.userDEK(userID))
	if err != nil {
		return nil, fmt.Errorf("aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("aes gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("nonce: %w", err)
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), []byte(userID)), nil
}

// DecryptField decrypts ciphertext produced by EncryptField.
func (v *EnvelopeVault) DecryptField(userID string, ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", nil
	}
	block, err := aes.NewCipher(v.userDEK(userID))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce := ciphertext[:gcm.NonceSize()]
	enc := ciphertext[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, enc, []byte(userID))
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// BlindIndex computes a keyed HMAC-SHA256 digest for exact-match lookups on encrypted fields.
func (v *EnvelopeVault) BlindIndex(userID, normalizedValue string) string {
	val := strings.ToLower(strings.TrimSpace(normalizedValue))
	if val == "" {
		return ""
	}
	mac := hmac.New(sha256.New, v.masterKey)
	mac.Write([]byte("blind:" + userID + ":" + val))
	return hex.EncodeToString(mac.Sum(nil))
}

// MaskVPA masks a UPI VPA so raw identifiers never appear in logs or UI lists.
func MaskVPA(vpa string) string {
	vpa = strings.TrimSpace(vpa)
	idx := strings.IndexByte(vpa, '@')
	if idx <= 0 {
		return "***"
	}
	prefix := vpa[:1]
	if idx >= 2 {
		prefix = vpa[:2]
	}
	return prefix + "***" + vpa[idx:]
}

var (
	rePAN     = regexp.MustCompile(`(?i)\b[A-Z]{5}[0-9]{4}[A-Z]\b`)
	reAadhaar = regexp.MustCompile(`\b[0-9]{4}\s?[0-9]{4}\s?[0-9]{4}\b`)
	reVPA     = regexp.MustCompile(`\b[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}\b`)
	reAcctNum = regexp.MustCompile(`\b[0-9]{9,18}\b`)
)

// ScrubPromptPII strips PAN, Aadhaar, UPI VPAs, emails, and raw account numbers before LLM calls.
func ScrubPromptPII(input string) (string, int) {
	redacted := input
	count := 0
	for _, item := range []struct {
		re    *regexp.Regexp
		token string
	}{
		{rePAN, "[PAN_REDACTED]"},
		{reAadhaar, "[AADHAAR_REDACTED]"},
		{reVPA, "[VPA_OR_EMAIL_REDACTED]"},
		{reAcctNum, "[ACCT_OR_PHONE_REDACTED]"},
	} {
		matches := item.re.FindAllStringIndex(redacted, -1)
		if len(matches) > 0 {
			count += len(matches)
			redacted = item.re.ReplaceAllString(redacted, item.token)
		}
	}
	return redacted, count
}
