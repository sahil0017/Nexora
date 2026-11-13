package health

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Service orchestrates the separated NEXORA Health pipelines:
// 1. Sensor measurement & provenance
// 2. Staged research inference
// 3. Clinical-reference validation
type Service struct {
	repo   Repository
	ml     *MLClient
	queue  *IngestQueue
	logger *slog.Logger
}

func NewService(repo Repository, ml *MLClient, logger *slog.Logger) *Service {
	if repo == nil {
		repo = NewMemoryRepository()
	}
	if ml == nil {
		ml = NewMLClient("")
	}
	if logger == nil {
		logger = slog.Default()
	}
	svc := &Service{repo: repo, ml: ml, logger: logger}
	svc.queue = NewIngestQueue(svc, 256, 2, logger)
	return svc
}

// Mount registers both lifecycle-oriented /api/v1/health/* routes and compatibility aliases.
func Mount(r chi.Router, svc *Service) {
	r.Route("/health", func(hr chi.Router) {
		// Lifecycle API
		hr.Get("/devices/capabilities", svc.handleDeviceCapabilities)
		hr.Post("/devices/register", svc.handleRegisterDevice)
		hr.Get("/devices", svc.handleListDevices)
		hr.Post("/features/ingest", svc.handleIngestSensors)
		hr.Get("/features/latest", svc.handleLatestSensors)
		hr.Post("/research/sleep-sessions", svc.handleCreateSleepSession)
		hr.Get("/research/sleep-sessions", svc.handleListSleepSessions)
		hr.Post("/references/measurements", svc.handleCreateMriReference)
		hr.Get("/references/measurements", svc.handleListMriReferences)
		hr.Post("/research/validate", svc.handleValidateCohort)
		hr.Get("/research/validations", svc.handleListValidationRuns)
		hr.Post("/observations/presign", svc.handlePresignRawObservation)
		hr.Post("/observations/complete", svc.handleCompleteRawObservation)
		hr.Post("/consent/grant", svc.handleGrantConsent)
		hr.Post("/consent/revoke", svc.handleRevokeConsent)
		hr.Get("/queue/stats", svc.handleQueueStats)
		hr.Get("/telemetry", svc.handleTelemetry)

		// Compatibility routes
		hr.Get("/submodules", svc.handleListSubmodules)
		hr.Post("/sensors/ingest", svc.handleIngestSensors)
		hr.Get("/sensors/latest", svc.handleLatestSensors)
		hr.Post("/sleep-clearance/sessions", svc.handleCreateSleepSession)
		hr.Get("/sleep-clearance/sessions", svc.handleListSleepSessions)
		hr.Post("/mri-references", svc.handleCreateMriReference)
		hr.Get("/mri-references", svc.handleListMriReferences)
		hr.Post("/sleep-clearance/validate", svc.handleValidateCohort)
		hr.Get("/sleep-clearance/validations", svc.handleListValidationRuns)
	})
}

