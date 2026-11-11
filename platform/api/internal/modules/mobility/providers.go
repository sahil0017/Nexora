package mobility

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"time"
)

// GeoPoint represents a WGS84 latitude/longitude pair.
type GeoPoint struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// RouteRequest defines inputs for external or self-hosted routing providers.
type RouteRequest struct {
	Origin        GeoPoint  `json:"origin"`
	Destination   GeoPoint  `json:"destination"`
	Mode          string    `json:"mode"`
	DepartureTime time.Time `json:"departure_time"`
}

// RouteAlternative is a provider-agnostic candidate route.
type RouteAlternative struct {
	Provider        string   `json:"provider"`
	Mode            string   `json:"mode"`
	SegmentIDs      []string `json:"segment_ids,omitempty"`
	DistanceMeters  float64  `json:"distance_meters"`
	DurationSeconds int      `json:"duration_seconds"`
	Geometry        string   `json:"geometry"`
}

// TrafficObservation represents segment-level speed conditions from a provider.
type TrafficObservation struct {
	SegmentID  string    `json:"segment_id"`
	SpeedKmph  float64   `json:"speed_kmph"`
	Source     string    `json:"source"`
	ObservedAt time.Time `json:"observed_at"`
}

// TransitDeparture represents a scheduled or real-time transit departure.
type TransitDeparture struct {
	RouteID      string    `json:"route_id"`
	StopID       string    `json:"stop_id"`
	Headsign     string    `json:"headsign"`
	ScheduledAt  time.Time `json:"scheduled_at"`
	ExpectedAt   time.Time `json:"expected_at"`
	IsRealtime   bool      `json:"is_realtime"`
	DelaySeconds int       `json:"delay_seconds"`
}

// RoutingProvider abstracts Valhalla/OSRM/external map routing vendors.
type RoutingProvider interface {
	GetRoutes(ctx context.Context, request RouteRequest) ([]RouteAlternative, error)
}

// TrafficProvider abstracts external live traffic feeds.
type TrafficProvider interface {
	GetTraffic(ctx context.Context, segmentIDs []string, at time.Time) ([]TrafficObservation, error)
}

// TransitProvider abstracts GTFS/GTFS-RT transit departure feeds.
type TransitProvider interface {
	GetDepartures(ctx context.Context, stopID string, at time.Time) ([]TransitDeparture, error)
}

// HeuristicRoutingProvider computes distance-based baseline routes until Valhalla/OSRM is attached.
type HeuristicRoutingProvider struct{}

func (HeuristicRoutingProvider) GetRoutes(_ context.Context, req RouteRequest) ([]RouteAlternative, error) {
	distM := haversineMeters(req.Origin.Latitude, req.Origin.Longitude, req.Destination.Latitude, req.Destination.Longitude) * 1.25
	if distM < 200 {
		distM = 200
	}
	speedMps := map[string]float64{
		"walk":        1.35,
		"bicycle":     4.2,
		"two_wheeler": 7.8,
		"car":         7.2,
		"bus":         5.0,
		"metro":       9.5,
	}[strings.ToLower(req.Mode)]
	if speedMps == 0 {
		speedMps = 7.0
	}
	dur := int(math.Max(60, math.Round(distM/speedMps)))
	return []RouteAlternative{{
		Provider:        "baseline_haversine",
		Mode:            strings.ToLower(req.Mode),
		DistanceMeters:  math.Round(distM),
		DurationSeconds: dur,
		Geometry:        "",
	}}, nil
}

// JourneyPrediction is returned by the Python ML inference service.
type JourneyPrediction struct {
	P50Seconds       int     `json:"p50_seconds"`
	P80Seconds       int     `json:"p80_seconds,omitempty"`
	P90Seconds       int     `json:"p90_seconds"`
	ReliabilityScore float64 `json:"reliability_score,omitempty"`
	ActiveHazards    int     `json:"active_hazards,omitempty"`
	HotspotScore     float64 `json:"hotspot_score,omitempty"`
	ModelVersion     string  `json:"model_version"`
}

// SegmentTrafficPrediction is a segment-level speed forecast from nexora-ml.
type SegmentTrafficPrediction struct {
	SegmentID       string  `json:"segment_id"`
	SpeedKph        float64 `json:"speed_kph"`
	HorizonsMinutes []int   `json:"horizons_minutes"`
	ModelVersion    string  `json:"model_version"`
}

// MLClient calls nexora-ml with a tight timeout and falls back cleanly on error.
type MLClient struct {
	baseURL string
	http    *http.Client
}

// NewMLClient builds an ML inference client with persistent HTTP keep-alive pooling to the Python brain.
func NewMLClient(baseURL string) *MLClient {
	transport := &http.Transport{
		MaxIdleConns:        64,
		MaxIdleConnsPerHost: 32,
		IdleConnTimeout:     90 * time.Second,
	}
	return NewMLClientWithHTTP(baseURL, &http.Client{
		Timeout:   1200 * time.Millisecond,
		Transport: transport,
	})
}

// NewMLClientWithHTTP builds an ML inference client with a custom http.Client (e.g. for tests).
func NewMLClientWithHTTP(baseURL string, client *http.Client) *MLClient {
	if client == nil {
		client = &http.Client{Timeout: 1200 * time.Millisecond}
	}
	return &MLClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    client,
	}
}

// PredictJourney requests p50/p80/p90 ETA + reliability from nexora-ml and returns ok=false when unavailable.
func (c *MLClient) PredictJourney(ctx context.Context, segmentIDs []string, mode string, departure time.Time, distanceMeters float64) (JourneyPrediction, bool) {
	if c == nil || c.baseURL == "" {
		return JourneyPrediction{}, false
	}
	payload, err := json.Marshal(map[string]any{
		"segment_ids":     segmentIDs,
		"mode":            strings.ToLower(mode),
		"departure_time":  departure.UTC().Format(time.RFC3339),
		"distance_meters": distanceMeters,
	})
	if err != nil {
		return JourneyPrediction{}, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/predict/journey", bytes.NewReader(payload))
	if err != nil {
		return JourneyPrediction{}, false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return JourneyPrediction{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return JourneyPrediction{}, false
	}
	var out JourneyPrediction
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.P50Seconds <= 0 {
		return JourneyPrediction{}, false
	}
	return out, true
}

// PredictTraffic requests segment-level speed forecasts from nexora-ml.
func (c *MLClient) PredictTraffic(ctx context.Context, segmentIDs []string) ([]SegmentTrafficPrediction, bool) {
	if c == nil || c.baseURL == "" || len(segmentIDs) == 0 {
		return nil, false
	}
	payload, err := json.Marshal(map[string]any{"segment_ids": segmentIDs})
	if err != nil {
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/predict/traffic", bytes.NewReader(payload))
	if err != nil {
		return nil, false
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	var out struct {
		Predictions []SegmentTrafficPrediction `json:"predictions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || len(out.Predictions) == 0 {
		return nil, false
	}
	return out.Predictions, true
}

// PostJSON calls an arbitrary POST endpoint on nexora-ml and returns the decoded JSON map.
func (c *MLClient) PostJSON(ctx context.Context, path string, reqBody any) (map[string]any, bool) {
	if c == nil || c.baseURL == "" {
		return nil, false
	}
	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, false
	}
	return out, true
}

// GetJSON calls an arbitrary GET endpoint on nexora-ml.
func (c *MLClient) GetJSON(ctx context.Context, path string) (map[string]any, bool) {
	if c == nil || c.baseURL == "" {
		return nil, false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, false
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, false
	}
	return out, true
}

func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadiusM * math.Asin(math.Sqrt(a))
}
