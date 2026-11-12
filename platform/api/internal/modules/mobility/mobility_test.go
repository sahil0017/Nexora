package mobility

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/nexora/platform/api/internal/platform/cache"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func mockMLClient(fn roundTripFunc) *MLClient {
	return NewMLClientWithHTTP("http://ml.local", &http.Client{Transport: fn})
}

type fakeRepo struct {
	savedOptions []PlannedOption
	trips        map[string]*Trip
	samplesCount int
}

func (f *fakeRepo) ResolveCityFromGPS(context.Context, float64, float64) string { return "" }
func (f *fakeRepo) GetProfile(_ context.Context, userID string) (*MobilityProfile, error) {
	return &MobilityProfile{UserID: userID, DefaultMode: "car", OptimizeFor: "RELIABILITY", MaxWalkingMinutes: 15}, nil
}
func (f *fakeRepo) UpsertProfile(_ context.Context, p MobilityProfile) (*MobilityProfile, error) {
	return &p, nil
}
func (f *fakeRepo) ListSavedPlaces(context.Context, string) ([]SavedPlace, error) {
	return []SavedPlace{}, nil
}
func (f *fakeRepo) GetSavedPlace(context.Context, string) (*SavedPlace, error) {
	return nil, ErrNotFound
}
func (f *fakeRepo) CreateSavedPlace(_ context.Context, sp SavedPlace) (*SavedPlace, error) {
	sp.ID = uuid.NewString()
	sp.CreatedAt = time.Now().UTC()
	return &sp, nil
}
func (f *fakeRepo) SaveJourneyOptions(_ context.Context, _ string, opts []PlannedOption) error {
	f.savedOptions = append(f.savedOptions, opts...)
	return nil
}
func (f *fakeRepo) StartTrip(_ context.Context, userID, mode string, orig GeoPoint, dest *GeoPoint) (*Trip, error) {
	t := &Trip{
		ID:          uuid.NewString(),
		UserID:      userID,
		Status:      "active",
		PrimaryMode: mode,
		Origin:      orig,
		Destination: dest,
		CreatedAt:   time.Now().UTC(),
	}
	if f.trips == nil {
		f.trips = map[string]*Trip{}
	}
	f.trips[t.ID] = t
	return t, nil
}
func (f *fakeRepo) GetTrip(_ context.Context, tripID string) (*Trip, error) {
	t, ok := f.trips[tripID]
	if !ok {
		return nil, ErrNotFound
	}
	return t, nil
}
func (f *fakeRepo) AddLocationSamples(_ context.Context, _ string, samples []LocationSample) (int, error) {
	f.samplesCount += len(samples)
	return len(samples), nil
}
func (f *fakeRepo) CompleteTrip(_ context.Context, tripID string) (*Trip, error) {
	t, ok := f.trips[tripID]
	if !ok {
		return nil, ErrNotFound
	}
	t.Status = "completed"
	now := time.Now().UTC()
	t.EndedAt = &now
	return t, nil
}
func (f *fakeRepo) GetLiveTripUpdate(_ context.Context, tripID string) (*LiveTripUpdate, error) {
	return &LiveTripUpdate{
		TripID:                  tripID,
		Status:                  "active",
		RemainingDistanceMeters: 3200,
		ETARangeSeconds:         map[string]int{"p50": 480, "p80": 566, "p90": 634},
		TrafficFreshness:        "live",
		UpdatedAt:               time.Now().UTC(),
	}, nil
}
func (f *fakeRepo) GetTrafficSegments(context.Context, []string, *float64, *float64, int) ([]SegmentTrafficCondition, error) {
	return []SegmentTrafficCondition{{SegmentID: "seg-1", CurrentSpeedKph: 26.5, CongestionLevel: "moderate", Freshness: "live", Source: "provider"}}, nil
}
func (f *fakeRepo) GetTrafficPredictions(context.Context, []string, int) ([]TrafficForecast, error) {
	return nil, nil // exercises ML/fallback path
}
func (f *fakeRepo) NearbyTransitStops(context.Context, float64, float64, int) ([]TransitStop, error) {
	return []TransitStop{}, nil
}
func (f *fakeRepo) GetTransitDepartures(_ context.Context, stopID string) ([]TransitDeparture, error) {
	now := time.Now().UTC()
	return []TransitDeparture{{RouteID: "METRO-BLUE", StopID: stopID, Headsign: "Raidurg", ScheduledAt: now, ExpectedAt: now.Add(30 * time.Second), IsRealtime: true, DelaySeconds: 30}}, nil
}
func (f *fakeRepo) GetCommuteInsights(_ context.Context, userID string) (*CommuteInsights, error) {
	return &CommuteInsights{UserID: userID, CompletedTrips: 4, AvgDurationMin: 32.5, ModeBreakdown: map[string]int{"metro": 3, "car": 1}}, nil
}
func (f *fakeRepo) SaveTripFeedback(context.Context, string, string, int, string, *int, map[string]any) (string, error) {
	return uuid.NewString(), nil
}
func (f *fakeRepo) CreateRoadHazard(_ context.Context, h RoadHazard) (*RoadHazard, error) {
	h.ID = uuid.NewString()
	h.Status = "active"
	h.ReportedAt = time.Now().UTC()
	return &h, nil
}
func (f *fakeRepo) NearbyRoadHazards(context.Context, float64, float64, int) ([]RoadHazard, error) {
	return []RoadHazard{
		{
			ID:               uuid.NewString(),
			H3Index:          "88608b08a1fffff",
			Location:         GeoPoint{Latitude: 17.448, Longitude: 78.390},
			HazardType:       "pothole",
			Severity:         "high",
			Confidence:       0.92,
			LaneImpactFactor: 0.72,
			ModelVersion:     "rtdetr-yolo-mobilenet-v1",
			Status:           "active",
			ReportedAt:       time.Now().UTC(),
		},
	}, nil
}

