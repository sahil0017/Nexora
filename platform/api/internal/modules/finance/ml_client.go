package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// MLClient invokes the Python FastAPI Finance Intelligence endpoints (/v1/finance/*).
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
		client:  &http.Client{Timeout: 4 * time.Second},
	}
}

// PostJSON posts JSON payload to path and decodes the response map.
func (c *MLClient) PostJSON(ctx context.Context, path string, payload any) (map[string]any, bool) {
	if c == nil || c.baseURL == "" {
		return nil, false
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, false
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, false
	}
	return out, true
}