func (s *Service) handleDeviceCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"capabilities": map[string][]string{
			"phone_imu":        {"device_orientation", "actigraphy", "experimental_respiration_motion"},
			"wearable_ppg":     {"ppg_pulsatility", "pulse_rate", "hrv_ibi"},
			"wearable_ecg":     {"ecg_r_peaks", "heart_rate", "hrv_rmssd"},
			"eeg":              {"eeg_delta_power", "eeg_slow_oscillation", "eeg_spindles", "sleep_stages"},
			"respiratory_belt": {"respiratory_rate", "respiratory_variability"},
			"mri":              {"dti_alps_index", "csf_pulsatile_velocity_cm_s", "bold_csf_coupling_r"},
		},
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleListSubmodules(w http.ResponseWriter, _ *http.Request) {
	submodules := []SubmoduleDescriptor{
		{
			Key:         "sleep_clearance",
			Title:       "Sleep & Brain-Fluid Research",
			Subtitle:    "Staged physiological state inference & MRI reference research (non-diagnostic)",
			Status:      "active",
			SensorReady: true,
		},
		{
			Key:         "device_sensors",
			Title:       "Local-First Sensor Pipeline",
			Subtitle:    "Provenanced on-device feature extraction (orientation, motion & paired wearables)",
			Status:      "active",
			SensorReady: true,
		},
		{
			Key:         "mri_validation",
			Title:       "MRI Reference & Validation Lab",
			Subtitle:    "Paired DTI-ALPS, CSF flow & BOLD-CSF agreement, ICC(2,1) & coverage",
			Status:      "active",
			SensorReady: false,
		},
		{
			Key:         "cognitive_state",
			Title:       "Cognitive-State Research",
			Subtitle:    "Shared physiology & provenance engine for attention/fatigue research",
			Status:      "research_preview",
			SensorReady: true,
		},
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"submodules":      submodules,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleIngestSensors(w http.ResponseWriter, r *http.Request) {
	var req SensorIngestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid sensor ingest payload")
		return
	}
	if req.UserID == "" {
		req.UserID = "default-user"
	}
	if req.HardwareTier == "" {
		req.HardwareTier = "consumer_phone_sensors"
	}
	if req.SampleRateHz <= 0 {
		req.SampleRateHz = 25.0
	}

	// Synchronous mode when ?sync=true; otherwise event-driven async queue (202 Accepted)
	if r.URL.Query().Get("sync") == "true" {
		rec, err := s.processAndPersistIngest(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusBadGateway, "ML_ERROR", err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, rec)
		return
	}

	evID, status := s.queue.Enqueue(req)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"event_id":        evID,
		"queue_status":    status,
		"idempotency_key": req.IdempotencyKey,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) processAndPersistIngest(ctx context.Context, req SensorIngestRequest) (SensorStreamRecord, error) {
	mlRes, err := s.ml.ProcessSensors(ctx, req)
	if err != nil {
		return SensorStreamRecord{}, err
	}

	now := time.Now().UTC()
	streamID := req.IdempotencyKey
	if streamID == "" {
		streamID = newID("hstr")
	}
	sessionID := req.SessionID
	if sessionID == "" {
		sessionID = newID("hsess")
	}
	deviceID := req.SourceDevice
	if deviceID == "" {
		deviceID = req.UserID + ":" + req.HardwareTier
	}

	// Populate health_sensor_devices and health_sensor_sessions
	signalSource := "phone_imu"
	if len(mlRes.AvailableModalities) > 0 {
		signalSource = mlRes.AvailableModalities[0]
	}
	_ = s.repo.UpsertDevice(ctx, SensorDeviceRecord{
		DeviceID:          deviceID,
		UserID:            req.UserID,
		SignalSource:      signalSource,
		Capabilities:      mlRes.AvailableModalities,
		CalibrationStatus: "active",
		ConnectedAt:       now,
	})
	_ = s.repo.UpsertSession(ctx, SensorSessionRecord{
		SessionID:    sessionID,
		UserID:       req.UserID,
		DeviceID:     deviceID,
		Protocol:     req.HardwareTier,
		IsSimulated:  mlRes.IsSimulated,
		ConsentScope: "health_device_sensors",
		StartedAt:    now,
		CompletedAt:  &now,
	})

	deviceTsMs := req.DeviceTimestampMs
	if deviceTsMs <= 0 {
		deviceTsMs = now.UnixMilli()
	}

	rec := SensorStreamRecord{
		StreamID:            streamID,
		UserID:              req.UserID,
		SessionID:           sessionID,
		HardwareTier:        req.HardwareTier,
		IsSimulated:         mlRes.IsSimulated,
		Features:            mlRes.Features,
		AvailableModalities: mlRes.AvailableModalities,
		MissingModalities:   mlRes.MissingModalities,
		Limitations:         mlRes.Limitations,
		IsFallback:          mlRes.IsFallback,
		ClaimGuardrail:      ClaimGuardrail,
		DeviceTimestampMs:   deviceTsMs,
		RecordedAt:          now,
	}
	if err := s.repo.SaveSensorStream(ctx, rec); err != nil {
		s.logger.Warn("failed to persist sensor features", "err", err)
	}

	s.enqueueOutboxEvent(ctx, "health.features.ingested.v1", req.UserID, req.IdempotencyKey, rec)
	s.FlushOutbox(ctx, 10)
	return rec, nil
}

func (s *Service) handleQueueStats(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.queue.Stats())
}

