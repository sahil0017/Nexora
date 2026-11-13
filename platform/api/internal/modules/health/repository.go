package health

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository abstracts persistence for all NEXORA Health tables:
// devices, sessions, physiological features, research predictions, MRI references,
// validation runs, permissions, raw observations, outbox events, erasure jobs, and audit logs.
type Repository interface {
	UpsertDevice(ctx context.Context, dev SensorDeviceRecord) error
	ListDevices(ctx context.Context, userID string) ([]SensorDeviceRecord, error)
	UpsertSession(ctx context.Context, sess SensorSessionRecord) error

	SaveSensorStream(ctx context.Context, rec SensorStreamRecord) error
	ListSensorStreams(ctx context.Context, userID string, limit int) ([]SensorStreamRecord, error)

	SaveSleepSession(ctx context.Context, rec SleepClearanceSession) error
	ListSleepSessions(ctx context.Context, userID string, limit int) ([]SleepClearanceSession, error)

	SaveMriReference(ctx context.Context, rec MriReferenceRecord) error
	ListMriReferences(ctx context.Context, cohortID string, limit int) ([]MriReferenceRecord, error)

	SaveValidationRun(ctx context.Context, rec ValidationRunRecord) error
	ListValidationRuns(ctx context.Context, limit int) ([]ValidationRunRecord, error)

	GrantConsent(ctx context.Context, userID, scope string) error
	SaveRawObservation(ctx context.Context, rec RawObservationRecord) error
	RevokeConsent(ctx context.Context, userID, scope string) (int64, []RawObservationRecord, error)

	EnqueueOutbox(ctx context.Context, ev OutboxEventRecord) error
	ListPendingOutbox(ctx context.Context, limit int) ([]OutboxEventRecord, error)
	MarkOutboxDispatched(ctx context.Context, outboxID string) error
	MarkOutboxRetry(ctx context.Context, outboxID, errMsg string, attempts int, nextRetry time.Time, toDLQ bool) error

	CreateErasureJob(ctx context.Context, job ErasureJobRecord) error
	CompleteErasureJob(ctx context.Context, jobID string) error
	SaveAuditLog(ctx context.Context, entry AuditLogRecord) error
	GetTelemetryCounts(ctx context.Context) (TelemetrySummary, error)
}

type MemoryRepository struct {
	mu          sync.RWMutex
	devices     map[string]SensorDeviceRecord
	sensorSess  map[string]SensorSessionRecord
	streams     []SensorStreamRecord
	sessions    []SleepClearanceSession
	mriRefs     []MriReferenceRecord
	validations []ValidationRunRecord
	permissions []SensorPermissionRecord
	rawObs      []RawObservationRecord
	outbox      []OutboxEventRecord
	erasureJobs []ErasureJobRecord
	auditLogs   []AuditLogRecord
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		devices:    make(map[string]SensorDeviceRecord),
		sensorSess: make(map[string]SensorSessionRecord),
	}
}

func (m *MemoryRepository) UpsertDevice(_ context.Context, dev SensorDeviceRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if dev.ConnectedAt.IsZero() {
		dev.ConnectedAt = time.Now().UTC()
	}
	m.devices[dev.DeviceID] = dev
	return nil
}

func (m *MemoryRepository) ListDevices(_ context.Context, userID string) ([]SensorDeviceRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]SensorDeviceRecord, 0, len(m.devices))
	for _, d := range m.devices {
		if userID == "" || d.UserID == userID {
			out = append(out, d)
		}
	}
	return out, nil
}

func (m *MemoryRepository) UpsertSession(_ context.Context, sess SensorSessionRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sess.StartedAt.IsZero() {
		sess.StartedAt = time.Now().UTC()
	}
	m.sensorSess[sess.SessionID] = sess
	return nil
}

func (m *MemoryRepository) SaveSensorStream(_ context.Context, rec SensorStreamRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.streams = append([]SensorStreamRecord{rec}, m.streams...)
	if len(m.streams) > 200 {
		m.streams = m.streams[:200]
	}
	return nil
}

