package health

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func setupHealthRouter() chi.Router {
	r := chi.NewRouter()
	svc := NewService(NewMemoryRepository(), NewMLClient(""), nil)
	Mount(r, svc)
	return r
}

func TestDeviceCapabilitiesAndSubmodules(t *testing.T) {
	r := setupHealthRouter()
	for _, path := range []string{"/health/devices/capabilities", "/health/submodules"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s expected 200, got %d", path, rec.Code)
		}
	}
}

func TestIngestLocalFeaturesAndFallbackStatus(t *testing.T) {
	r := setupHealthRouter()
	payload := SensorIngestRequest{
		UserID:         "user-1",
		IdempotencyKey: "batch-001",
		SourceDevice:   "iphone_imu",
		HardwareTier:   "consumer_phone_sensors",
		SampleRateHz:   25,
		IsSimulated:    false,
		ExtractedFeatures: map[string]ProvenancedFeature{
			"device_orientation": {
				Name:  "device_orientation",
				Value: "face_up_supine_proxy",
				Unit:  "category",
				Provenance: FeatureProvenance{
					SourceDevice:       "iphone_imu",
					SignalSource:       "phone_imu",
					SamplingRateHz:     25,
					SignalQualityScore: 0.85,
					MeasurementStatus:  "measured",
					AlgorithmVersion:   "mobile_local_v2",
				},
			},
		},
	}
	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/health/features/ingest?sync=true", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var stream SensorStreamRecord
	if err := json.Unmarshal(rec.Body.Bytes(), &stream); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !stream.IsFallback {
		t.Fatalf("expected IsFallback=true when ML service URL is empty")
	}
	if stream.Features["device_orientation"].Value != "face_up_supine_proxy" {
		t.Fatalf("unexpected orientation: %v", stream.Features["device_orientation"].Value)
	}

	// Async event-driven queue ingestion + idempotency deduplication
	qReq1 := httptest.NewRequest(http.MethodPost, "/health/features/ingest", bytes.NewReader(raw))
	qRec1 := httptest.NewRecorder()
	r.ServeHTTP(qRec1, qReq1)
	if qRec1.Code != http.StatusAccepted {
		t.Fatalf("expected 202 Accepted for async queue, got %d", qRec1.Code)
	}
	qReq2 := httptest.NewRequest(http.MethodPost, "/health/features/ingest", bytes.NewReader(raw))
	qRec2 := httptest.NewRecorder()
	r.ServeHTTP(qRec2, qReq2)
	var qBody map[string]any
	_ = json.Unmarshal(qRec2.Body.Bytes(), &qBody)
	if qBody["queue_status"] != "deduplicated" {
		t.Fatalf("expected deduplicated status on duplicate idempotency_key, got %v", qBody["queue_status"])
	}

	statsReq := httptest.NewRequest(http.MethodGet, "/health/queue/stats", nil)
	statsRec := httptest.NewRecorder()
	r.ServeHTTP(statsRec, statsReq)
	if statsRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on queue stats, got %d", statsRec.Code)
	}
}