func (s *Service) handleLatestSensors(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 20
	}
	items, err := s.repo.ListSensorStreams(r.Context(), userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if items == nil {
		items = []SensorStreamRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"streams":         items,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleCreateSleepSession(w http.ResponseWriter, r *http.Request) {
	var req SleepClearanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid research inference request")
		return
	}
	if req.UserID == "" {
		req.UserID = "default-user"
	}
	if req.HardwareTier == "" {
		req.HardwareTier = "consumer_phone_sensors"
	}
	if req.ModelStage == "" {
		req.ModelStage = "M1"
	}

	pred, err := s.ml.PredictClearance(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ML_ERROR", err.Error())
		return
	}

	valStatus := "research_estimate"
	if pred.IsFallback {
		valStatus = "fallback_estimate"
	}

	sess := SleepClearanceSession{
		SessionID:                      newID("hsess"),
		UserID:                         req.UserID,
		CohortID:                       req.CohortID,
		HardwareTier:                   req.HardwareTier,
		ResearchEstimate:               pred.ResearchEstimate,
		Evidence:                       pred.Evidence,
		PhysiologicalHypotheses:        pred.PhysiologicalHypotheses,
		N3AssociatedFeatureSensitivity: pred.N3AssociatedFeatureSensitivity,
		Limitations:                    pred.Limitations,
		ModelStage:                     pred.ModelStage,
		ModelVersion:                   pred.ModelVersion,
		ValidationStatus:               valStatus,
		IsFallback:                     pred.IsFallback,
		ClaimGuardrail:                 ClaimGuardrail,
		CreatedAt:                      time.Now().UTC(),
	}
	if err := s.repo.SaveSleepSession(r.Context(), sess); err != nil {
		s.logger.Warn("failed to persist research prediction", "err", err)
	}
	writeJSON(w, http.StatusCreated, sess)
}

func (s *Service) handleListSleepSessions(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 20
	}
	items, err := s.repo.ListSleepSessions(r.Context(), userID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if items == nil {
		items = []SleepClearanceSession{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sessions":        items,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleCreateMriReference(w http.ResponseWriter, r *http.Request) {
	var rec MriReferenceRecord
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid MRI reference payload")
		return
	}
	if rec.ReferenceID == "" {
		rec.ReferenceID = newID("hmri")
	}
	if rec.UserID == "" {
		rec.UserID = "default-user"
	}
	if rec.CohortID == "" {
		rec.CohortID = "nexora-pilot-01"
	}
	if rec.SiteID == "" {
		rec.SiteID = "clinical-partner-01"
	}
	if rec.ScannerFieldT <= 0 {
		rec.ScannerFieldT = 3.0
	}
	if rec.SurrogateType == "" {
		rec.SurrogateType = "dti_alps_index"
	}
	if rec.QualityScore <= 0 {
		rec.QualityScore = 0.9
	}
	if rec.AcquiredAt.IsZero() {
		rec.AcquiredAt = time.Now().UTC()
	}

	if err := s.repo.SaveMriReference(r.Context(), rec); err != nil {
		s.logger.Warn("failed to persist MRI reference", "err", err)
	}
	_ = s.repo.SaveAuditLog(r.Context(), AuditLogRecord{
		AuditID:      newID("haud"),
		UserID:       rec.UserID,
		Action:       "mri_reference_recorded",
		ResourceType: "health_reference_measurements",
		ResourceID:   rec.ReferenceID,
		Details:      map[string]any{"cohort_id": rec.CohortID, "surrogate_type": rec.SurrogateType},
		CreatedAt:    time.Now().UTC(),
	})
	writeJSON(w, http.StatusCreated, rec)
}

func (s *Service) handleListMriReferences(w http.ResponseWriter, r *http.Request) {
	cohortID := r.URL.Query().Get("cohort_id")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 50
	}
	items, err := s.repo.ListMriReferences(r.Context(), cohortID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if items == nil {
		items = []MriReferenceRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"references":      items,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleValidateCohort(w http.ResponseWriter, r *http.Request) {
	var req CohortValidationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid cohort validation payload")
		return
	}
	res, err := s.ml.ValidateCohort(r.Context(), req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "ML_ERROR", err.Error())
		return
	}
	runID := newID("hval")
	res.RunID = runID
	res.ClaimGuardrail = ClaimGuardrail

	_ = s.repo.SaveValidationRun(r.Context(), ValidationRunRecord{
		RunID:            runID,
		SurrogateTarget:  res.SurrogateTarget,
		SampleCount:      res.SampleCount,
		LinCCC:           res.LinCCC,
		PearsonR:         res.PearsonR,
		MAE:              res.MAE,
		RMSE:             res.RMSE,
		MultiNightICC:    res.MultiNightICC,
		IccFormulation:   res.IccFormulation,
		ValidationPassed: res.ValidationPassed,
		CreatedAt:        time.Now().UTC(),
	})
	_ = s.repo.SaveAuditLog(r.Context(), AuditLogRecord{
		AuditID:      newID("haud"),
		UserID:       "research-cohort",
		Action:       "cohort_validation_run",
		ResourceType: "health_validation_runs",
		ResourceID:   runID,
		Details:      map[string]any{"surrogate_target": res.SurrogateTarget, "lin_ccc": res.LinCCC, "passed": res.ValidationPassed},
		CreatedAt:    time.Now().UTC(),
	})
	s.enqueueOutboxEvent(r.Context(), "health.validation.completed.v1", "research-cohort", runID, res)
	s.FlushOutbox(r.Context(), 5)
	writeJSON(w, http.StatusOK, res)
}

func (s *Service) handleListValidationRuns(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 20
	}
	runs, err := s.repo.ListValidationRuns(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if runs == nil {
		runs = []ValidationRunRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"validations":     runs,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handlePresignRawObservation(w http.ResponseWriter, r *http.Request) {
	var req RawObservationPresignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid presign request")
		return
	}
	if req.ConsentScope != "health_research_telemetry" {
		writeError(w, http.StatusForbidden, "CONSENT_REQUIRED", "Explicit health_research_telemetry consent is required for raw waveform upload")
		return
	}
	if req.UserID == "" {
		req.UserID = "default-user"
	}
	obsID := newID("hobs")
	objectKey := "health/raw/" + req.UserID + "/" + obsID + ".enc.json"

	bucket := strings.TrimSpace(os.Getenv("HEALTH_RAW_S3_BUCKET"))
	if bucket == "" {
		bucket = strings.TrimSpace(os.Getenv("S3_BUCKET"))
	}
	accessKey := strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID"))
	secretKey := strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY"))
	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	if region == "" {
		region = "ap-south-1"
	}
	if bucket != "" && accessKey != "" && secretKey != "" {
		presignedURL := presignS3Put(bucket, region, accessKey, secretKey, objectKey, 15*time.Minute)
		writeJSON(w, http.StatusOK, RawObservationPresignResponse{
			ObservationID:  obsID,
			S3Bucket:       bucket,
			S3ObjectKey:    objectKey,
			PresignedURL:   presignedURL,
			UploadMode:     "s3_presigned",
			ClaimGuardrail: ClaimGuardrail,
		})
		return
	}

	writeJSON(w, http.StatusOK, RawObservationPresignResponse{
		ObservationID:  obsID,
		S3ObjectKey:    objectKey,
		UploadMode:     "local_unconfigured",
		ClaimGuardrail: ClaimGuardrail,
	})
}

func (s *Service) handleCompleteRawObservation(w http.ResponseWriter, r *http.Request) {
	var rec RawObservationRecord
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid observation completion payload")
		return
	}
	if rec.ConsentScope != "health_research_telemetry" {
		writeError(w, http.StatusForbidden, "CONSENT_REQUIRED", "Explicit health_research_telemetry consent is required")
		return
	}
	if rec.ObservationID == "" {
		rec.ObservationID = newID("hobs")
	}
	if rec.UserID == "" {
		rec.UserID = "default-user"
	}
	if rec.RecordedAt.IsZero() {
		rec.RecordedAt = time.Now().UTC()
	}
	if err := s.repo.SaveRawObservation(r.Context(), rec); err != nil {
		s.logger.Warn("failed to persist raw observation metadata", "err", err)
	}
	_ = s.repo.GrantConsent(r.Context(), rec.UserID, rec.ConsentScope)
	_ = s.repo.SaveAuditLog(r.Context(), AuditLogRecord{
		AuditID:      newID("haud"),
		UserID:       rec.UserID,
		Action:       "raw_observation_completed",
		ResourceType: "health_sensor_observations",
		ResourceID:   rec.ObservationID,
		Details:      map[string]any{"sample_count": rec.SampleCount, "consent_scope": rec.ConsentScope},
		CreatedAt:    time.Now().UTC(),
	})
	writeJSON(w, http.StatusCreated, rec)
}

func (s *Service) handleGrantConsent(w http.ResponseWriter, r *http.Request) {
	var req ConsentGrantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid consent grant payload")
		return
	}
	if req.UserID == "" {
		req.UserID = "default-user"
	}
	if req.ConsentScope == "" {
		req.ConsentScope = "health_device_sensors"
	}
	if err := s.repo.GrantConsent(r.Context(), req.UserID, req.ConsentScope); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	_ = s.repo.SaveAuditLog(r.Context(), AuditLogRecord{
		AuditID:      newID("haud"),
		UserID:       req.UserID,
		Action:       "consent_granted",
		ResourceType: "health_sensor_permissions",
		ResourceID:   req.ConsentScope,
		CreatedAt:    time.Now().UTC(),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":         req.UserID,
		"consent_scope":   req.ConsentScope,
		"granted":         true,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleRevokeConsent(w http.ResponseWriter, r *http.Request) {
	var req ConsentRevokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid consent revocation payload")
		return
	}
	if req.UserID == "" {
		req.UserID = "default-user"
	}
	revokedCount, affectedObs, err := s.repo.RevokeConsent(r.Context(), req.UserID, req.ConsentScope)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}

	obsIDs := make([]string, 0, len(affectedObs))
	s3Keys := make([]string, 0, len(affectedObs))
	for _, obs := range affectedObs {
		obsIDs = append(obsIDs, obs.ObservationID)
		if obs.S3ObjectKey != "" {
			s3Keys = append(s3Keys, obs.S3ObjectKey)
		}
	}
	jobID := newID("hera")
	job := ErasureJobRecord{
		JobID:          jobID,
		UserID:         req.UserID,
		ConsentScope:   req.ConsentScope,
		ObservationIDs: obsIDs,
		S3ObjectKeys:   s3Keys,
		Status:         "pending",
		CreatedAt:      time.Now().UTC(),
	}
	_ = s.repo.CreateErasureJob(r.Context(), job)
	for _, key := range s3Keys {
		_ = s.deleteS3Object(r.Context(), key)
	}
	_ = s.repo.CompleteErasureJob(r.Context(), jobID)
	_ = s.repo.SaveAuditLog(r.Context(), AuditLogRecord{
		AuditID:      newID("haud"),
		UserID:       req.UserID,
		Action:       "consent_revoked_and_erased",
		ResourceType: "health_erasure_jobs",
		ResourceID:   jobID,
		Details:      map[string]any{"consent_scope": req.ConsentScope, "revoked_observations": revokedCount},
		CreatedAt:    time.Now().UTC(),
	})
	s.enqueueOutboxEvent(r.Context(), "health.consent.revoked", req.UserID, jobID, map[string]any{
		"job_id":               jobID,
		"user_id":              req.UserID,
		"consent_scope":        req.ConsentScope,
		"revoked_observations": revokedCount,
	})
	s.FlushOutbox(r.Context(), 5)

	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":              req.UserID,
		"consent_scope":        req.ConsentScope,
		"revoked_observations": revokedCount,
		"erasure_job_id":       jobID,
		"erasure_status":       "completed",
		"status":               "revoked",
		"claim_guardrail":      ClaimGuardrail,
	})
}

