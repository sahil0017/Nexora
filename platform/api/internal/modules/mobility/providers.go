package mobility

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
	// Steps is an ordered turn-by-turn maneuver list derived from the route path.
	Steps []RouteStep `json:"steps,omitempty"`
}

// RouteStep is a single turn-by-turn maneuver along a route.
type RouteStep struct {
	Instruction     string  `json:"instruction"`
	Street          string  `json:"street,omitempty"`
	TurnType        string  `json:"turn_type"`
	TurnIcon        string  `json:"turn_icon"`
	DistanceMeters  float64 `json:"distance_meters"`
	Location        GeoPoint `json:"location"`
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

// HeuristicRoutingProvider computes corridor-following baseline routes until Valhalla/OSRM is attached.
// The generated path alternates heading between origin-bearing and destination-bearing corridors so the
// polyline resembles a plausible road route (not a straight chord) while remaining deterministic per OD pair.
type HeuristicRoutingProvider struct{}

func (HeuristicRoutingProvider) GetRoutes(_ context.Context, req RouteRequest) ([]RouteAlternative, error) {
	straightM := haversineMeters(req.Origin.Latitude, req.Origin.Longitude, req.Destination.Latitude, req.Destination.Longitude)
	distM := straightM * 1.25
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

	path := synthesizeCorridorPath(req.Origin, req.Destination, straightM)
	return []RouteAlternative{{
		Provider:        "baseline_corridor",
		Mode:            strings.ToLower(req.Mode),
		DistanceMeters:  math.Round(distM),
		DurationSeconds: dur,
		Geometry:        encodePolyline(path),
		Steps:           synthesizeSteps(path, req.Mode),
	}}, nil
}

// synthesizeCorridorPath builds a plausible multi-waypoint road-like path between origin and destination.
// Waypoints snap to a coarse synthetic grid derived deterministically from the coordinates so repeated
// requests for the same OD pair yield the same path.
func synthesizeCorridorPath(origin, dest GeoPoint, straightM float64) []GeoPoint {
	path := []GeoPoint{origin}
	if straightM < 350 {
		path = append(path, dest)
		return path
	}
	// Midpoint jog: displace perpendicular to the OD bearing by ~12% of distance to mimic real roads.
	bearing := bearingDeg(origin, dest)
	perp := bearing + 90
	midLat, midLon := destinationOffset(origin, bearing, straightM*0.5, perp, straightM*0.12)
	path = append(path, GeoPoint{Latitude: midLat, Longitude: midLon})

	// Two sub-jogs at 27% and 73% of the way with smaller alternating offsets.
	for _, frac := range []float64{0.27, 0.73} {
		pLat, pLon := destinationOffset(origin, bearing, straightM*frac, perp, straightM*(frac-0.5)*0.22)
		path = append(path, GeoPoint{Latitude: pLat, Longitude: pLon})
	}
	path = append(path, dest)
	return path
}

// destinationOffset moves `along` meters along `bearing` from origin, then `side` meters along `sideBearing`.
func destinationOffset(origin GeoPoint, bearingDegF, along, sideBearingDegF, side float64) (float64, float64) {
	aLat, aLon := offsetPoint(origin, bearingDegF, along)
	return offsetPoint(GeoPoint{Latitude: aLat, Longitude: aLon}, sideBearingDegF, side)
}

// offsetPoint projects a point `meters` away along the given bearing.
func offsetPoint(p GeoPoint, bearingDegF, meters float64) (float64, float64) {
	const earthR = 6371000.0
	rad := math.Pi / 180
	br := bearingDegF * rad
	lat1 := p.Latitude * rad
	lon1 := p.Longitude * rad
	sinB := math.Sin(br)
	cosD := meters / earthR
	sinD, _ := math.Sincos(cosD)
	lat2 := math.Asin(math.Sin(lat1)*math.Cos(cosD) + math.Cos(lat1)*sinD*sinB)
	lon2 := lon1 + math.Atan2(sinB*sinD*math.Cos(lat1), math.Cos(cosD)-math.Sin(lat1)*math.Sin(lat2))
	return lat2 / rad, lon2 / rad
}

func bearingDeg(a, b GeoPoint) float64 {
	const rad = math.Pi / 180
	φ1, φ2 := a.Latitude*rad, b.Latitude*rad
	Δλ := (b.Longitude - a.Longitude) * rad
	y := math.Sin(Δλ) * math.Cos(φ2)
	x := math.Cos(φ1)*math.Sin(φ2) - math.Sin(φ1)*math.Cos(φ2)*math.Cos(Δλ)
	deg := math.Atan2(y, x) / rad
	return math.Mod(deg+360, 360)
}

// encodePolyline produces a Google-encoded polyline (precision 5) from the path.
func encodePolyline(path []GeoPoint) string {
	const factor = 1e5
	var sb strings.Builder
	prevLat, prevLon := 0, 0
	for _, pt := range path {
		lat := int(math.Round(pt.Latitude * factor))
		lon := int(math.Round(pt.Longitude * factor))
		encodeValue := func(v int) {
			v <<= 1
			if v < 0 {
				v = ^v
			}
			for v >= 0x20 {
				sb.WriteByte(byte(0x20|(v&0x1f)) + 63)
				v >>= 5
			}
			sb.WriteByte(byte(v) + 63)
		}
		encodeValue(lat - prevLat)
		encodeValue(lon - prevLon)
		prevLat, prevLon = lat, lon
	}
	return sb.String()
}

// synthesizeSteps derives turn-by-turn maneuvers from the path geometry.
func synthesizeSteps(path []GeoPoint, mode string) []RouteStep {
	if len(path) < 2 {
		return nil
	}
	modeName := strings.Title(strings.ToLower(mode)) // nolint:staticcheck
	steps := make([]RouteStep, 0, len(path)+1)
	// Departure step
	steps = append(steps, RouteStep{
		Instruction:    fmt.Sprintf("Head out on the %s corridor", modeName),
		TurnType:       "depart",
		TurnIcon:       "↑",
		DistanceMeters: math.Round(haversineMeters(path[0].Latitude, path[0].Longitude, path[1].Latitude, path[1].Longitude)),
		Location:       path[0],
	})
	// Turn steps at interior joints
	for i := 1; i < len(path)-1; i++ {
		in := bearingDeg(path[i-1], path[i])
		out := bearingDeg(path[i], path[i+1])
		delta := math.Mod(out-in+540, 360) - 180
		turnIcon, turnType := "↑", "continue"
		street := "Local connector"
		switch {
		case delta > 55:
			turnIcon, turnType, street = "↱", "turn_right", "Right-hand arterial"
		case delta < -55:
			turnIcon, turnType, street = "↰", "turn_left", "Left-hand arterial"
		case delta > 25:
			turnIcon, turnType, street = "⤴", "bear_right", "Slight right merge"
		case delta < -25:
			turnIcon, turnType, street = "⤵", "bear_left", "Slight left merge"
		}
		steps = append(steps, RouteStep{
			Instruction:    fmt.Sprintf("%s onto %s", turnWord(turnType), street),
			Street:         street,
			TurnType:       turnType,
			TurnIcon:       turnIcon,
			DistanceMeters: math.Round(haversineMeters(path[i].Latitude, path[i].Longitude, path[i+1].Latitude, path[i+1].Longitude)),
			Location:       path[i],
		})
	}
	// Arrival step
	last := path[len(path)-1]
	prev := path[len(path)-2]
	steps = append(steps, RouteStep{
		Instruction:    fmt.Sprintf("Arrive at %s destination", modeName),
		Street:         "Destination approach",
		TurnType:       "arrive",
		TurnIcon:       "⚑",
		DistanceMeters: math.Round(haversineMeters(prev.Latitude, prev.Longitude, last.Latitude, last.Longitude)),
		Location:       last,
	})
	return steps
}

func turnWord(turnType string) string {
	switch turnType {
	case "turn_right":
		return "Turn right"
	case "turn_left":
		return "Turn left"
	case "bear_right":
		return "Bear right"
	case "bear_left":
		return "Bear left"
	default:
		return "Continue"
	}
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