func TestResearchInferenceAndValidationLifecycle(t *testing.T) {
	r := setupHealthRouter()
	eeg := 0.46
	n3 := 0.24
	ppg := 0.78
	rmssd := 54.0
	sessReq := SleepClearanceRequest{
		UserID:              "user-1",
		CohortID:            "cohort-alpha",
		ModelStage:          "M1",
		HardwareTier:        "clinical_eeg_ppg_resp",
		EegDeltaRatio:       &eeg,
		N3Fraction:          &n3,
		PpgPulsatilityIndex: &ppg,
		HrvRmssdMs:          &rmssd,
		DeviceOrientation:   "lateral_right_proxy",
		SignalQualityScore:  0.91,
	}
	raw, _ := json.Marshal(sessReq)
	req := httptest.NewRequest(http.MethodPost, "/health/research/sleep-sessions", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var sess SleepClearanceSession
	if err := json.Unmarshal(rec.Body.Bytes(), &sess); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sess.ValidationStatus != "fallback_estimate" {
		t.Fatalf("expected fallback_estimate status when ML offline, got %s", sess.ValidationStatus)
	}
	if sess.ResearchEstimate.Target != "sleep_physiology_state" {
		t.Fatalf("expected sleep_physiology_state target, got %s", sess.ResearchEstimate.Target)
	}

	valPayload := CohortValidationRequest{
		SurrogateTarget: "dti_alps_index",
		Predicted:       []float64{1.2, 1.3, 1.4, 1.5, 1.6, 1.35, 1.45, 1.55, 1.25, 1.42},
		MriReference:    []float64{1.21, 1.29, 1.42, 1.48, 1.59, 1.34, 1.46, 1.54, 1.26, 1.41},
	}
	valRaw, _ := json.Marshal(valPayload)
	valReq := httptest.NewRequest(http.MethodPost, "/health/research/validate", bytes.NewReader(valRaw))
	valRec := httptest.NewRecorder()
	r.ServeHTTP(valRec, valReq)
	if valRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", valRec.Code)
	}
	var valRes CohortValidationResult
	if err := json.Unmarshal(valRec.Body.Bytes(), &valRes); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !valRes.ValidationPassed || valRes.IccFormulation == "" {
		t.Fatalf("expected validation pass with documented ICC formulation, got %+v", valRes)
	}
}

func TestRawObservationPresignCompleteAndConsentRevoke(t *testing.T) {
	r := setupHealthRouter()

	// Without explicit health_research_telemetry consent -> 403
	badBody, _ := json.Marshal(RawObservationPresignRequest{UserID: "u1", ConsentScope: "phone_imu_only"})
	badReq := httptest.NewRequest(http.MethodPost, "/health/observations/presign", bytes.NewReader(badBody))
	badRec := httptest.NewRecorder()
	r.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without research consent, got %d", badRec.Code)
	}

	// With consent -> 200
	goodBody, _ := json.Marshal(RawObservationPresignRequest{UserID: "u1", ConsentScope: "health_research_telemetry"})
	goodReq := httptest.NewRequest(http.MethodPost, "/health/observations/presign", bytes.NewReader(goodBody))
	goodRec := httptest.NewRecorder()
	r.ServeHTTP(goodRec, goodReq)
	if goodRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", goodRec.Code)
	}
	var presign RawObservationPresignResponse
	_ = json.Unmarshal(goodRec.Body.Bytes(), &presign)

	// Complete observation
	compBody, _ := json.Marshal(RawObservationRecord{
		ObservationID:     presign.ObservationID,
		UserID:            "u1",
		S3ObjectKey:       presign.S3ObjectKey,
		Sha256Ciphertext:  "abc123",
		SampleCount:       750,
		SampleRateHz:      25,
		DeviceTimestampMs: 1700000000000,
		MonotonicMs:       123456,
		SyncUncertaintyMs: 12,
		ConsentScope:      "health_research_telemetry",
	})
	compReq := httptest.NewRequest(http.MethodPost, "/health/observations/complete", bytes.NewReader(compBody))
	compRec := httptest.NewRecorder()
	r.ServeHTTP(compRec, compReq)
	if compRec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", compRec.Code)
	}

	// Revoke consent -> marks observation revoked
	revBody, _ := json.Marshal(ConsentRevokeRequest{UserID: "u1", ConsentScope: "health_research_telemetry"})
	revReq := httptest.NewRequest(http.MethodPost, "/health/consent/revoke", bytes.NewReader(revBody))
	revRec := httptest.NewRecorder()
	r.ServeHTTP(revRec, revReq)
	if revRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", revRec.Code)
	}
	var revRes map[string]any
	_ = json.Unmarshal(revRec.Body.Bytes(), &revRes)
	if revRes["revoked_observations"] != float64(1) {
		t.Fatalf("expected 1 revoked observation, got %v", revRes["revoked_observations"])
	}
	if revRes["erasure_status"] != "completed" {
		t.Fatalf("expected erasure_status=completed, got %v", revRes["erasure_status"])
	}
}