func (s *Service) handleRegisterDevice(w http.ResponseWriter, r *http.Request) {
	var dev SensorDeviceRecord
	if err := json.NewDecoder(r.Body).Decode(&dev); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid device payload")
		return
	}
	if dev.DeviceID == "" {
		dev.DeviceID = newID("hdev")
	}
	if dev.UserID == "" {
		dev.UserID = "default-user"
	}
	if dev.SignalSource == "" {
		dev.SignalSource = "phone_imu"
	}
	if dev.ConnectedAt.IsZero() {
		dev.ConnectedAt = time.Now().UTC()
	}
	if err := s.repo.UpsertDevice(r.Context(), dev); err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, dev)
}

func (s *Service) handleListDevices(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	devices, err := s.repo.ListDevices(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	if devices == nil {
		devices = []SensorDeviceRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"devices":         devices,
		"claim_guardrail": ClaimGuardrail,
	})
}

func (s *Service) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	sum, err := s.repo.GetTelemetryCounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB_ERROR", err.Error())
		return
	}
	sum.Queue = s.queue.Stats()
	sum.ClaimGuardrail = ClaimGuardrail
	writeJSON(w, http.StatusOK, sum)
}

func (s *Service) enqueueOutboxEvent(ctx context.Context, eventType, userID, idempKey string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = s.repo.EnqueueOutbox(ctx, OutboxEventRecord{
		OutboxID:       newID("hout"),
		EventID:        newID("hev"),
		EventType:      eventType,
		UserID:         userID,
		IdempotencyKey: idempKey,
		PayloadJSON:    raw,
		Status:         "pending",
		Attempts:       0,
		NextRetryAt:    time.Now().UTC(),
		CreatedAt:      time.Now().UTC(),
	})
}

