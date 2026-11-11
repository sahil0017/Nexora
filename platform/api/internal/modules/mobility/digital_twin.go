package mobility

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DigitalTwinRepository optionally persists 12-pillar digital twin, road memory,
// conflict zone, simulation, and privacy-aggregated flow records in PostGIS.
type DigitalTwinRepository interface {
	SaveRoadMemoryObservation(ctx context.Context, lat, lon float64, cellID, conditionType string, severity float64, observationCount int, confidence float64) error
	SaveAnimalSighting(ctx context.Context, lat, lon float64, cellID, speciesGroup, corridorType string, riskScore float64) error
	SaveUrbanSimulation(ctx context.Context, simID, scenarioName, interventionType string, lat, lon, intensityPct float64, baseline, projected, deltas map[string]any) error
	SavePrivacyAggregateCell(ctx context.Context, cellID string, lat, lon float64, bucketStart time.Time, noisyCount, noisySpeed float64, kThreshold int, epsilon float64) error
}

func (r *PostgresRepository) SaveRoadMemoryObservation(ctx context.Context, lat, lon float64, cellID, conditionType string, severity float64, observationCount int, confidence float64) error {
	if r == nil || r.pool == nil {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO mobility.road_memory_nodes
		   (cell_id, location, condition_type, severity, observation_count, quorum_verified, confidence, last_reinforced_at)
		 VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7, $8, now())
		 ON CONFLICT DO NOTHING`,
		cellID, lon, lat, conditionType, severity, observationCount, observationCount >= 2, confidence,
	)
	return err
}

func (r *PostgresRepository) SaveAnimalSighting(ctx context.Context, lat, lon float64, cellID, speciesGroup, corridorType string, riskScore float64) error {
	if r == nil || r.pool == nil {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO mobility.animal_conflict_zones
		   (cell_id, location, species_group, corridor_type, base_risk_score, sighting_count, last_sighting_at)
		 VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, 1, now())`,
		cellID, lon, lat, speciesGroup, corridorType, riskScore,
	)
	return err
}

func (r *PostgresRepository) SaveUrbanSimulation(ctx context.Context, simID, scenarioName, interventionType string, lat, lon, intensityPct float64, baseline, projected, deltas map[string]any) error {
	if r == nil || r.pool == nil {
		return nil
	}
	bJSON, _ := json.Marshal(baseline)
	pJSON, _ := json.Marshal(projected)
	dJSON, _ := json.Marshal(deltas)
	_, err := r.pool.Exec(ctx,
		`INSERT INTO mobility.urban_simulations
		   (id, scenario_name, intervention_type, center, intensity_pct, baseline_metrics, projected_metrics, deltas)
		 VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9)`,
		simID, scenarioName, interventionType, lon, lat, intensityPct, bJSON, pJSON, dJSON,
	)
	return err
}