func TestAllDataModelsPopulatedAndTelemetry(t *testing.T) {
	r := chi.NewRouter()
	svc := NewService(NewMemoryRepository(), NewMLClient(""), nil)
	Mount(r, svc)
	defer svc.queue.Close()

	// 1. Register device
	devBody, _ := json.Marshal(SensorDeviceRecord{
		DeviceID:     "dev-ios-01",
		UserID:       "u-model-test",
		SignalSource: "healthkit",
		Capabilities: []string{"ppg_pulsatility", "hrv_ibi"},
	})
	devReq := httptest.NewRequest(http.MethodPost, "/health/devices/register", bytes.NewReader(devBody))
	devRec := httptest.NewRecorder()
	r.ServeHTTP(devRec, devReq)
	if devRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 for device register, got %d", devRec.Code)
	}

	// 2. Grant consent
	grantBody, _ := json.Marshal(ConsentGrantRequest{UserID: "u-model-test", ConsentScope: "health_device_sensors"})
	grantReq := httptest.NewRequest(http.MethodPost, "/health/consent/grant", bytes.NewReader(grantBody))
	grantRec := httptest.NewRecorder()
	r.ServeHTTP(grantRec, grantReq)
	if grantRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for consent grant, got %d", grantRec.Code)
	}

	// 3. Synchronous feature ingest (populates device, session, features, outbox)
	ingBody, _ := json.Marshal(SensorIngestRequest{
		UserID:       "u-model-test",
		SourceDevice: "dev-ios-01",
		HardwareTier: "wearable_ppg",
		SampleRateHz: 25,
		Frames:       []SensorFrame{{TimestampMs: 1000, Ax: 0.01, Ay: 0.02, Az: 9.81}},
	})
	ingReq := httptest.NewRequest(http.MethodPost, "/health/features/ingest?sync=true", bytes.NewReader(ingBody))
	ingRec := httptest.NewRecorder()
	r.ServeHTTP(ingRec, ingReq)
	if ingRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 for sync ingest, got %d", ingRec.Code)
	}

	// 4. Cohort validation (persists health_validation_runs + audit log + outbox)
	valBody, _ := json.Marshal(CohortValidationRequest{
		SurrogateTarget: "dti_alps_index",
		Predicted:       []float64{1.2, 1.35, 1.5, 1.65},
		MriReference:    []float64{1.22, 1.34, 1.48, 1.62},
	})
	valReq := httptest.NewRequest(http.MethodPost, "/health/research/validate", bytes.NewReader(valBody))
	valRec := httptest.NewRecorder()
	r.ServeHTTP(valRec, valReq)
	if valRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for validate, got %d", valRec.Code)
	}

	// 5. Verify validation history endpoint
	histReq := httptest.NewRequest(http.MethodGet, "/health/research/validations", nil)
	histRec := httptest.NewRecorder()
	r.ServeHTTP(histRec, histReq)
	if histRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for validation history, got %d", histRec.Code)
	}

	// 6. Verify telemetry summary reflects populated models
	telReq := httptest.NewRequest(http.MethodGet, "/health/telemetry", nil)
	telRec := httptest.NewRecorder()
	r.ServeHTTP(telRec, telReq)
	if telRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for telemetry, got %d", telRec.Code)
	}
	var tel TelemetrySummary
	_ = json.Unmarshal(telRec.Body.Bytes(), &tel)
	if tel.DevicesCount < 1 || tel.SessionsCount < 1 || tel.ValidationsCount < 1 || tel.OutboxDispatched < 1 {
		t.Fatalf("expected all model counts >= 1, got %+v", tel)
	}
}