// FlushOutbox dispatches pending outbox events to nexora-ml with exponential backoff and DLQ transition.
func (s *Service) FlushOutbox(ctx context.Context, limit int) {
	pending, err := s.repo.ListPendingOutbox(ctx, limit)
	if err != nil || len(pending) == 0 {
		return
	}
	for _, ev := range pending {
		var payload any
		_ = json.Unmarshal(ev.PayloadJSON, &payload)
		if err := s.ml.PublishEvent(ctx, ev.EventType, payload); err != nil {
			attempts := ev.Attempts + 1
			toDLQ := attempts >= 3
			backoff := time.Duration(1<<attempts) * time.Second
			_ = s.repo.MarkOutboxRetry(ctx, ev.OutboxID, err.Error(), attempts, time.Now().UTC().Add(backoff), toDLQ)
			continue
		}
		_ = s.repo.MarkOutboxDispatched(ctx, ev.OutboxID)
	}
}

func (s *Service) deleteS3Object(ctx context.Context, key string) error {
	bucket := strings.TrimSpace(os.Getenv("HEALTH_RAW_S3_BUCKET"))
	if bucket == "" {
		bucket = strings.TrimSpace(os.Getenv("S3_BUCKET"))
	}
	accessKey := strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID"))
	secretKey := strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY"))
	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	if region == "" {
		region = "ap-south-1"
	}
	if bucket == "" || accessKey == "" || secretKey == "" || key == "" {
		return nil
	}
	delURL := presignS3Method("DELETE", bucket, region, accessKey, secretKey, key, 5*time.Minute)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, delURL, nil)
	if err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": msg,
		},
	})
}