func newTestRouter(repo Repository, ml *MLClient) http.Handler {
	r := chi.NewRouter()
	svc := NewService(repo, HeuristicRoutingProvider{}, ml, slog.New(slog.NewTextHandler(io.Discard, nil)))
	Mount(r, svc)
	return r
}

func TestPlanJourneyRankingMultimodalAndShadowML(t *testing.T) {
	ml := mockMLClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewBufferString(`{"p50_seconds":900,"p90_seconds":1200,"model_version":"shadow-stgnn-v1"}`)),
		}, nil
	})

	repo := &fakeRepo{}
	r := newTestRouter(repo, ml)

	body := `{"origin":{"latitude":17.385,"longitude":78.486},"destination":{"latitude":17.448,"longitude":78.390},"modes":["car","metro"],"preferences":{"optimize_for":"RELIABILITY"}}`
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/journeys/plan", bytes.NewBufferString(body)))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		JourneyID    string `json:"journey_id"`
		Alternatives []struct {
			Mode         string     `json:"mode"`
			ModeSequence []string   `json:"mode_sequence"`
			Legs         []RouteLeg `json:"legs"`
			Transfers    int        `json:"transfers"`
			Explanation  []string   `json:"explanation"`
		} `json:"alternatives"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.JourneyID == "" || len(resp.Alternatives) != 2 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	// Under RELIABILITY preference, metro (0.94 reliability) ranks ahead of car (0.72) and expands into 3 multimodal legs.
	if resp.Alternatives[0].Mode != "METRO" || len(resp.Alternatives[0].Legs) != 3 || resp.Alternatives[0].Transfers != 1 {
		t.Fatalf("expected ranked multimodal METRO alternative first, got %+v", resp.Alternatives[0])
	}
	if repo.savedOptions[0].ShadowModelVer != "shadow-stgnn-v1" || repo.savedOptions[0].ShadowP50Seconds != 900 {
		t.Fatalf("expected shadow ML prediction recorded without overwriting provider baseline, got %+v", repo.savedOptions[0])
	}
}

func TestTripLifecycleUpdatesAndBatchLocations(t *testing.T) {
	repo := &fakeRepo{}
	r := newTestRouter(repo, nil)
	userID := uuid.NewString()

	startBody := `{"user_id":"` + userID + `","primary_mode":"two_wheeler","origin":{"latitude":17.385,"longitude":78.486}}`
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/trips", bytes.NewBufferString(startBody)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("start trip expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	var started Trip
	if err := json.Unmarshal(rec.Body.Bytes(), &started); err != nil {
		t.Fatal(err)
	}

	batchBody := `{"samples":[{"latitude":17.386,"longitude":78.487},{"latitude":17.387,"longitude":78.488}]}`
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/trips/"+started.ID+"/locations:batch", bytes.NewBufferString(batchBody)))
	if rec.Code != http.StatusAccepted || repo.samplesCount != 2 {
		t.Fatalf("batch failed: %d count=%d", rec.Code, repo.samplesCount)
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/move/trips/"+started.ID+"/updates", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("updates expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/trips/"+started.ID+"/complete", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("complete expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRecommendDepartureAvoidsPeakAndChecksDeadline(t *testing.T) {
	r := newTestRouter(&fakeRepo{}, nil)
	// Window spans off-peak (07:10 IST) into morning peak (09:00 IST); optimizer should prefer off-peak.
	body := `{"allowed_departure_window":{"from":"2026-11-11T07:10:00+05:30","to":"2026-11-11T09:10:00+05:30"},"arrival_by":"2026-11-11T09:30:00+05:30","mode":"CAR","objective":"MINIMIZE_DELAY_RISK"}`
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/departures/recommend", bytes.NewBufferString(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		RecommendedDeparture string  `json:"recommended_departure"`
		ArrivalConfidence    float64 `json:"arrival_confidence"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.ArrivalConfidence < 0.85 {
		t.Fatalf("expected off-peak confidence >= 0.85, got %v (%s)", out.ArrivalConfidence, rec.Body.String())
	}
}

