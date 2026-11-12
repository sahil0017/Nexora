package voice

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

// S3Presigner generates AWS Signature V4 presigned PUT/GET URLs for S3 or
// S3-compatible object storage (MinIO/R2), falling back to a signed local
// upload URL when S3 credentials/bucket are not configured in development.
type S3Presigner struct {
	Bucket    string
	Region    string
	Endpoint  string
	AccessKey string
	SecretKey string
	LocalSign string
}

// NewS3PresignerFromEnv loads S3 configuration from environment variables.
func NewS3PresignerFromEnv(localSecret string) *S3Presigner {
	bucket := strings.TrimSpace(os.Getenv("VOICE_S3_BUCKET"))
	if bucket == "" {
		bucket = strings.TrimSpace(os.Getenv("S3_BUCKET"))
	}
	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	if region == "" {
		region = "ap-south-1"
	}
	return &S3Presigner{
		Bucket:    bucket,
		Region:    region,
		Endpoint:  strings.TrimRight(strings.TrimSpace(os.Getenv("VOICE_S3_ENDPOINT")), "/"),
		AccessKey: strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID")),
		SecretKey: strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY")),
		LocalSign: localSecret,
	}
}

// IsS3Configured reports whether real AWS/S3 SigV4 signing credentials are present.
func (s *S3Presigner) IsS3Configured() bool {
	return s != nil && s.Bucket != "" && s.AccessKey != "" && s.SecretKey != ""
}

// ObjectKey builds the canonical S3 object key for a voice recording.
func (s *S3Presigner) ObjectKey(userID, conversationID, recordingID, ext string) string {
	cleanExt := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(ext)), ".")
	if cleanExt == "" {
		cleanExt = "wav"
	}
	return fmt.Sprintf("voice/%s/%s/%s.%s", userID, conversationID, recordingID, cleanExt)
}

// PresignPut generates a presigned PUT URL (S3 SigV4 or signed local dev fallback).
func (s *S3Presigner) PresignPut(objectKey, mimeType string, expires time.Duration) (uploadURL, bucket, storageURI, mode string) {
	if expires <= 0 {
		expires = 15 * time.Minute
	}
	if !s.IsS3Configured() {
		bucket = "nexora-local-voice-vault"
		storageURI = fmt.Sprintf("s3://%s/%s", bucket, objectKey)
		exp := time.Now().UTC().Add(expires).Unix()
		sig := s.localSignature("PUT", objectKey, exp)
		uploadURL = fmt.Sprintf("/api/v1/voice/recordings/local-upload?key=%s&exp=%d&sig=%s",
			url.QueryEscape(objectKey), exp, sig)
		return uploadURL, bucket, storageURI, "local_signed_fallback"
	}
	bucket = s.Bucket
	storageURI = fmt.Sprintf("s3://%s/%s", bucket, objectKey)
	uploadURL = s.signSigV4("PUT", objectKey, expires, time.Now().UTC())
	return uploadURL, bucket, storageURI, "s3_sigv4"
}

// PresignGet generates a presigned GET URL for verified playback/export.
func (s *S3Presigner) PresignGet(objectKey string, expires time.Duration) (downloadURL, mode string) {
	if expires <= 0 {
		expires = 10 * time.Minute
	}
	if !s.IsS3Configured() {
		exp := time.Now().UTC().Add(expires).Unix()
		sig := s.localSignature("GET", objectKey, exp)
		return fmt.Sprintf("/api/v1/voice/recordings/local-download?key=%s&exp=%d&sig=%s",
			url.QueryEscape(objectKey), exp, sig), "local_signed_fallback"
	}
	return s.signSigV4("GET", objectKey, expires, time.Now().UTC()), "s3_sigv4"
}

func (s *S3Presigner) localSignature(method, key string, exp int64) string {
	mac := hmac.New(sha256.New, []byte(s.LocalSign))
	_, _ = mac.Write([]byte(fmt.Sprintf("%s|%s|%d", method, key, exp)))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *S3Presigner) VerifyLocalSignature(method, key string, exp int64, sig string) bool {
	if time.Now().UTC().Unix() > exp {
		return false
	}
	expected := s.localSignature(method, key, exp)
	return hmac.Equal([]byte(expected), []byte(sig))
}

func (s *S3Presigner) signSigV4(method, objectKey string, expires time.Duration, now time.Time) string {
	host := fmt.Sprintf("%s.s3.%s.amazonaws.com", s.Bucket, s.Region)
	scheme := "https"
	pathPrefix := "/"
	if s.Endpoint != "" {
		if parsed, err := url.Parse(s.Endpoint); err == nil && parsed.Host != "" {
			scheme = parsed.Scheme
			host = parsed.Host
			pathPrefix = "/" + s.Bucket + "/"
		}
	}
	escapedKey := strings.ReplaceAll(url.PathEscape(objectKey), "%2F", "/")
	canonicalURI := pathPrefix + strings.TrimPrefix(escapedKey, "/")

	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, s.Region)
	expSec := int64(expires.Seconds())

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", s.AccessKey+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", expSec))
	q.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := q.Encode()

	canonicalHeaders := "host:" + host + "\n"
	canonicalReq := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")

	sum := sha256.Sum256([]byte(canonicalReq))
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hex.EncodeToString(sum[:]),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+s.SecretKey), dateStamp)
	kRegion := hmacSHA256(kDate, s.Region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	return fmt.Sprintf("%s://%s%s?%s&X-Amz-Signature=%s", scheme, host, canonicalURI, canonicalQuery, signature)
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}
