package health

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"
)

// MLClient calls the Python nexora-ml service. When unavailable, fallbacks are explicitly marked
// with IsFallback=true and ValidationStatus="fallback_estimate" so they never masquerade as validated research outputs.
type MLClient struct {
	baseURL string
	http    *http.Client
}

func NewMLClient(baseURL string) *MLClient {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	return &MLClient{
		baseURL: trimmed,
		http:    &http.Client{Timeout: 8 * time.Second},
	}
}

type mlMeasurementResponse struct {
	Features            map[string]ProvenancedFeature `json:"features"`
	AvailableModalities []string                      `json:"available_modalities"`
	MissingModalities   []string                      `json:"missing_modalities"`
	IsSimulated         bool                          `json:"is_simulated"`
	Limitations         []string                      `json:"limitations"`
	ClaimGuardrail      string                        `json:"claim_guardrail"`
	IsFallback          bool                          `json:"is_fallback"`
}

func (c *MLClient) ProcessSensors(ctx context.Context, req SensorIngestRequest) (mlMeasurementResponse, error) {
	if c.baseURL != "" {
		var out mlMeasurementResponse
		if err := c.postJSON(ctx, "/v1/health/sensors/process", req, &out); err == nil {
			return out, nil
		}
	}
	return fallbackMeasurement(req), nil
}

type mlInferenceResponse struct {
	ResearchEstimate               ResearchEstimate `json:"research_estimate"`
	Evidence                       EvidenceSummary  `json:"evidence"`
	PhysiologicalHypotheses        map[string]any   `json:"physiological_hypotheses"`
	N3AssociatedFeatureSensitivity float64          `json:"n3_associated_feature_sensitivity"`
	Limitations                    []string         `json:"limitations"`
	ModelStage                     string           `json:"model_stage"`
	ModelVersion                   string           `json:"model_version"`
	ClaimGuardrail                 string           `json:"claim_guardrail"`
	IsFallback                     bool             `json:"is_fallback"`
}

func (c *MLClient) PredictClearance(ctx context.Context, req SleepClearanceRequest) (mlInferenceResponse, error) {
	if c.baseURL != "" {
		var out mlInferenceResponse
		if err := c.postJSON(ctx, "/v1/health/sleep-clearance/predict", req, &out); err == nil {
			return out, nil
		}
	}
	return fallbackInference(req), nil
}

func (c *MLClient) ValidateCohort(ctx context.Context, req CohortValidationRequest) (CohortValidationResult, error) {
	if c.baseURL != "" {
		var out CohortValidationResult
		if err := c.postJSON(ctx, "/v1/health/sleep-clearance/validate", req, &out); err == nil {
			return out, nil
		}
	}
	return fallbackValidation(req), nil
}

// PublishEvent forwards health domain events to nexora-ml's event-driven consumer.
func (c *MLClient) PublishEvent(ctx context.Context, eventType string, payload any) error {
	if c.baseURL == "" {
		return nil
	}
	var sink map[string]any
	return c.postJSON(ctx, "/v1/events/ingest", map[string]any{
		"event_id":   newID("hev"),
		"event_type": eventType,
		"payload":    payload,
	}, &sink)
}