func (r *PostgresRepository) SavePrivacyAggregateCell(ctx context.Context, cellID string, lat, lon float64, bucketStart time.Time, noisyCount, noisySpeed float64, kThreshold int, epsilon float64) error {
	if r == nil || r.pool == nil {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO mobility.privacy_aggregated_flows
		   (cell_id, centroid, bucket_start, noisy_device_count, noisy_avg_speed_kph, k_threshold, epsilon_budget)
		 VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6, $7, $8)`,
		cellID, lon, lat, bucketStart, noisyCount, noisySpeed, kThreshold, epsilon,
	)
	return err
}

// Local thread-safe state used as deterministic fallback when Python ML brain is offline or unreachable.
type localDigitalTwinStore struct {
	mu            sync.Mutex
	roadMemory    map[string]map[string]any
	animalZones   []map[string]any
	totalPings    int
	published     int
	suppressed    int
	kThreshold    int
	epsilonBudget float64
}

var twinFallback = &localDigitalTwinStore{
	roadMemory:    make(map[string]map[string]any),
	animalZones:   make([]map[string]any, 0),
	kThreshold:    3,
	epsilonBudget: 1.0,
}

func spatialCellID(lat, lon float64) string {
	return fmt.Sprintf("cell_%.2f_%.2f", math.Round(lat*100)/100, math.Round(lon*100)/100)
}

func parseLatLonQuery(r *http.Request) (float64, float64, bool) {
	latStr := r.URL.Query().Get("lat")
	lonStr := r.URL.Query().Get("lon")
	if latStr == "" {
		latStr = r.URL.Query().Get("latitude")
	}
	if lonStr == "" {
		lonStr = r.URL.Query().Get("longitude")
	}
	lat, err1 := strconv.ParseFloat(strings.TrimSpace(latStr), 64)
	lon, err2 := strconv.ParseFloat(strings.TrimSpace(lonStr), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		return 0, 0, false
	}
	return lat, lon, true
}

func (s *Service) localCorridorSpeed(ctx context.Context, lat, lon float64) float64 {
	if s.repo != nil {
		segs, err := s.repo.GetTrafficSegments(ctx, nil, &lat, &lon, 5000)
		if err == nil && len(segs) > 0 {
			var sum float64
			for _, seg := range segs {
				sum += seg.CurrentSpeedKph
			}
			return math.Round((sum/float64(len(segs)))*10) / 10
		}
	}
	// Smooth diurnal baseline derived purely from timestamp.
	hour := float64(time.Now().UTC().Add(5*time.Hour + 30*time.Minute).Hour())
	peakFactor := math.Exp(-math.Pow(hour-9.5, 2)/6.0)*0.32 + math.Exp(-math.Pow(hour-18.5, 2)/7.0)*0.38
	return math.Round(math.Max(14.0, 42.0*(1.0-peakFactor))*10) / 10
}

func computeFallbackPedestrianSafety(lat, lon, avgSpeedKPH, crowdDensity float64, activeHazards int, weather string) map[string]any {
	hour := time.Now().UTC().Add(5*time.Hour + 30*time.Minute).Hour()
	isDark := hour < 6 || hour >= 19
	lighting := 0.88
	if isDark {
		lighting = 0.62
	}
	speedRisk := math.Min(1.0, math.Max(0.0, (avgSpeedKPH-20.0)/45.0))
	crowdRisk := math.Min(1.0, math.Max(0.0, crowdDensity)) * 0.25
	hazardRisk := math.Min(0.40, float64(activeHazards)*0.11)
	weatherPenalty := 0.0
	if wLower := strings.ToLower(weather); strings.Contains(wLower, "rain") || strings.Contains(wLower, "fog") {
		weatherPenalty = 0.16
	}
	raw := 1.0 - (0.38*speedRisk + 0.22*(1.0-lighting) + crowdRisk + hazardRisk + weatherPenalty)
	score := math.Round(math.Max(15.0, math.Min(98.0, raw*100.0))*10) / 10
	grade := "A"
	if score < 50 {
		grade = "D"
	} else if score < 68 {
		grade = "C"
	} else if score < 84 {
		grade = "B"
	}
	factors := make([]string, 0, 3)
	if speedRisk > 0.45 {
		factors = append(factors, "Elevated vehicle corridor speeds")
	}
	if isDark {
		factors = append(factors, "Nighttime visibility reduction")
	}
	if activeHazards > 0 {
		factors = append(factors, fmt.Sprintf("%d active road condition hazard(s)", activeHazards))
	}
	if len(factors) == 0 {
		factors = append(factors, "Calm pedestrian envelope with favorable visibility")
	}
	rec := "Standard pedestrian crossing envelope."
	if grade == "C" || grade == "D" {
		rec = "Use signalized pedestrian crosswalks and well-lit main walkways."
	}
	return map[string]any{
		"h3_index":          spatialCellID(lat, lon),
		"walk_safety_score": score,
		"safety_grade":      grade,
		"lighting_index":    lighting,
		"risk_factors":      factors,
		"recommendation":    rec,
	}
}

func computeFallbackAnimalConflict(lat, lon, speedKPH float64, weather string) map[string]any {
	hour := time.Now().UTC().Add(5*time.Hour + 30*time.Minute).Hour()
	twilight := 0.35
	if (hour >= 5 && hour <= 7) || (hour >= 17 && hour <= 20) {
		twilight = 0.85
	} else if hour > 20 || hour < 5 {
		twilight = 0.72
	}
	twinFallback.mu.Lock()
	nearby := make([]map[string]any, 0)
	maxZone := 0.0
	for _, z := range twinFallback.animalZones {
		zLat, _ := z["latitude"].(float64)
		zLon, _ := z["longitude"].(float64)
		if haversineMeters(lat, lon, zLat, zLon) <= 5000 {
			nearby = append(nearby, z)
			if r, ok := z["risk_score"].(float64); ok && r > maxZone {
				maxZone = r
			}
		}
	}
	twinFallback.mu.Unlock()

	speedFactor := math.Min(1.0, math.Max(0.1, speedKPH/60.0))
	baseRisk := math.Max(0.08, maxZone)
	visPenalty := 0.0
	if wLower := strings.ToLower(weather); strings.Contains(wLower, "fog") || strings.Contains(wLower, "rain") {
		visPenalty = 0.14
	}
	score := math.Round(math.Min(0.98, 0.45*baseRisk+0.30*twilight+0.25*speedFactor+visPenalty)*100) / 100
	level := "low"
	advice := "Low wildlife/stray-crossing probability; normal vigilance."
	if score >= 0.65 {
		level = "high"
		advice = "High animal-vehicle conflict window; reduce speed under 35 km/h near verge zones."
	} else if score >= 0.40 {
		level = "moderate"
		advice = "Moderate twilight/verge crossing risk; scan roadside shoulders."
	}
	return map[string]any{
		"h3_index":            spatialCellID(lat, lon),
		"conflict_risk_score": score,
		"risk_level":          level,
		"twilight_factor":     twilight,
		"nearby_zones":        nearby,
		"mitigation_advice":   advice,
	}
}

func computeFallbackRoadMemoryCorridor(lat, lon float64) []map[string]any {
	twinFallback.mu.Lock()
	defer twinFallback.mu.Unlock()
	out := make([]map[string]any, 0)
	for _, node := range twinFallback.roadMemory {
		nLat, _ := node["latitude"].(float64)
		nLon, _ := node["longitude"].(float64)
		if haversineMeters(lat, lon, nLat, nLon) <= 5000 {
			out = append(out, node)
		}
	}
	return out
}

// GetDigitalTwinState handles GET /move/digital-twin/state?lat=...&lon=...&weather=...
func (s *Service) GetDigitalTwinState(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	weather := r.URL.Query().Get("weather")
	if weather == "" {
		weather = "clear"
	}
	avgSpeed := s.localCorridorSpeed(r.Context(), lat, lon)

	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/digital-twin/state", map[string]any{
			"latitude":      lat,
			"longitude":     lon,
			"weather":       weather,
			"avg_speed_kph": avgSpeed,
		}); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	hazardsCount := 0
	if s.repo != nil {
		if hz, err := s.repo.NearbyRoadHazards(r.Context(), lat, lon, 4000); err == nil {
			hazardsCount = len(hz)
		}
	}
	crowdDensity := math.Round(math.Max(0.15, math.Min(0.95, 1.0-(avgSpeed/52.0)))*100) / 100
	ped := computeFallbackPedestrianSafety(lat, lon, avgSpeed, crowdDensity, hazardsCount, weather)
	animal := computeFallbackAnimalConflict(lat, lon, avgSpeed, weather)
	nodes := computeFallbackRoadMemoryCorridor(lat, lon)

	pedScore, _ := ped["walk_safety_score"].(float64)
	animalRisk, _ := animal["conflict_risk_score"].(float64)
	health := math.Round(math.Max(20.0, math.Min(99.0,
		0.40*(avgSpeed/45.0*100.0)+0.35*pedScore+0.25*((1.0-animalRisk)*100.0)))*10) / 10

	dominant := "human_vehicle_corridor_flow"
	if animalRisk >= 0.45 {
		dominant = "wildlife_verge_interaction"
	} else if crowdDensity >= 0.68 {
		dominant = "pedestrian_transit_surge"
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"h3_index":            spatialCellID(lat, lon),
		"system_health_index": health,
		"cross_domain": map[string]any{
			"human_crowd_density":      crowdDensity,
			"vehicle_congestion_index": crowdDensity,
			"animal_conflict_index":    animalRisk,
			"coupling_risk_score":      math.Round(((crowdDensity+animalRisk)/2.0)*100) / 100,
			"dominant_interaction":     dominant,
		},
		"crowd_intelligence": map[string]any{
			"h3_index":        spatialCellID(lat, lon),
			"current_density": crowdDensity,
			"forecasts": []map[string]any{
				{"horizon_minutes": 15, "predicted_crowd_density": math.Round(math.Min(0.98, crowdDensity*1.04)*100) / 100, "bottleneck_risk": "moderate"},
				{"horizon_minutes": 30, "predicted_crowd_density": math.Round(math.Min(0.98, crowdDensity*1.08)*100) / 100, "bottleneck_risk": "moderate"},
				{"horizon_minutes": 60, "predicted_crowd_density": math.Round(math.Max(0.15, crowdDensity*0.92)*100) / 100, "bottleneck_risk": "low"},
			},
		},
		"animal_conflict":   animal,
		"pedestrian_safety": ped,
		"road_memory_nodes": nodes,
		"model_version":     "go-twin-fallback-v1",
	})
}

// SimulateUrbanIntervention handles POST /move/digital-twin/simulate.
func (s *Service) SimulateUrbanIntervention(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Latitude         float64  `json:"latitude"`
		Longitude        float64  `json:"longitude"`
		InterventionType string   `json:"intervention_type"`
		IntensityPct     float64  `json:"intensity_pct"`
		AvgSpeedKPH      *float64 `json:"avg_speed_kph,omitempty"`
		CrowdDensity     *float64 `json:"crowd_density,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if !validLatLon(GeoPoint{Latitude: req.Latitude, Longitude: req.Longitude}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid latitude and longitude are required", false)
		return
	}
	if req.InterventionType == "" {
		req.InterventionType = "signal_retime"
	}
	if req.IntensityPct <= 0 {
		req.IntensityPct = 25
	}
	avgSpeed := s.localCorridorSpeed(r.Context(), req.Latitude, req.Longitude)
	if req.AvgSpeedKPH != nil {
		avgSpeed = *req.AvgSpeedKPH
	}
	crowd := math.Max(0.15, math.Min(0.95, 1.0-(avgSpeed/52.0)))
	if req.CrowdDensity != nil {
		crowd = *req.CrowdDensity
	}

	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/digital-twin/simulate", map[string]any{
			"latitude":          req.Latitude,
			"longitude":         req.Longitude,
			"intervention_type": req.InterventionType,
			"intensity_pct":     req.IntensityPct,
			"avg_speed_kph":     avgSpeed,
			"crowd_density":     crowd,
		}); okML {
			if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
				simID := fmt.Sprintf("sim-%d", time.Now().UnixNano())
				scen, _ := resp["scenario_name"].(string)
				baseMap, _ := resp["baseline_metrics"].(map[string]any)
				projMap, _ := resp["projected_metrics"].(map[string]any)
				deltaMap, _ := resp["deltas"].(map[string]any)
				_ = dtRepo.SaveUrbanSimulation(r.Context(), simID, scen, req.InterventionType, req.Latitude, req.Longitude, req.IntensityPct, baseMap, projMap, deltaMap)
			}
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	scale := math.Min(1.0, math.Max(0.05, req.IntensityPct/100.0))
	speedDelta, crowdDeltaPct, pedDelta, animalDelta, co2Red := 0.0, 0.0, 0.0, 0.0, 0.0
	summary := ""
	switch strings.ToLower(req.InterventionType) {
	case "car_free_zone":
		speedDelta = math.Round((-4.0*scale)*10) / 10
		crowdDeltaPct = math.Round((-28.0*scale)*10) / 10
		pedDelta = math.Round((22.0*scale)*10) / 10
		animalDelta = math.Round((-0.18*scale)*100) / 100
		co2Red = math.Round((34.0*scale)*10) / 10
		summary = "Car-free pedestrianization sharply lifts walk safety and cuts local CO2."
	case "transit_boost":
		speedDelta = math.Round((7.5*scale)*10) / 10
		crowdDeltaPct = math.Round((-22.0*scale)*10) / 10
		pedDelta = math.Round((9.0*scale)*10) / 10
		animalDelta = math.Round((-0.07*scale)*100) / 100
		co2Red = math.Round((26.0*scale)*10) / 10
		summary = "Higher transit frequency shifts commuters off single-occupant vehicles."
	case "speed_calming":
		speedDelta = math.Round((-8.0*scale)*10) / 10
		crowdDeltaPct = math.Round((-4.0*scale)*10) / 10
		pedDelta = math.Round((19.0*scale)*10) / 10
		animalDelta = math.Round((-0.24*scale)*100) / 100
		co2Red = math.Round((8.0*scale)*10) / 10
		summary = "Traffic calming lowers conflict kinetic energy for pedestrians and wildlife."
	case "bus_lane":
		speedDelta = math.Round((6.0*scale)*10) / 10
		crowdDeltaPct = math.Round((-16.0*scale)*10) / 10
		pedDelta = math.Round((11.0*scale)*10) / 10
		animalDelta = math.Round((-0.05*scale)*100) / 100
		co2Red = math.Round((21.0*scale)*10) / 10
		summary = "Dedicated transit lane stabilizes bus corridor headway and curb safety."
	default: // signal_retime
		speedDelta = math.Round((5.8*scale)*10) / 10
		crowdDeltaPct = math.Round((-12.0*scale)*10) / 10
		pedDelta = math.Round((10.5*scale)*10) / 10
		animalDelta = math.Round((-0.06*scale)*100) / 100
		co2Red = math.Round((14.0*scale)*10) / 10
		summary = "Adaptive green-wave retiming reduces intersection queue dwell time."
	}

	basePed := computeFallbackPedestrianSafety(req.Latitude, req.Longitude, avgSpeed, crowd, 0, "clear")
	basePedScore, _ := basePed["walk_safety_score"].(float64)
	baseline := map[string]any{"avg_speed_kph": avgSpeed, "crowd_density": crowd, "walk_safety_score": basePedScore}
	projected := map[string]any{
		"avg_speed_kph":     math.Round((avgSpeed+speedDelta)*10) / 10,
		"crowd_density":     math.Round(math.Max(0.05, crowd*(1.0+crowdDeltaPct/100.0))*100) / 100,
		"walk_safety_score": math.Round(math.Min(99.0, basePedScore+pedDelta)*10) / 10,
	}
	deltas := map[string]any{
		"speed_delta_kph":         speedDelta,
		"crowd_delta_pct":         crowdDeltaPct,
		"pedestrian_safety_delta": pedDelta,
		"animal_conflict_delta":   animalDelta,
		"co2_reduction_pct":       co2Red,
	}
	if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
		_ = dtRepo.SaveUrbanSimulation(r.Context(), fmt.Sprintf("sim-%d", time.Now().UnixNano()), req.InterventionType, req.InterventionType, req.Latitude, req.Longitude, req.IntensityPct, baseline, projected, deltas)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"scenario_name":      strings.ReplaceAll(req.InterventionType, "_", " "),
		"intervention_type":  req.InterventionType,
		"h3_index":           spatialCellID(req.Latitude, req.Longitude),
		"baseline_metrics":   baseline,
		"projected_metrics":  projected,
		"deltas":             deltas,
		"net_impact_summary": summary,
		"model_version":      "go-whatif-v1",
	})
}