func (m *MemoryRepository) ListSensorStreams(_ context.Context, userID string, limit int) ([]SensorStreamRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 {
		limit = 20
	}
	out := make([]SensorStreamRecord, 0, limit)
	for _, s := range m.streams {
		if userID == "" || s.UserID == userID {
			out = append(out, s)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (m *MemoryRepository) SaveSleepSession(_ context.Context, rec SleepClearanceSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions = append([]SleepClearanceSession{rec}, m.sessions...)
	return nil
}

func (m *MemoryRepository) ListSleepSessions(_ context.Context, userID string, limit int) ([]SleepClearanceSession, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 {
		limit = 20
	}
	out := make([]SleepClearanceSession, 0, limit)
	for _, s := range m.sessions {
		if userID == "" || s.UserID == userID {
			out = append(out, s)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (m *MemoryRepository) SaveMriReference(_ context.Context, rec MriReferenceRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.mriRefs = append([]MriReferenceRecord{rec}, m.mriRefs...)
	return nil
}

func (m *MemoryRepository) ListMriReferences(_ context.Context, cohortID string, limit int) ([]MriReferenceRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	out := make([]MriReferenceRecord, 0, limit)
	for _, r := range m.mriRefs {
		if cohortID == "" || r.CohortID == cohortID {
			out = append(out, r)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (m *MemoryRepository) SaveValidationRun(_ context.Context, rec ValidationRunRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.validations = append([]ValidationRunRecord{rec}, m.validations...)
	return nil
}

func (m *MemoryRepository) ListValidationRuns(_ context.Context, limit int) ([]ValidationRunRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 {
		limit = 20
	}
	if len(m.validations) < limit {
		limit = len(m.validations)
	}
	out := make([]ValidationRunRecord, limit)
	copy(out, m.validations[:limit])
	return out, nil
}

func (m *MemoryRepository) GrantConsent(_ context.Context, userID, scope string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.permissions = append([]SensorPermissionRecord{{
		PermissionID: newID("hperm"),
		UserID:       userID,
		ConsentScope: scope,
		Granted:      true,
		UpdatedAt:    time.Now().UTC(),
	}}, m.permissions...)
	return nil
}

func (m *MemoryRepository) SaveRawObservation(_ context.Context, rec RawObservationRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rawObs = append([]RawObservationRecord{rec}, m.rawObs...)
	return nil
}

func (m *MemoryRepository) RevokeConsent(_ context.Context, userID, scope string) (int64, []RawObservationRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	m.permissions = append([]SensorPermissionRecord{{
		PermissionID: newID("hperm"),
		UserID:       userID,
		ConsentScope: scope,
		Granted:      false,
		RevokedAt:    &now,
		UpdatedAt:    now,
	}}, m.permissions...)

	var count int64
	var affected []RawObservationRecord
	for i := range m.rawObs {
		if (userID == "" || m.rawObs[i].UserID == userID) && (scope == "" || m.rawObs[i].ConsentScope == scope) {
			if !m.rawObs[i].Revoked {
				m.rawObs[i].Revoked = true
				count++
				affected = append(affected, m.rawObs[i])
			}
		}
	}
	return count, affected, nil
}

func (m *MemoryRepository) EnqueueOutbox(_ context.Context, ev OutboxEventRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ev.IdempotencyKey != "" {
		for _, existing := range m.outbox {
			if existing.IdempotencyKey == ev.IdempotencyKey {
				return nil
			}
		}
	}
	m.outbox = append(m.outbox, ev)
	return nil
}

func (m *MemoryRepository) ListPendingOutbox(_ context.Context, limit int) ([]OutboxEventRecord, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := time.Now().UTC()
	var out []OutboxEventRecord
	for _, ev := range m.outbox {
		if ev.Status == "pending" && !ev.NextRetryAt.After(now) {
			out = append(out, ev)
			if limit > 0 && len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (m *MemoryRepository) MarkOutboxDispatched(_ context.Context, outboxID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	for i := range m.outbox {
		if m.outbox[i].OutboxID == outboxID {
			m.outbox[i].Status = "dispatched"
			m.outbox[i].DispatchedAt = &now
			break
		}
	}
	return nil
}

func (m *MemoryRepository) MarkOutboxRetry(_ context.Context, outboxID, errMsg string, attempts int, nextRetry time.Time, toDLQ bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.outbox {
		if m.outbox[i].OutboxID == outboxID {
			m.outbox[i].Attempts = attempts
			m.outbox[i].LastError = errMsg
			m.outbox[i].NextRetryAt = nextRetry
			if toDLQ {
				m.outbox[i].Status = "dlq"
			}
			break
		}
	}
	return nil
}

func (m *MemoryRepository) CreateErasureJob(_ context.Context, job ErasureJobRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.erasureJobs = append([]ErasureJobRecord{job}, m.erasureJobs...)
	return nil
}

func (m *MemoryRepository) CompleteErasureJob(_ context.Context, jobID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	for i := range m.erasureJobs {
		if m.erasureJobs[i].JobID == jobID {
			m.erasureJobs[i].Status = "completed"
			m.erasureJobs[i].CompletedAt = &now
			break
		}
	}
	return nil
}

func (m *MemoryRepository) SaveAuditLog(_ context.Context, entry AuditLogRecord) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.auditLogs = append([]AuditLogRecord{entry}, m.auditLogs...)
	if len(m.auditLogs) > 500 {
		m.auditLogs = m.auditLogs[:500]
	}
	return nil
}

func (m *MemoryRepository) GetTelemetryCounts(_ context.Context) (TelemetrySummary, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var sum TelemetrySummary
	for _, ev := range m.outbox {
		switch ev.Status {
		case "pending":
			sum.OutboxPending++
		case "dispatched":
			sum.OutboxDispatched++
		case "dlq":
			sum.OutboxDLQ++
		}
	}
	for _, j := range m.erasureJobs {
		if j.Status == "completed" {
			sum.ErasureCompleted++
		} else {
			sum.ErasurePending++
		}
	}
	sum.DevicesCount = len(m.devices)
	sum.SessionsCount = len(m.sensorSess)
	sum.ValidationsCount = len(m.validations)
	if len(m.sessions) > 0 {
		fb := 0
		for _, s := range m.sessions {
			if s.IsFallback {
				fb++
			}
		}
		sum.FallbackRate = float64(fb) / float64(len(m.sessions))
	}
	sum.ClaimGuardrail = ClaimGuardrail
	return sum, nil
}

// PostgresRepository persists separated sensor features, research predictions, reference measurements,
// validation runs, permissions, outbox events, erasure jobs, and audit logs.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (p *PostgresRepository) UpsertDevice(ctx context.Context, dev SensorDeviceRecord) error {
	capsJSON, _ := json.Marshal(dev.Capabilities)
	if dev.CalibrationStatus == "" {
		dev.CalibrationStatus = "uncalibrated"
	}
	if dev.ConnectedAt.IsZero() {
		dev.ConnectedAt = time.Now().UTC()
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_sensor_devices (
			device_id, user_id, signal_source, capabilities_json, calibration_status, connected_at
		) VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (device_id) DO UPDATE SET
			signal_source = EXCLUDED.signal_source,
			capabilities_json = EXCLUDED.capabilities_json,
			calibration_status = EXCLUDED.calibration_status
	`, dev.DeviceID, dev.UserID, dev.SignalSource, capsJSON, dev.CalibrationStatus, dev.ConnectedAt)
	return err
}

func (p *PostgresRepository) ListDevices(ctx context.Context, userID string) ([]SensorDeviceRecord, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT device_id, user_id, signal_source, capabilities_json, calibration_status, connected_at
		FROM health_sensor_devices
		WHERE ($1 = '' OR user_id = $1)
		ORDER BY connected_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SensorDeviceRecord
	for rows.Next() {
		var d SensorDeviceRecord
		var capsRaw []byte
		if err := rows.Scan(&d.DeviceID, &d.UserID, &d.SignalSource, &capsRaw, &d.CalibrationStatus, &d.ConnectedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(capsRaw, &d.Capabilities)
		out = append(out, d)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) UpsertSession(ctx context.Context, sess SensorSessionRecord) error {
	if sess.StartedAt.IsZero() {
		sess.StartedAt = time.Now().UTC()
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_sensor_sessions (
			session_id, user_id, device_id, protocol, is_simulated, consent_scope, started_at, completed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (session_id) DO UPDATE SET
			completed_at = COALESCE(EXCLUDED.completed_at, health_sensor_sessions.completed_at),
			is_simulated = EXCLUDED.is_simulated
	`, sess.SessionID, sess.UserID, sess.DeviceID, sess.Protocol, sess.IsSimulated, sess.ConsentScope, sess.StartedAt, sess.CompletedAt)
	return err
}

func (p *PostgresRepository) SaveSensorStream(ctx context.Context, rec SensorStreamRecord) error {
	if len(rec.Features) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for name, feat := range rec.Features {
		var numVal *float64
		var catVal *string
		switch v := feat.Value.(type) {
		case float64:
			numVal = &v
		case string:
			catVal = &v
		}
		idemp := rec.StreamID + ":" + name
		deviceTs := rec.DeviceTimestampMs
		if deviceTs <= 0 {
			deviceTs = rec.RecordedAt.UnixMilli()
		}
		batch.Queue(`
			INSERT INTO health_physiological_features (
				feature_id, session_id, user_id, idempotency_key, feature_name,
				numeric_value, category_value, unit, signal_source, measurement_status,
				signal_quality, algorithm_version, missing_reason, device_timestamp_ms, recorded_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
			ON CONFLICT (idempotency_key) DO NOTHING
		`, newID("hfeat"), rec.SessionID, rec.UserID, idemp, name,
			numVal, catVal, feat.Unit, feat.Provenance.SignalSource, feat.Provenance.MeasurementStatus,
			feat.Provenance.SignalQualityScore, feat.Provenance.AlgorithmVersion, feat.Provenance.MissingReason,
			deviceTs, rec.RecordedAt)
	}
	br := p.pool.SendBatch(ctx, batch)
	defer br.Close()
	for range rec.Features {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}
	return nil
}

func (p *PostgresRepository) ListSensorStreams(ctx context.Context, userID string, limit int) ([]SensorStreamRecord, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT COALESCE(session_id,''), user_id, feature_name, numeric_value, category_value,
			unit, signal_source, measurement_status, signal_quality, algorithm_version,
			missing_reason, recorded_at
		FROM health_physiological_features
		WHERE ($1 = '' OR user_id = $1)
		ORDER BY recorded_at DESC
		LIMIT $2
	`, userID, limit*4)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SensorStreamRecord
	for rows.Next() {
		var sessID, uID, fName, unit, src, status, algo string
		var numVal *float64
		var catVal, missReason *string
		var qual float64
		var recAt time.Time
		if err := rows.Scan(&sessID, &uID, &fName, &numVal, &catVal, &unit, &src, &status, &qual, &algo, &missReason, &recAt); err != nil {
			return nil, err
		}
		var val any
		if numVal != nil {
			val = *numVal
		} else if catVal != nil {
			val = *catVal
		}
		out = append(out, SensorStreamRecord{
			StreamID: sessID,
			UserID:   uID,
			Features: map[string]ProvenancedFeature{
				fName: {
					Name:  fName,
					Value: val,
					Unit:  unit,
					Provenance: FeatureProvenance{
						SignalSource:       src,
						MeasurementStatus:  status,
						SignalQualityScore: qual,
						AlgorithmVersion:   algo,
						MissingReason:      missReason,
					},
				},
			},
			ClaimGuardrail: ClaimGuardrail,
			RecordedAt:     recAt,
		})
		if len(out) >= limit {
			break
		}
	}
	return out, rows.Err()
}

func (p *PostgresRepository) SaveSleepSession(ctx context.Context, rec SleepClearanceSession) error {
	availJSON, _ := json.Marshal(rec.Evidence.AvailableModalities)
	missJSON, _ := json.Marshal(rec.Evidence.MissingModalities)
	limJSON, _ := json.Marshal(rec.Limitations)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_research_predictions (
			prediction_id, user_id, cohort_id, target, estimate_value, unit,
			ci_95_low, ci_95_high, epistemic_std, aleatoric_std,
			available_modalities, missing_modalities, limitations_json,
			model_stage, model_version, is_fallback, claim_guardrail, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
	`, rec.SessionID, rec.UserID, rec.CohortID, rec.ResearchEstimate.Target, rec.ResearchEstimate.Value,
		rec.ResearchEstimate.Unit, rec.ResearchEstimate.ConfidenceInterval[0], rec.ResearchEstimate.ConfidenceInterval[1],
		rec.ResearchEstimate.Uncertainty.Epistemic, rec.ResearchEstimate.Uncertainty.Aleatoric,
		availJSON, missJSON, limJSON, rec.ModelStage, rec.ModelVersion, rec.IsFallback, rec.ClaimGuardrail, rec.CreatedAt)
	return err
}

func (p *PostgresRepository) ListSleepSessions(ctx context.Context, userID string, limit int) ([]SleepClearanceSession, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT prediction_id, user_id, COALESCE(cohort_id,''), target, estimate_value, unit,
			ci_95_low, ci_95_high, epistemic_std, aleatoric_std,
			available_modalities, missing_modalities, limitations_json,
			model_stage, model_version, is_fallback, claim_guardrail, created_at
		FROM health_research_predictions
		WHERE ($1 = '' OR user_id = $1)
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []SleepClearanceSession
	for rows.Next() {
		var rec SleepClearanceSession
		var availRaw, missRaw, limRaw []byte
		if err := rows.Scan(
			&rec.SessionID, &rec.UserID, &rec.CohortID, &rec.ResearchEstimate.Target,
			&rec.ResearchEstimate.Value, &rec.ResearchEstimate.Unit,
			&rec.ResearchEstimate.ConfidenceInterval[0], &rec.ResearchEstimate.ConfidenceInterval[1],
			&rec.ResearchEstimate.Uncertainty.Epistemic, &rec.ResearchEstimate.Uncertainty.Aleatoric,
			&availRaw, &missRaw, &limRaw, &rec.ModelStage, &rec.ModelVersion,
			&rec.IsFallback, &rec.ClaimGuardrail, &rec.CreatedAt,
		); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(availRaw, &rec.Evidence.AvailableModalities)
		_ = json.Unmarshal(missRaw, &rec.Evidence.MissingModalities)
		_ = json.Unmarshal(limRaw, &rec.Limitations)
		if rec.IsFallback {
			rec.ValidationStatus = "fallback_estimate"
		} else {
			rec.ValidationStatus = "research_estimate"
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) SaveMriReference(ctx context.Context, rec MriReferenceRecord) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_reference_measurements (
			reference_id, user_id, cohort_id, site_id, scanner_field_t, surrogate_type,
			dti_alps_index, csf_pulsatile_velocity_cm_s, bold_csf_coupling_r, pvs_burden_score,
			quality_score, paired_prediction_id, acquired_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`, rec.ReferenceID, rec.UserID, rec.CohortID, rec.SiteID, rec.ScannerFieldT, rec.SurrogateType,
		rec.DtiAlpsIndex, rec.CsfPulsatileVelocityCmS, rec.BoldCsfCouplingR, rec.PvsBurdenScore,
		rec.QualityScore, rec.PairedSessionID, rec.AcquiredAt)
	return err
}

func (p *PostgresRepository) ListMriReferences(ctx context.Context, cohortID string, limit int) ([]MriReferenceRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT reference_id, user_id, cohort_id, site_id, scanner_field_t, surrogate_type,
			dti_alps_index, csf_pulsatile_velocity_cm_s, bold_csf_coupling_r, pvs_burden_score,
			quality_score, COALESCE(paired_prediction_id,''), acquired_at
		FROM health_reference_measurements
		WHERE ($1 = '' OR cohort_id = $1)
		ORDER BY acquired_at DESC
		LIMIT $2
	`, cohortID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []MriReferenceRecord
	for rows.Next() {
		var rec MriReferenceRecord
		if err := rows.Scan(
			&rec.ReferenceID, &rec.UserID, &rec.CohortID, &rec.SiteID, &rec.ScannerFieldT, &rec.SurrogateType,
			&rec.DtiAlpsIndex, &rec.CsfPulsatileVelocityCmS, &rec.BoldCsfCouplingR, &rec.PvsBurdenScore,
			&rec.QualityScore, &rec.PairedSessionID, &rec.AcquiredAt,
		); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) SaveValidationRun(ctx context.Context, rec ValidationRunRecord) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_validation_runs (
			run_id, surrogate_target, sample_count, lin_ccc, pearson_r,
			mae, rmse, multi_night_icc, icc_formulation, validation_passed, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, rec.RunID, rec.SurrogateTarget, rec.SampleCount, rec.LinCCC, rec.PearsonR,
		rec.MAE, rec.RMSE, rec.MultiNightICC, rec.IccFormulation, rec.ValidationPassed, rec.CreatedAt)
	return err
}

func (p *PostgresRepository) ListValidationRuns(ctx context.Context, limit int) ([]ValidationRunRecord, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := p.pool.Query(ctx, `
		SELECT run_id, surrogate_target, sample_count, lin_ccc, pearson_r,
			mae, rmse, multi_night_icc, icc_formulation, validation_passed, created_at
		FROM health_validation_runs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ValidationRunRecord
	for rows.Next() {
		var r ValidationRunRecord
		if err := rows.Scan(&r.RunID, &r.SurrogateTarget, &r.SampleCount, &r.LinCCC, &r.PearsonR,
			&r.MAE, &r.RMSE, &r.MultiNightICC, &r.IccFormulation, &r.ValidationPassed, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) GrantConsent(ctx context.Context, userID, scope string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_sensor_permissions (permission_id, user_id, consent_scope, granted, updated_at)
		VALUES ($1, $2, $3, TRUE, NOW())
	`, newID("hperm"), userID, scope)
	return err
}

func (p *PostgresRepository) SaveRawObservation(ctx context.Context, rec RawObservationRecord) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_sensor_observations (
			observation_id, user_id, session_id, s3_object_key, sha256_ciphertext,
			sample_count, sample_rate_hz, device_timestamp_ms, monotonic_ms,
			sync_uncertainty_ms, consent_scope, revoked, recorded_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	`, rec.ObservationID, rec.UserID, rec.SessionID, rec.S3ObjectKey, rec.Sha256Ciphertext,
		rec.SampleCount, rec.SampleRateHz, rec.DeviceTimestampMs, rec.MonotonicMs,
		rec.SyncUncertaintyMs, rec.ConsentScope, rec.Revoked, rec.RecordedAt)
	return err
}

func (p *PostgresRepository) RevokeConsent(ctx context.Context, userID, scope string) (int64, []RawObservationRecord, error) {
	_, _ = p.pool.Exec(ctx, `
		INSERT INTO health_sensor_permissions (permission_id, user_id, consent_scope, granted, revoked_at)
		VALUES ($1, $2, $3, FALSE, NOW())
	`, newID("hperm"), userID, scope)

	rows, err := p.pool.Query(ctx, `
		UPDATE health_sensor_observations
		SET revoked = TRUE
		WHERE user_id = $1 AND ($2 = '' OR consent_scope = $2) AND revoked = FALSE
		RETURNING observation_id, user_id, COALESCE(session_id,''), s3_object_key, sha256_ciphertext,
			sample_count, sample_rate_hz, device_timestamp_ms, monotonic_ms,
			sync_uncertainty_ms, consent_scope, revoked, recorded_at
	`, userID, scope)
	if err != nil {
		return 0, nil, err
	}
	defer rows.Close()
	var affected []RawObservationRecord
	for rows.Next() {
		var rec RawObservationRecord
		if err := rows.Scan(
			&rec.ObservationID, &rec.UserID, &rec.SessionID, &rec.S3ObjectKey, &rec.Sha256Ciphertext,
			&rec.SampleCount, &rec.SampleRateHz, &rec.DeviceTimestampMs, &rec.MonotonicMs,
			&rec.SyncUncertaintyMs, &rec.ConsentScope, &rec.Revoked, &rec.RecordedAt,
		); err != nil {
			return int64(len(affected)), affected, err
		}
		affected = append(affected, rec)
	}
	return int64(len(affected)), affected, rows.Err()
}

func (p *PostgresRepository) EnqueueOutbox(ctx context.Context, ev OutboxEventRecord) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_ingest_outbox (
			outbox_id, event_id, event_type, user_id, idempotency_key,
			payload_json, status, attempts, next_retry_at, created_at
		) VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10)
		ON CONFLICT (idempotency_key) DO NOTHING
	`, ev.OutboxID, ev.EventID, ev.EventType, ev.UserID, ev.IdempotencyKey,
		ev.PayloadJSON, ev.Status, ev.Attempts, ev.NextRetryAt, ev.CreatedAt)
	return err
}

func (p *PostgresRepository) ListPendingOutbox(ctx context.Context, limit int) ([]OutboxEventRecord, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := p.pool.Query(ctx, `
		SELECT outbox_id, event_id, event_type, user_id, COALESCE(idempotency_key,''),
			payload_json, status, attempts, next_retry_at, COALESCE(last_error,''), created_at
		FROM health_ingest_outbox
		WHERE status = 'pending' AND next_retry_at <= NOW()
		ORDER BY created_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []OutboxEventRecord
	for rows.Next() {
		var r OutboxEventRecord
		if err := rows.Scan(&r.OutboxID, &r.EventID, &r.EventType, &r.UserID, &r.IdempotencyKey,
			&r.PayloadJSON, &r.Status, &r.Attempts, &r.NextRetryAt, &r.LastError, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) MarkOutboxDispatched(ctx context.Context, outboxID string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE health_ingest_outbox
		SET status = 'dispatched', dispatched_at = NOW()
		WHERE outbox_id = $1
	`, outboxID)
	return err
}

func (p *PostgresRepository) MarkOutboxRetry(ctx context.Context, outboxID, errMsg string, attempts int, nextRetry time.Time, toDLQ bool) error {
	status := "pending"
	if toDLQ {
		status = "dlq"
	}
	_, err := p.pool.Exec(ctx, `
		UPDATE health_ingest_outbox
		SET status = $2, attempts = $3, last_error = $4, next_retry_at = $5
		WHERE outbox_id = $1
	`, outboxID, status, attempts, errMsg, nextRetry)
	return err
}

func (p *PostgresRepository) CreateErasureJob(ctx context.Context, job ErasureJobRecord) error {
	obsJSON, _ := json.Marshal(job.ObservationIDs)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_erasure_jobs (job_id, user_id, consent_scope, observation_ids_json, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6)
	`, job.JobID, job.UserID, job.ConsentScope, obsJSON, job.Status, job.CreatedAt)
	return err
}

func (p *PostgresRepository) CompleteErasureJob(ctx context.Context, jobID string) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE health_erasure_jobs
		SET status = 'completed', completed_at = NOW()
		WHERE job_id = $1
	`, jobID)
	return err
}

func (p *PostgresRepository) SaveAuditLog(ctx context.Context, entry AuditLogRecord) error {
	detJSON, _ := json.Marshal(entry.Details)
	_, err := p.pool.Exec(ctx, `
		INSERT INTO health_audit_log (audit_id, user_id, action, resource_type, resource_id, details_json, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`, entry.AuditID, entry.UserID, entry.Action, entry.ResourceType, entry.ResourceID, detJSON, entry.CreatedAt)
	return err
}

func (p *PostgresRepository) GetTelemetryCounts(ctx context.Context) (TelemetrySummary, error) {
	var sum TelemetrySummary
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_ingest_outbox WHERE status='pending'`).Scan(&sum.OutboxPending)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_ingest_outbox WHERE status='dispatched'`).Scan(&sum.OutboxDispatched)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_ingest_outbox WHERE status='dlq'`).Scan(&sum.OutboxDLQ)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_erasure_jobs WHERE status='pending'`).Scan(&sum.ErasurePending)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_erasure_jobs WHERE status='completed'`).Scan(&sum.ErasureCompleted)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_sensor_devices`).Scan(&sum.DevicesCount)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_sensor_sessions`).Scan(&sum.SessionsCount)
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM health_validation_runs`).Scan(&sum.ValidationsCount)

	var totalPreds, fbPreds int
	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*), COUNT(*) FILTER (WHERE is_fallback) FROM health_research_predictions`).Scan(&totalPreds, &fbPreds)
	if totalPreds > 0 {
		sum.FallbackRate = float64(fbPreds) / float64(totalPreds)
	}
	sum.ClaimGuardrail = ClaimGuardrail
	return sum, nil
}