func TestTrafficTransitAndInsightsEndpoints(t *testing.T) {
	ml := mockMLClient(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewBufferString(`{"predictions":[{"segment_id":"seg-1","speed_kph":31.5,"horizons_minutes":[15,30,60,120],"model_version":"baseline-v0"}]}`)),
		}, nil
	})

	r := newTestRouter(&fakeRepo{}, ml)

	for _, path := range []string{
		"/move/traffic/segments?segment_ids=seg-1",
		"/move/traffic/predictions?segment_ids=seg-1",
		"/move/transit/departures?stop_id=STOP1",
		"/move/insights/commute?user_id=" + uuid.NewString(),
		"/move/hazards/nearby?lat=17.448&lon=78.390&radius_m=1500",
		"/move/stack/libraries",
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s expected 200, got %d: %s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestFivePillarIntelligenceEndpoints(t *testing.T) {
	ml := mockMLClient(func(r *http.Request) (*http.Response, error) {
		var payload string
		switch r.URL.Path {
		case "/v1/predict/demand":
			payload = `{"forecasts":[{"h3_index":"88608b08a1fffff","horizon_minutes":30,"predicted_demand_idx":0.82,"surge_pressure":1.28,"peak_hour_prob":0.91,"transport_avail_score":0.74,"model_version":"tft-prophet-xgb-v1"}]}`
		case "/v1/hotspots/discover":
			payload = `{"hotspots":[{"cluster_id":"hotspot-1","h3_index":"88608b08a1fffff","severity":"high","avg_speed_kph":9.5}],"model_version":"hdbscan-h3-v1"}`
		case "/v1/vision/road-hazards":
			payload = `{"primary_hazard_type":"pothole","severity":"high","confidence":0.93,"model_version":"rtdetr-yolo-mobilenet-v1","detections":[{"h3_index":"88608b08a1fffff","lane_impact":"single_lane_slowdown","bbox":[100,150,240,280]}]}`
		case "/v1/assistant/query":
			payload = `{"detected_language":"te","intent":"route_recommendation","answer":"హైటెక్ సిటీకి మెట్రో ఉత్తమ ఎంపిక.","model_version":"qwen3-bgem3-minilm-v1"}`
		default:
			payload = `{}`
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(bytes.NewBufferString(payload)),
		}, nil
	})

	r := newTestRouter(&fakeRepo{}, ml)

	// 1. Demand prediction (TFT / Prophet / XGBoost)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/demand/predict", bytes.NewBufferString(`{"zones":[{"latitude":17.448,"longitude":78.390}]}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /move/demand/predict expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// 2. Hotspot discovery (H3 + HDBSCAN)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/hotspots", bytes.NewBufferString(`{"samples":[{"latitude":17.448,"longitude":78.390,"speed_kph":8.0}]}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /move/hotspots expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Road hazard vision report (YOLO / RT-DETR / MobileNet)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/hazards/report", bytes.NewBufferString(`{"latitude":17.448,"longitude":78.390,"hint_category":"pothole"}`)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /move/hazards/report expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	// 4. Multilingual AI assistant (Qwen3 + Whisper + BGE-M3 + MiniLM reranker)
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/assistant/query", bytes.NewBufferString(`{"query":"హైటెక్ సిటీకి ఉత్తమ మార్గం ఏది?"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /move/assistant/query expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAdvanceMobilityFeaturesAndExplainability(t *testing.T) {
	r := newTestRouter(&fakeRepo{}, nil)

	// 1. Default multimodal plan returns ConfidenceInterval, ReliabilityBreakdown, ObjectiveScores, and multimodal leg
	planBody := `{"origin":{"latitude":17.385,"longitude":78.486},"destination":{"latitude":17.448,"longitude":78.390},"preferences":{"optimize_for":"BALANCED"}}`
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/journeys/plan", bytes.NewBufferString(planBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var planResp struct {
		ActiveHazards int `json:"active_hazards"`
		Alternatives  []struct {
			Mode                 string               `json:"mode"`
			ConfidenceInterval   ConfidenceInterval   `json:"confidence_interval"`
			ReliabilityBreakdown ReliabilityBreakdown `json:"reliability_breakdown"`
			ObjectiveScores      ObjectiveScores      `json:"objective_scores"`
			CO2Grams             int                  `json:"co2_grams"`
		} `json:"alternatives"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &planResp); err != nil {
		t.Fatal(err)
	}
	if len(planResp.Alternatives) != 5 || planResp.ActiveHazards != 1 {
		t.Fatalf("expected 5 alternatives and 1 active hazard, got %d / %d", len(planResp.Alternatives), planResp.ActiveHazards)
	}
	first := planResp.Alternatives[0]
	if first.ConfidenceInterval.ConfidencePct <= 0 || first.ObjectiveScores.OverallScore <= 0 || len(first.ReliabilityBreakdown.Factors) == 0 {
		t.Fatalf("expected rich CI, reliability breakdown, and objective scores, got %+v", first)
	}

	// 2. Dynamic departure optimizer returns slot_series and time_saved_vs_now_minutes
	depBody := `{"allowed_departure_window":{"from":"2026-11-11T09:00:00+05:30","to":"2026-11-11T12:00:00+05:30"},"mode":"car","objective":"MINIMIZE_DELAY_RISK"}`
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/departures/recommend", bytes.NewBufferString(depBody)))
	if rec.Code != http.StatusOK {
		t.Fatalf("departures/recommend expected 200, got %d", rec.Code)
	}
	var depResp struct {
		TimeSavedVsNowMinutes int   `json:"time_saved_vs_now_minutes"`
		SlotSeries            []any `json:"slot_series"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &depResp)
	if len(depResp.SlotSeries) < 3 || depResp.TimeSavedVsNowMinutes < 1 {
		t.Fatalf("expected slot_series and positive time saved vs peak now, got %+v", depResp)
	}

	// 3. Traffic anomalies & active events endpoints
	for _, p := range []string{"/move/traffic/anomalies?segment_ids=seg-1,seg-2", "/move/events/active?lat=17.4435&lon=78.3772"} {
		rec = httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s expected 200, got %d", p, rec.Code)
		}
	}

	// 4. Meaningful route change hysteresis & post-trip summary
	minor := buildMeaningfulRouteChange(90, 3000, nil, "live", "car")
	if minor.MeaningfulChange || minor.SuppressedMinorCount != 1 {
		t.Fatalf("expected minor 90s delay to be suppressed, got %+v", minor)
	}
	major := buildMeaningfulRouteChange(480, 4500, nil, "live", "car")
	if !major.MeaningfulChange || major.TimeSavedSeconds < 240 {
		t.Fatalf("expected major 480s delay to trigger meaningful change, got %+v", major)
	}
	now := time.Now().UTC()
	earlier := now.Add(-14 * time.Minute)
	summary := buildTripSummary(&Trip{
		PrimaryMode: "metro",
		Origin:      GeoPoint{Latitude: 17.385, Longitude: 78.486},
		Destination: &GeoPoint{Latitude: 17.448, Longitude: 78.390},
		StartedAt:   &earlier,
		EndedAt:     &now,
	}, 9000)
	if summary.TimeSavedSeconds <= 0 || summary.CO2SavedGrams <= 0 || len(summary.Insights) == 0 {
		t.Fatalf("expected meaningful trip summary insights, got %+v", summary)
	}

	// 5. Explainable AI route recommendation fallback
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/move/assistant/query", bytes.NewBufferString(`{"query":"Why is this route recommended?","route_context":{"mode":"METRO","optimize_for":"RELIABILITY","duration_seconds":1140,"reliability_score":0.94,"cost_inr":35}}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("assistant explain expected 200, got %d", rec.Code)
	}
	var aiResp struct {
		Intent         string         `json:"intent"`
		Explainability map[string]any `json:"explainability"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &aiResp)
	if aiResp.Intent != "explain_route" || aiResp.Explainability == nil {
		t.Fatalf("expected explain_route intent and explainability payload, got %+v", aiResp)
	}
}

func TestNearbyPOIsFromOverpassOpenSourceAPI(t *testing.T) {
	origClient := poiHTTP
	t.Cleanup(func() { poiHTTP = origClient })
	t.Setenv("NEXORA_OVERPASS_URL", "http://overpass.mock.local/api/interpreter")
	poiHTTP = &http.Client{
		Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			payload := `{
				"elements": [
					{
						"type": "node",
						"id": 1001,
						"lat": 17.4450,
						"lon": 78.3820,
						"tags": {
							"amenity": "fuel",
							"name": "IndianOil Fuel Station",
							"brand": "IndianOil",
							"fuel:petrol": "yes",
							"fuel:diesel": "yes",
							"opening_hours": "24/7"
						}
					},
					{
						"type": "node",
						"id": 1002,
						"lat": 17.4440,
						"lon": 78.3812,
						"tags": {
							"amenity": "charging_station",
							"name": "Ather Grid Fast Charger",
							"operator": "Ather",
							"socket:ccs2": "yes",
							"socket:type2": "yes",
							"capacity": "4"
						}
					},
					{
						"type": "node",
						"id": 1003,
						"lat": 17.4470,
						"lon": 78.3830,
						"tags": {
							"highway": "speed_camera",
							"maxspeed": "60"
						}
					}
				]
			}`
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(bytes.NewBufferString(payload)),
			}, nil
		}),
	}

	r := newTestRouter(&fakeRepo{}, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/move/pois/nearby?lat=17.4435&lon=78.3805&radius_m=3000", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /move/pois/nearby expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Source string      `json:"source"`
		POIs   []NearbyPOI `json:"pois"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Source != "openstreetmap-overpass" || len(out.POIs) != 3 {
		t.Fatalf("expected 3 Overpass POIs, got source=%s count=%d", out.Source, len(out.POIs))
	}
	// Nearest element is Ather Grid Fast Charger at (17.4440, 78.3812)
	if out.POIs[0].Kind != "ev" || out.POIs[0].Name != "Ather Grid Fast Charger" || out.POIs[0].ConnectorInfo == "" {
		t.Fatalf("unexpected first POI: %+v", out.POIs[0])
	}
	if out.POIs[1].Kind != "fuel" || out.POIs[1].FuelTypes == "" {
		t.Fatalf("unexpected fuel POI: %+v", out.POIs[1])
	}
}

