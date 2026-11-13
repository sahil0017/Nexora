package privacy

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestPrivacyPermissionsLifecycle(t *testing.T) {
	r := chi.NewRouter()
	Mount(r, NewHandler(nil))

	// 1. Initial GET returns empty & consent_configured = false
	req := httptest.NewRequest(http.MethodGet, "/privacy/permissions?user_id=u1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	// 2. PUT permissions stores rows + audit entries
	payload := map[string]any{
		"user_id": "u1",
		"source":  "mobile_app",
		"permissions": []map[string]any{
			{"permission_key": "gpsLocation", "domain": "Mobility", "granted": true, "os_status": "granted"},
			{"permission_key": "healthDeviceSensors", "domain": "Health", "granted": true, "os_status": "granted"},
		},
	}
	body, _ := json.Marshal(payload)
	putReq := httptest.NewRequest(http.MethodPut, "/privacy/permissions", bytes.NewReader(body))
	putRec := httptest.NewRecorder()
	r.ServeHTTP(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on PUT, got %d: %s", putRec.Code, putRec.Body.String())
	}

	// 3. GET permissions returns consent_configured = true and 2 items
	getReq := httptest.NewRequest(http.MethodGet, "/privacy/permissions?user_id=u1", nil)
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	var getOut struct {
		ConsentConfigured bool             `json:"consent_configured"`
		Permissions       []PermissionItem `json:"permissions"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &getOut); err != nil {
		t.Fatalf("unmarshal GET: %v", err)
	}
	if !getOut.ConsentConfigured || len(getOut.Permissions) != 2 {
		t.Fatalf("expected consent_configured=true and 2 permissions, got %+v", getOut)
	}

	// 4. GET audit returns 2 audit entries
	audReq := httptest.NewRequest(http.MethodGet, "/privacy/audit?user_id=u1", nil)
	audRec := httptest.NewRecorder()
	r.ServeHTTP(audRec, audReq)
	var audOut struct {
		Audit []AuditItem `json:"audit"`
	}
	if err := json.Unmarshal(audRec.Body.Bytes(), &audOut); err != nil {
		t.Fatalf("unmarshal audit: %v", err)
	}
	if len(audOut.Audit) != 2 {
		t.Fatalf("expected 2 audit entries, got %d", len(audOut.Audit))
	}
}