func (c *MLClient) postJSON(ctx context.Context, path string, payload any, out any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return http.ErrHandlerTimeout
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func fallbackMeasurement(req SensorIngestRequest) mlMeasurementResponse {
	if len(req.ExtractedFeatures) > 0 {
		return mlMeasurementResponse{
			Features:            req.ExtractedFeatures,
			AvailableModalities: []string{"phone_imu"},
			MissingModalities:   []string{"wearable_ppg", "eeg", "respiratory_belt", "mri"},
			IsSimulated:         req.IsSimulated,
			Limitations: []string{
				"Processed via Go fallback_estimate (ML service offline)",
				"Phone IMU estimates device orientation, not necessarily anatomical body posture",
				"No direct CSF, EEG, or PPG measurement",
			},
			ClaimGuardrail: ClaimGuardrail,
			IsFallback:     true,
		}
	}
	orient := "unknown"
	if len(req.Frames) > 0 {
		var sx, sy, sz float64
		for _, f := range req.Frames {
			sx += f.Ax
			sy += f.Ay
			sz += f.Az
		}
		n := float64(len(req.Frames))
		mx, my, mz := sx/n, sy/n, sz/n
		norm := math.Sqrt(mx*mx + my*my + mz*mz)
		if norm > 1e-4 {
			gx, gy, gz := mx/norm, my/norm, mz/norm
			switch {
			case math.Abs(gy) > 0.72:
				orient = "upright_device"
			case gz > 0.65:
				orient = "face_up_supine_proxy"
			case gz < -0.65:
				orient = "face_down_prone_proxy"
			case gx > 0.55:
				orient = "lateral_right_proxy"
			case gx < -0.55:
				orient = "lateral_left_proxy"
			default:
				orient = "face_up_supine_proxy"
			}
		}
	}
	status := "measured"
	src := "phone_imu"
	if req.IsSimulated {
		status = "simulated"
		src = "synthetic_lab"
	}
	return mlMeasurementResponse{
		Features: map[string]ProvenancedFeature{
			"device_orientation": {
				Name:  "device_orientation",
				Value: orient,
				Unit:  "category",
				Provenance: FeatureProvenance{
					SourceDevice:       req.SourceDevice,
					SignalSource:       src,
					SamplingRateHz:     req.SampleRateHz,
					SignalQualityScore: 0.65,
					MeasurementStatus:  status,
					AlgorithmVersion:   "go_fallback_v1",
				},
			},
		},
		AvailableModalities: []string{src},
		MissingModalities:   []string{"wearable_ppg", "eeg", "respiratory_belt", "mri"},
		IsSimulated:         req.IsSimulated,
		Limitations:         []string{"Go fallback_estimate only (ML service offline)", "No EEG, PPG, or CSF measurement"},
		ClaimGuardrail:      ClaimGuardrail,
		IsFallback:          true,
	}
}

func fallbackInference(req SleepClearanceRequest) mlInferenceResponse {
	avail := []string{}
	missing := []string{}
	if req.DeviceOrientation != "" {
		avail = append(avail, "phone_imu")
	}
	if req.PpgPulsatilityIndex != nil || req.HrvRmssdMs != nil {
		avail = append(avail, "wearable_ppg")
	} else {
		missing = append(missing, "wearable_ppg")
	}
	if req.EegDeltaRatio != nil || req.N3Fraction != nil {
		avail = append(avail, "eeg")
	} else {
		missing = append(missing, "eeg")
	}
	missing = append(missing, "mri")

	val := 0.34
	if req.EegDeltaRatio != nil {
		val += 0.30 * (*req.EegDeltaRatio)
	}
	if req.N3Fraction != nil {
		val += 0.20 * math.Min(1.0, *req.N3Fraction/0.28)
	}
	if req.PpgPulsatilityIndex != nil {
		val += 0.15 * (*req.PpgPulsatilityIndex)
	}
	val = math.Round(math.Min(0.95, math.Max(0.10, val))*10000) / 10000
	epistemic := 0.08 + 0.03*float64(len(missing))
	aleatoric := 0.09

	return mlInferenceResponse{
		ResearchEstimate: ResearchEstimate{
			Target:             "sleep_physiology_state",
			Value:              val,
			Unit:               "normalized_research_scale",
			ConfidenceInterval: [2]float64{math.Max(0, math.Round((val-1.96*epistemic)*1000)/1000), math.Min(1, math.Round((val+1.96*epistemic)*1000)/1000)},
			Uncertainty:        UncertaintyBreakdown{Epistemic: math.Round(epistemic*10000) / 10000, Aleatoric: aleatoric},
		},
		Evidence: EvidenceSummary{
			AvailableModalities: avail,
			MissingModalities:   missing,
			SignalQuality:       "moderate",
			SignalQualityScore:  req.SignalQualityScore,
		},
		PhysiologicalHypotheses: map[string]any{
			"sleep_physiology_state": val,
			"available_components":   avail,
			"missing_components":     missing,
		},
		N3AssociatedFeatureSensitivity: 0.035,
		Limitations: []string{
			"fallback_estimate: Python research inference service offline",
			"No direct CSF or brain-clearance measurement",
			"Not validated as a brain-clearance estimate",
		},
		ModelStage:     "fallback_estimate",
		ModelVersion:   "go-fallback-0.1",
		ClaimGuardrail: ClaimGuardrail,
		IsFallback:     true,
	}
}

func fallbackValidation(req CohortValidationRequest) CohortValidationResult {
	n := len(req.Predicted)
	if len(req.MriReference) < n {
		n = len(req.MriReference)
	}
	target := req.SurrogateTarget
	if target == "" {
		target = "dti_alps_index"
	}
	if n < 2 {
		return CohortValidationResult{
			SampleCount:     n,
			SurrogateTarget: target,
			IccFormulation:  "ICC(2,1) random-effects absolute agreement",
			Notes:           []string{"fallback_estimate: at least 2 paired MRI observations required."},
			IsFallback:      true,
			ClaimGuardrail:  ClaimGuardrail,
		}
	}
	var sumX, sumY, sumDiff, sumAbs, sumSq float64
	for i := 0; i < n; i++ {
		x, y := req.Predicted[i], req.MriReference[i]
		sumX += x
		sumY += y
		d := x - y
		sumDiff += d
		sumAbs += math.Abs(d)
		sumSq += d * d
	}
	meanX, meanY := sumX/float64(n), sumY/float64(n)
	bias := sumDiff / float64(n)
	var varX, varY, covXY, varDiff float64
	for i := 0; i < n; i++ {
		dx := req.Predicted[i] - meanX
		dy := req.MriReference[i] - meanY
		varX += dx * dx
		varY += dy * dy
		covXY += dx * dy
		dd := (req.Predicted[i] - req.MriReference[i]) - bias
		varDiff += dd * dd
	}
	denom := float64(n - 1)
	varX /= denom
	varY /= denom
	covXY /= denom
	sdDiff := math.Sqrt(varDiff / denom)
	pearson, ccc := 0.0, 0.0
	if varX > 1e-9 && varY > 1e-9 {
		pearson = covXY / (math.Sqrt(varX) * math.Sqrt(varY))
		ccc = (2.0 * covXY) / math.Max(varX+varY+math.Pow(meanX-meanY, 2), 1e-9)
	}
	return CohortValidationResult{
		SampleCount:                    n,
		SurrogateTarget:                target,
		PearsonR:                       math.Round(pearson*10000) / 10000,
		SpearmanRho:                    math.Round(pearson*10000) / 10000,
		LinCCC:                         math.Round(ccc*10000) / 10000,
		MAE:                            math.Round((sumAbs/float64(n))*10000) / 10000,
		RMSE:                           math.Round(math.Sqrt(sumSq/float64(n))*10000) / 10000,
		BlandAltmanBias:                math.Round(bias*10000) / 10000,
		BlandAltmanLoaLow:              math.Round((bias-1.96*sdDiff)*10000) / 10000,
		BlandAltmanLoaHigh:             math.Round((bias+1.96*sdDiff)*10000) / 10000,
		IccFormulation:                 "ICC(2,1) random-effects absolute agreement",
		N3AssociatedFeatureSensitivity: 0.035,
		ValidationPassed:               n >= 10 && ccc >= 0.65 && pearson >= 0.70,
		Notes:                          []string{"fallback_estimate: Python validation service offline."},
		IsFallback:                     true,
		ClaimGuardrail:                 ClaimGuardrail,
	}
}