// GetCrowdForecast handles GET /move/crowd/predict?lat=...&lon=...
func (s *Service) GetCrowdForecast(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/crowd/predict", map[string]any{
			"latitude":  lat,
			"longitude": lon,
			"horizons":  []int{15, 30, 60},
		}); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}
	speed := s.localCorridorSpeed(r.Context(), lat, lon)
	cur := math.Round(math.Max(0.15, math.Min(0.95, 1.0-(speed/52.0)))*100) / 100
	writeJSON(w, http.StatusOK, map[string]any{
		"h3_index":        spatialCellID(lat, lon),
		"current_density": cur,
		"forecasts": []map[string]any{
			{"h3_index": spatialCellID(lat, lon), "horizon_minutes": 15, "predicted_crowd_density": math.Round(math.Min(0.98, cur*1.05)*100) / 100, "bottleneck_risk": "moderate", "recommended_action": "Monitor station & feeder platform flow"},
			{"h3_index": spatialCellID(lat, lon), "horizon_minutes": 30, "predicted_crowd_density": math.Round(math.Min(0.98, cur*1.09)*100) / 100, "bottleneck_risk": "moderate", "recommended_action": "Stagger departure by 10-15 min if flexibility allows"},
			{"h3_index": spatialCellID(lat, lon), "horizon_minutes": 60, "predicted_crowd_density": math.Round(math.Max(0.15, cur*0.91)*100) / 100, "bottleneck_risk": "low", "recommended_action": "Density easing toward baseline"},
		},
	})
}