func TestTwelvePillarDigitalTwinSafetyMemoryAndPrivacy(t *testing.T) {
	r := newTestRouter(&fakeRepo{}, nil)

	// 1. Road Memory quorum: 2 observations -> quorum_verified == true
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		body := `{"latitude":17.445,"longitude":78.381,"condition_type":"waterlogging","severity":0.82,"confidence":0.85}`
		req := httptest.NewRequest(http.MethodPost, "/move/road-memory/observe", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("POST /move/road-memory/observe[%d] expected 201, got %d: %s", i, rec.Code, rec.Body.String())
		}
		if i == 1 {
			var out struct {
				Node struct {
					ObservationCount int  `json:"observation_count"`
					QuorumVerified   bool `json:"quorum_verified"`
				} `json:"node"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if out.Node.ObservationCount < 2 || !out.Node.QuorumVerified {
				t.Fatalf("expected quorum verified after 2 observations, got %+v", out.Node)
			}
		}
	}

	// Corridor query returns the remembered node
	recMem := httptest.NewRecorder()
	r.ServeHTTP(recMem, httptest.NewRequest(http.MethodGet, "/move/road-memory/corridor?lat=17.445&lon=78.381", nil))
	if recMem.Code != http.StatusOK || !bytes.Contains(recMem.Body.Bytes(), []byte("waterlogging")) {
		t.Fatalf("expected road memory corridor to contain waterlogging node, got %d %s", recMem.Code, recMem.Body.String())
	}

	// 2. Animal sighting + conflict assessment
	recSight := httptest.NewRecorder()
	sightReq := httptest.NewRequest(http.MethodPost, "/move/safety/animal-sighting", bytes.NewBufferString(`{"latitude":17.445,"longitude":78.381,"species_group":"stray_cattle","corridor_type":"urban_verge","severity":0.85}`))
	sightReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(recSight, sightReq)
	if recSight.Code != http.StatusCreated {
		t.Fatalf("POST /move/safety/animal-sighting expected 201, got %d: %s", recSight.Code, recSight.Body.String())
	}

	recAnimal := httptest.NewRecorder()
	r.ServeHTTP(recAnimal, httptest.NewRequest(http.MethodGet, "/move/safety/animal-conflict?lat=17.445&lon=78.381", nil))
	if recAnimal.Code != http.StatusOK || !bytes.Contains(recAnimal.Body.Bytes(), []byte("conflict_risk_score")) {
		t.Fatalf("GET /move/safety/animal-conflict failed: %d %s", recAnimal.Code, recAnimal.Body.String())
	}

	// 3. Pedestrian safety score
	recPed := httptest.NewRecorder()
	r.ServeHTTP(recPed, httptest.NewRequest(http.MethodGet, "/move/safety/pedestrian?lat=17.445&lon=78.381", nil))
	if recPed.Code != http.StatusOK || !bytes.Contains(recPed.Body.Bytes(), []byte("walk_safety_score")) {
		t.Fatalf("GET /move/safety/pedestrian failed: %d %s", recPed.Code, recPed.Body.String())
	}

	// 4. Crowd prediction & Digital Twin State
	recCrowd := httptest.NewRecorder()
	r.ServeHTTP(recCrowd, httptest.NewRequest(http.MethodGet, "/move/crowd/predict?lat=17.445&lon=78.381", nil))
	if recCrowd.Code != http.StatusOK || !bytes.Contains(recCrowd.Body.Bytes(), []byte("forecasts")) {
		t.Fatalf("GET /move/crowd/predict failed: %d %s", recCrowd.Code, recCrowd.Body.String())
	}

	recTwin := httptest.NewRecorder()
	r.ServeHTTP(recTwin, httptest.NewRequest(http.MethodGet, "/move/digital-twin/state?lat=17.445&lon=78.381", nil))
	if recTwin.Code != http.StatusOK {
		t.Fatalf("GET /move/digital-twin/state failed: %d %s", recTwin.Code, recTwin.Body.String())
	}
	var twinOut struct {
		SystemHealthIndex float64 `json:"system_health_index"`
		CrossDomain       struct {
			DominantInteraction string `json:"dominant_interaction"`
		} `json:"cross_domain"`
	}
	if err := json.Unmarshal(recTwin.Body.Bytes(), &twinOut); err != nil {
		t.Fatal(err)
	}
	if twinOut.SystemHealthIndex <= 0 || twinOut.CrossDomain.DominantInteraction == "" {
		t.Fatalf("invalid digital twin output: %+v", twinOut)
	}

	// 5. Urban What-If Simulation
	recSim := httptest.NewRecorder()
	simReq := httptest.NewRequest(http.MethodPost, "/move/digital-twin/simulate", bytes.NewBufferString(`{"latitude":17.445,"longitude":78.381,"intervention_type":"car_free_zone","intensity_pct":50}`))
	simReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(recSim, simReq)
	if recSim.Code != http.StatusOK {
		t.Fatalf("POST /move/digital-twin/simulate failed: %d %s", recSim.Code, recSim.Body.String())
	}
	var simOut struct {
		Deltas struct {
			PedestrianSafetyDelta float64 `json:"pedestrian_safety_delta"`
			CO2ReductionPct       float64 `json:"co2_reduction_pct"`
		} `json:"deltas"`
	}
	if err := json.Unmarshal(recSim.Body.Bytes(), &simOut); err != nil {
		t.Fatal(err)
	}
	if simOut.Deltas.PedestrianSafetyDelta <= 0 || simOut.Deltas.CO2ReductionPct <= 0 {
		t.Fatalf("expected positive walk safety and CO2 improvements, got %+v", simOut.Deltas)
	}

	// 6. Privacy-Preserving Crowd Intelligence: k=3 suppresses sparse cell and publishes dense cell
	recPriv := httptest.NewRecorder()
	privBody := `{
		"k_min": 3,
		"epsilon": 1.0,
		"samples": [
			{"latitude":17.441,"longitude":78.381,"ephemeral_token":"d1","speed_kph":24},
			{"latitude":17.442,"longitude":78.382,"ephemeral_token":"d2","speed_kph":26},
			{"latitude":17.443,"longitude":78.383,"ephemeral_token":"d3","speed_kph":25},
			{"latitude":17.901,"longitude":78.901,"ephemeral_token":"solo","speed_kph":38}
		]
	}`
	privReq := httptest.NewRequest(http.MethodPost, "/move/privacy/telemetry", bytes.NewBufferString(privBody))
	privReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(recPriv, privReq)
	if recPriv.Code != http.StatusOK {
		t.Fatalf("POST /move/privacy/telemetry failed: %d %s", recPriv.Code, recPriv.Body.String())
	}
	var privOut struct {
		PublishedCount  int `json:"published_count"`
		SuppressedCount int `json:"suppressed_count"`
	}
	if err := json.Unmarshal(recPriv.Body.Bytes(), &privOut); err != nil {
		t.Fatal(err)
	}
	if privOut.PublishedCount != 1 || privOut.SuppressedCount != 1 {
		t.Fatalf("expected 1 published and 1 suppressed cell, got %+v", privOut)
	}

	recPrivStatus := httptest.NewRecorder()
	r.ServeHTTP(recPrivStatus, httptest.NewRequest(http.MethodGet, "/move/privacy/status", nil))
	if recPrivStatus.Code != http.StatusOK || !bytes.Contains(recPrivStatus.Body.Bytes(), []byte("total_cells_suppressed")) {
		t.Fatalf("GET /move/privacy/status failed: %d %s", recPrivStatus.Code, recPrivStatus.Body.String())
	}

	// 7. Autonomous Mobility Agent Proactive Brief
	recBrief := httptest.NewRecorder()
	r.ServeHTTP(recBrief, httptest.NewRequest(http.MethodGet, "/move/assistant/proactive-brief?lat=17.445&lon=78.381", nil))
	if recBrief.Code != http.StatusOK || !bytes.Contains(recBrief.Body.Bytes(), []byte("privacy_shield")) {
		t.Fatalf("GET /move/assistant/proactive-brief failed: %d %s", recBrief.Code, recBrief.Body.String())
	}
}

func TestRedisSpatialRadarAndHotTripCache(t *testing.T) {
	r := chi.NewRouter()
	repo := &fakeRepo{trips: map[string]*Trip{}}
	svc := NewService(repo, nil, nil, slog.Default()).WithCache(cache.NewInMemory())
	Mount(r, svc)

	uid := uuid.NewString()
	startReq := httptest.NewRequest(http.MethodPost, "/move/trips", bytes.NewBufferString(
		`{"user_id":"`+uid+`","primary_mode":"car","origin":{"latitude":12.9716,"longitude":77.5946},"destination":{"latitude":12.9900,"longitude":77.6100}}`,
	))
	recStart := httptest.NewRecorder()
	r.ServeHTTP(recStart, startReq)
	if recStart.Code != http.StatusCreated {
		t.Fatalf("start trip failed: %d %s", recStart.Code, recStart.Body.String())
	}
	var started struct {
		ID string `json:"trip_id"`
	}
	_ = json.Unmarshal(recStart.Body.Bytes(), &started)

	// Upload location batch -> indexes live position into spatial set
	batchReq := httptest.NewRequest(http.MethodPost, "/move/trips/"+started.ID+"/locations:batch", bytes.NewBufferString(
		`{"samples":[{"latitude":12.9750,"longitude":77.5970,"speed_mps":11.5,"heading_degrees":45}]}`,
	))
	recBatch := httptest.NewRecorder()
	r.ServeHTTP(recBatch, batchReq)
	var batchOut struct {
		TripID         string `json:"trip_id"`
		Accepted       int    `json:"accepted"`
		SpatialIndexed bool   `json:"spatial_indexed"`
	}
	if recBatch.Code != http.StatusAccepted || json.Unmarshal(recBatch.Body.Bytes(), &batchOut) != nil || !batchOut.SpatialIndexed {
		t.Fatalf("batch failed or emitted invalid JSON: %d %s", recBatch.Code, recBatch.Body.String())
	}

	// Report hazard -> indexes into active hazard spatial set
	hzReq := httptest.NewRequest(http.MethodPost, "/move/hazards/report", bytes.NewBufferString(
		`{"latitude":12.9760,"longitude":77.5980,"hint_category":"waterlogging"}`,
	))
	recHz := httptest.NewRecorder()
	r.ServeHTTP(recHz, hzReq)
	if recHz.Code != http.StatusCreated {
		t.Fatalf("report hazard failed: %d %s", recHz.Code, recHz.Body.String())
	}

	// Query Redis Spatial Radar nearby
	recRadar := httptest.NewRecorder()
	r.ServeHTTP(recRadar, httptest.NewRequest(http.MethodGet, "/move/spatial/nearby?lat=12.9755&lon=77.5975&radius_m=2000", nil))
	if recRadar.Code != http.StatusOK {
		t.Fatalf("spatial radar failed: %d %s", recRadar.Code, recRadar.Body.String())
	}
	var radar struct {
		SpatialSource     string `json:"spatial_source"`
		ActiveNearbyTrips int    `json:"active_nearby_trips"`
		NearbyHazardCoord []any  `json:"nearby_hazard_coords"`
	}
	if err := json.Unmarshal(recRadar.Body.Bytes(), &radar); err != nil {
		t.Fatal(err)
	}
	if radar.SpatialSource != "redis-geo" || radar.ActiveNearbyTrips != 1 || len(radar.NearbyHazardCoord) != 1 {
		t.Fatalf("expected 1 active trip and 1 hazard in spatial radar, got %+v", radar)
	}

	// Complete trip -> removes active trip from live spatial index
	recDone := httptest.NewRecorder()
	r.ServeHTTP(recDone, httptest.NewRequest(http.MethodPost, "/move/trips/"+started.ID+"/complete", nil))
	if recDone.Code != http.StatusOK {
		t.Fatalf("complete trip failed: %d", recDone.Code)
	}
	recRadarAfter := httptest.NewRecorder()
	r.ServeHTTP(recRadarAfter, httptest.NewRequest(http.MethodGet, "/move/spatial/nearby?lat=12.9755&lon=77.5975&radius_m=2000", nil))
	_ = json.Unmarshal(recRadarAfter.Body.Bytes(), &radar)
	if radar.ActiveNearbyTrips != 0 {
		t.Fatalf("expected 0 active trips in spatial radar after completion, got %d", radar.ActiveNearbyTrips)
	}
}