func newID(prefix string) string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

func presignS3Put(bucket, region, accessKey, secretKey, key string, expires time.Duration) string {
	return presignS3Method("PUT", bucket, region, accessKey, secretKey, key, expires)
}

func presignS3Method(method, bucket, region, accessKey, secretKey, key string, expires time.Duration) string {
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	host := fmt.Sprintf("%s.s3.%s.amazonaws.com", bucket, region)
	credScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", accessKey+"/"+credScope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", strconv.Itoa(int(expires.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := q.Encode()

	canonicalReq := fmt.Sprintf("%s\n/%s\n%s\nhost:%s\n\nhost\nUNSIGNED-PAYLOAD", method, strings.TrimLeft(key, "/"), canonicalQuery, host)
	sum := sha256.Sum256([]byte(canonicalReq))
	strToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s", amzDate, credScope, hex.EncodeToString(sum[:]))

	hmacSHA := func(k []byte, d string) []byte {
		m := hmac.New(sha256.New, k)
		_, _ = m.Write([]byte(d))
		return m.Sum(nil)
	}
	kDate := hmacSHA([]byte("AWS4"+secretKey), dateStamp)
	kRegion := hmacSHA(kDate, region)
	kService := hmacSHA(kRegion, "s3")
	kSigning := hmacSHA(kService, "aws4_request")
	sig := hex.EncodeToString(hmacSHA(kSigning, strToSign))

	return fmt.Sprintf("https://%s/%s?%s&X-Amz-Signature=%s", host, strings.TrimLeft(key, "/"), canonicalQuery, sig)
}