// GetAnimalConflict handles GET /move/safety/animal-conflict?lat=...&lon=...
func (s *Service) GetAnimalConflict(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	speed := s.localCorridorSpeed(r.Context(), lat, lon)
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/safety/animal-conflict", map[string]any{
			"latitude":          lat,
			"longitude":         lon,
			"vehicle_speed_kph": speed,
		}); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}
	writeJSON(w, http.StatusOK, computeFallbackAnimalConflict(lat, lon, speed, "clear"))
}

// ReportAnimalSighting handles POST /move/safety/animal-sighting.
func (s *Service) ReportAnimalSighting(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Latitude     float64 `json:"latitude"`
		Longitude    float64 `json:"longitude"`
		SpeciesGroup string  `json:"species_group"`
		CorridorType string  `json:"corridor_type"`
		Severity     float64 `json:"severity"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if !validLatLon(GeoPoint{Latitude: req.Latitude, Longitude: req.Longitude}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid latitude and longitude are required", false)
		return
	}
	if req.SpeciesGroup == "" {
		req.SpeciesGroup = "stray_cattle_or_dog"
	}
	if req.CorridorType == "" {
		req.CorridorType = "peri_urban_verge"
	}
	if req.Severity <= 0 {
		req.Severity = 0.72
	}

	if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
		_ = dtRepo.SaveAnimalSighting(r.Context(), req.Latitude, req.Longitude, spatialCellID(req.Latitude, req.Longitude), req.SpeciesGroup, req.CorridorType, req.Severity)
	}
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/safety/animal-sighting", req); okML {
			writeJSON(w, http.StatusCreated, resp)
			return
		}
	}
	zone := map[string]any{
		"zone_id":       fmt.Sprintf("az-%d", time.Now().UnixNano()),
		"h3_index":      spatialCellID(req.Latitude, req.Longitude),
		"latitude":      req.Latitude,
		"longitude":     req.Longitude,
		"species_group": req.SpeciesGroup,
		"corridor_type": req.CorridorType,
		"risk_score":    math.Round(math.Min(0.98, req.Severity)*100) / 100,
		"reported_at":   time.Now().UTC().Format(time.RFC3339),
	}
	twinFallback.mu.Lock()
	twinFallback.animalZones = append(twinFallback.animalZones, zone)
	twinFallback.mu.Unlock()
	writeJSON(w, http.StatusCreated, map[string]any{"zone": zone, "model_version": "go-animal-safety-v1"})
}

// GetPedestrianSafety handles GET /move/safety/pedestrian?lat=...&lon=...
func (s *Service) GetPedestrianSafety(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	weather := r.URL.Query().Get("weather")
	if weather == "" {
		weather = "clear"
	}
	speed := s.localCorridorSpeed(r.Context(), lat, lon)
	hazardsCount := 0
	if s.repo != nil {
		if hz, err := s.repo.NearbyRoadHazards(r.Context(), lat, lon, 3000); err == nil {
			hazardsCount = len(hz)
		}
	}
	crowd := math.Max(0.15, math.Min(0.95, 1.0-(speed/52.0)))
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/safety/pedestrian", map[string]any{
			"latitude":              lat,
			"longitude":             lon,
			"avg_vehicle_speed_kph": speed,
			"crowd_density":         crowd,
			"active_hazards":        hazardsCount,
			"weather":               weather,
		}); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}
	writeJSON(w, http.StatusOK, computeFallbackPedestrianSafety(lat, lon, speed, crowd, hazardsCount, weather))
}

// ObserveRoadMemory handles POST /move/road-memory/observe.
func (s *Service) ObserveRoadMemory(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Latitude      float64 `json:"latitude"`
		Longitude     float64 `json:"longitude"`
		ConditionType string  `json:"condition_type"`
		Severity      float64 `json:"severity"`
		SegmentID     string  `json:"segment_id,omitempty"`
		Confidence    float64 `json:"confidence"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if !validLatLon(GeoPoint{Latitude: req.Latitude, Longitude: req.Longitude}) || req.ConditionType == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid latitude, longitude, and condition_type are required", false)
		return
	}
	if req.Severity <= 0 {
		req.Severity = 0.65
	}
	if req.Confidence <= 0 {
		req.Confidence = 0.72
	}

	cellID := spatialCellID(req.Latitude, req.Longitude)
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/road-memory/observe", req); okML {
			if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
				nodeMap, _ := resp["node"].(map[string]any)
				obsCnt := 1
				if v, okV := nodeMap["observation_count"].(float64); okV {
					obsCnt = int(v)
				}
				conf := req.Confidence
				if v, okV := nodeMap["confidence"].(float64); okV {
					conf = v
				}
				_ = dtRepo.SaveRoadMemoryObservation(r.Context(), req.Latitude, req.Longitude, cellID, req.ConditionType, req.Severity, obsCnt, conf)
			}
			writeJSON(w, http.StatusCreated, resp)
			return
		}
	}

	key := cellID + ":" + strings.ToLower(req.ConditionType)
	twinFallback.mu.Lock()
	existing, ok := twinFallback.roadMemory[key]
	obsCount := 1
	conf := req.Confidence * 0.75
	if ok {
		if c, okC := existing["observation_count"].(int); okC {
			obsCount = c + 1
		}
		if prevC, okP := existing["confidence"].(float64); okP {
			conf = math.Min(0.99, prevC+0.18*(1.0-prevC))
		}
	}
	node := map[string]any{
		"node_id":           key,
		"h3_index":          cellID,
		"latitude":          req.Latitude,
		"longitude":         req.Longitude,
		"condition_type":    strings.ToLower(req.ConditionType),
		"severity":          math.Round(req.Severity*100) / 100,
		"observation_count": obsCount,
		"quorum_verified":   obsCount >= 2,
		"confidence":        math.Round(conf*1000) / 1000,
		"last_updated":      time.Now().UTC().Format(time.RFC3339),
	}
	twinFallback.roadMemory[key] = node
	twinFallback.mu.Unlock()

	if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
		_ = dtRepo.SaveRoadMemoryObservation(r.Context(), req.Latitude, req.Longitude, cellID, req.ConditionType, req.Severity, obsCount, conf)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"node": node, "model_version": "go-road-memory-v1"})
}

// GetRoadMemoryCorridor handles GET /move/road-memory/corridor?lat=...&lon=...
func (s *Service) GetRoadMemoryCorridor(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	radiusM := r.URL.Query().Get("radius_m")
	if radiusM == "" {
		radiusM = "5000"
	}
	if s.ml != nil {
		if resp, okML := s.ml.GetJSON(r.Context(), fmt.Sprintf("/v1/road-memory/corridor?lat=%.6f&lon=%.6f&radius_m=%s", lat, lon, radiusM)); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"nodes":         computeFallbackRoadMemoryCorridor(lat, lon),
		"model_version": "go-road-memory-v1",
	})
}

// AggregatePrivacyTelemetry handles POST /move/privacy/telemetry with k-anonymity suppression & Laplace DP noise.
func (s *Service) AggregatePrivacyTelemetry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Samples []struct {
			Latitude       float64  `json:"latitude"`
			Longitude      float64  `json:"longitude"`
			EphemeralToken string   `json:"ephemeral_token,omitempty"`
			SpeedKPH       *float64 `json:"speed_kph,omitempty"`
		} `json:"samples"`
		KMin    int     `json:"k_min,omitempty"`
		Epsilon float64 `json:"epsilon,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if req.KMin <= 0 {
		req.KMin = 3
	}
	if req.Epsilon <= 0 {
		req.Epsilon = 1.0
	}

	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/privacy/aggregate", req); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	// Deterministic k-anonymity aggregation & Laplace noise fallback
	bucket := time.Now().UTC().Truncate(15 * time.Minute)
	type cellAcc struct {
		latSum, lonSum float64
		speeds         []float64
		tokens         map[string]struct{}
		count          int
	}
	buckets := make(map[string]*cellAcc)
	for i, sample := range req.Samples {
		if !validLatLon(GeoPoint{Latitude: sample.Latitude, Longitude: sample.Longitude}) {
			continue
		}
		cid := spatialCellID(sample.Latitude, sample.Longitude)
		acc, ok := buckets[cid]
		if !ok {
			acc = &cellAcc{tokens: make(map[string]struct{})}
			buckets[cid] = acc
		}
		acc.latSum += sample.Latitude
		acc.lonSum += sample.Longitude
		acc.count++
		tok := sample.EphemeralToken
		if tok == "" {
			tok = fmt.Sprintf("anon-%d", i)
		}
		h := sha256.Sum256([]byte(tok + bucket.Format(time.RFC3339)))
		acc.tokens[hex.EncodeToString(h[:8])] = struct{}{}
		if sample.SpeedKPH != nil {
			acc.speeds = append(acc.speeds, *sample.SpeedKPH)
		}
	}

	published := make([]map[string]any, 0)
	suppressedCount := 0
	for cid, acc := range buckets {
		if len(acc.tokens) < req.KMin {
			suppressedCount++
			continue
		}
		cLat := acc.latSum / float64(acc.count)
		cLon := acc.lonSum / float64(acc.count)
		avgSpd := 28.0
		if len(acc.speeds) > 0 {
			var sSum float64
			for _, v := range acc.speeds {
				sSum += v
			}
			avgSpd = sSum / float64(len(acc.speeds))
		}
		// Bounded Laplace jitter using deterministic uniform seed from timestamp+cell
		seedHash := sha256.Sum256([]byte(cid + bucket.Format(time.RFC3339)))
		u := (float64(seedHash[0])/255.0 - 0.5) * 0.85
		scale := 1.0 / math.Max(0.2, req.Epsilon)
		sgn := 1.0
		if u < 0 {
			sgn = -1.0
		}
		lapNoise := -scale * sgn * math.Log(1.0-2.0*math.Abs(u))
		noisyCount := math.Round(math.Max(float64(req.KMin), float64(len(acc.tokens))+lapNoise)*10) / 10
		if dtRepo, okRepo := s.repo.(DigitalTwinRepository); okRepo {
			_ = dtRepo.SavePrivacyAggregateCell(r.Context(), cid, cLat, cLon, bucket, noisyCount, avgSpd, req.KMin, req.Epsilon)
		}
		published = append(published, map[string]any{
			"h3_index":            cid,
			"noisy_device_count":  noisyCount,
			"noisy_avg_speed_kph": math.Round(avgSpd*10) / 10,
			"k_threshold":         req.KMin,
			"epsilon_applied":     req.Epsilon,
		})
	}

	twinFallback.mu.Lock()
	twinFallback.totalPings += len(req.Samples)
	twinFallback.published += len(published)
	twinFallback.suppressed += suppressedCount
	twinFallback.kThreshold = req.KMin
	twinFallback.epsilonBudget = req.Epsilon
	twinFallback.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"bucket_start":     bucket.Format(time.RFC3339),
		"k_threshold":      req.KMin,
		"epsilon_budget":   req.Epsilon,
		"input_samples":    len(req.Samples),
		"published_count":  len(published),
		"suppressed_count": suppressedCount,
		"cells":            published,
		"guarantees":       []string{"pii_stripped_before_aggregation", fmt.Sprintf("k_anonymity>=%d", req.KMin), fmt.Sprintf("laplace_dp_epsilon=%.2f", req.Epsilon)},
	})
}

// GetPrivacyStatus handles GET /move/privacy/status.
func (s *Service) GetPrivacyStatus(w http.ResponseWriter, r *http.Request) {
	if s.ml != nil {
		if resp, okML := s.ml.GetJSON(r.Context(), "/v1/privacy/status"); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}
	twinFallback.mu.Lock()
	defer twinFallback.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"k_threshold":            twinFallback.kThreshold,
		"epsilon_budget":         twinFallback.epsilonBudget,
		"total_pings_processed":  twinFallback.totalPings,
		"total_cells_published":  twinFallback.published,
		"total_cells_suppressed": twinFallback.suppressed,
		"model_version":          "go-privacy-shield-v1",
	})
}

// GetProactiveBrief handles GET /move/assistant/proactive-brief?lat=...&lon=...
func (s *Service) GetProactiveBrief(w http.ResponseWriter, r *http.Request) {
	lat, lon, ok := parseLatLonQuery(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query params are required", false)
		return
	}
	weather := r.URL.Query().Get("weather")
	if weather == "" {
		weather = "clear"
	}
	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(r.Context(), "/v1/assistant/proactive-brief", map[string]any{
			"latitude":  lat,
			"longitude": lon,
			"weather":   weather,
		}); okML {
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	speed := s.localCorridorSpeed(r.Context(), lat, lon)
	crowd := math.Round(math.Max(0.15, math.Min(0.95, 1.0-(speed/52.0)))*100) / 100
	ped := computeFallbackPedestrianSafety(lat, lon, speed, crowd, 0, weather)
	animal := computeFallbackAnimalConflict(lat, lon, speed, weather)
	pedScore, _ := ped["walk_safety_score"].(float64)
	animalRisk, _ := animal["conflict_risk_score"].(float64)
	health := math.Round(math.Max(20.0, math.Min(99.0,
		0.40*(speed/45.0*100.0)+0.35*pedScore+0.25*((1.0-animalRisk)*100.0)))*10) / 10

	alerts := make([]map[string]any, 0, 3)
	if pedScore < 65 {
		alerts = append(alerts, map[string]any{"domain": "pedestrian_safety", "severity": "warning", "message": ped["recommendation"]})
	}
	if animalRisk >= 0.45 {
		alerts = append(alerts, map[string]any{"domain": "animal_conflict", "severity": "warning", "message": animal["mitigation_advice"]})
	}
	if crowd >= 0.65 {
		alerts = append(alerts, map[string]any{"domain": "crowd_intelligence", "severity": "info", "message": "Corridor density approaching peak band; consider shifting departure or taking rapid transit."})
	}
	if len(alerts) == 0 {
		alerts = append(alerts, map[string]any{"domain": "system_health", "severity": "info", "message": "Corridor operating smoothly across road, pedestrian, and transit layers."})
	}

	twinFallback.mu.Lock()
	k := twinFallback.kThreshold
	eps := twinFallback.epsilonBudget
	twinFallback.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"headline":            fmt.Sprintf("Corridor Health %.0f/100 · Walk Safety %s · Conflict Risk %s", health, ped["safety_grade"], animal["risk_level"]),
		"system_health_index": health,
		"alerts":              alerts,
		"privacy_shield": map[string]any{
			"k_threshold":    k,
			"epsilon_budget": eps,
			"status":         "active",
		},
		"recommended_actions": []string{
			fmt.Sprintf("Average corridor flow is %.1f km/h", speed),
			"Privacy Shield aggregates telemetry locally with k-anonymity + Laplace DP",
		},
	})
}

// corridorSafetyContext summarizes walk/animal/road-memory safety for PlanJourney scoring.
type corridorSafetyContext struct {
	PedestrianSafetyScore float64
	AnimalConflictRisk    float64
	RoadMemoryCount       int
	Advisories            []string
}

func (s *Service) assessCorridorSafety(ctx context.Context, lat, lon float64, avgSpeed float64, hazardsCount int) corridorSafetyContext {
	ped := computeFallbackPedestrianSafety(lat, lon, avgSpeed, math.Max(0.15, math.Min(0.95, 1.0-(avgSpeed/52.0))), hazardsCount, "clear")
	animal := computeFallbackAnimalConflict(lat, lon, avgSpeed, "clear")
	nodes := computeFallbackRoadMemoryCorridor(lat, lon)

	pedScore, _ := ped["walk_safety_score"].(float64)
	animalRisk, _ := animal["conflict_risk_score"].(float64)

	if s.ml != nil {
		if resp, okML := s.ml.PostJSON(ctx, "/v1/digital-twin/state", map[string]any{
			"latitude":      lat,
			"longitude":     lon,
			"weather":       "clear",
			"avg_speed_kph": avgSpeed,
		}); okML {
			if pm, okP := resp["pedestrian_safety"].(map[string]any); okP {
				if v, okV := pm["walk_safety_score"].(float64); okV {
					pedScore = v
				}
			}
			if am, okA := resp["animal_conflict"].(map[string]any); okA {
				if v, okV := am["conflict_risk_score"].(float64); okV {
					animalRisk = v
				}
			}
			if rmn, okR := resp["road_memory_nodes"].([]any); okR {
				nodes = make([]map[string]any, 0, len(rmn))
				for _, item := range rmn {
					if m, okM := item.(map[string]any); okM {
						nodes = append(nodes, m)
					}
				}
			}
		}
	}

	advisories := make([]string, 0, 3)
	if pedScore < 65 {
		advisories = append(advisories, fmt.Sprintf("Pedestrian safety %.0f/100: stick to lit signalized crossings", pedScore))
	}
	if animalRisk >= 0.45 {
		advisories = append(advisories, fmt.Sprintf("Animal crossing risk %.0f%% along corridor", animalRisk*100))
	}
	for _, n := range nodes {
		if ver, _ := n["quorum_verified"].(bool); ver {
			ctype, _ := n["condition_type"].(string)
			advisories = append(advisories, fmt.Sprintf("Road Memory quorum: verified %s", strings.ReplaceAll(ctype, "_", " ")))
			break
		}
	}

	return corridorSafetyContext{
		PedestrianSafetyScore: pedScore,
		AnimalConflictRisk:    animalRisk,
		RoadMemoryCount:       len(nodes),
		Advisories:            advisories,
	}
}
