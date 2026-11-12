// Package mobility exposes the NEXORA Move (MoveSmart) REST endpoints.
package mobility

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/nexora/platform/api/internal/platform/cache"
)

// Service orchestrates routing providers, ML inference, caching, and persistence.
type Service struct {
	repo    Repository
	routing RoutingProvider
	ml      *MLClient
	cache   *cache.Client
	logger  *slog.Logger
}

// NewService constructs a mobility service. repo may be nil when PostgreSQL is not configured.
func NewService(repo Repository, routing RoutingProvider, ml *MLClient, logger *slog.Logger) *Service {
	if routing == nil {
		routing = HeuristicRoutingProvider{}
	}
	return &Service{repo: repo, routing: routing, ml: ml, logger: logger}
}

// WithCache attaches a Redis + L1 read-through cache client to the mobility service.
func (s *Service) WithCache(c *cache.Client) *Service {
	s.cache = c
	return s
}

const (
	activeTripsGeoKey   = "move:geo:trips:active"
	activeHazardsGeoKey = "move:geo:hazards:active"
)

func hotTripKey(tripID string) string {
	return "move:trip:live:" + tripID
}

func hazardDetailKey(hazardID string) string {
	return "move:hazard:item:" + hazardID
}

func (s *Service) indexActiveTripSpatial(ctx context.Context, tripID string, p GeoPoint) {
	if s.cache == nil || tripID == "" || !validLatLon(p) {
		return
	}
	_ = s.cache.GeoAdd(ctx, activeTripsGeoKey, tripID, p.Latitude, p.Longitude, 2*time.Hour)
}

func (s *Service) indexHazardSpatial(ctx context.Context, hz RoadHazard) {
	if s.cache == nil || hz.ID == "" || !validLatLon(hz.Location) {
		return
	}
	_ = s.cache.GeoAdd(ctx, activeHazardsGeoKey, hz.ID, hz.Location.Latitude, hz.Location.Longitude, 6*time.Hour)
	if raw, err := json.Marshal(hz); err == nil {
		s.cache.Set(ctx, hazardDetailKey(hz.ID), string(raw), 6*time.Hour)
	}
}

// Mount registers all /move/* routes on the given router.
func Mount(r chi.Router, svc *Service) {
	if svc == nil {
		svc = NewService(nil, nil, nil, slog.Default())
	}
	r.Route("/move", func(m chi.Router) {
		m.Post("/journeys/plan", svc.PlanJourney)
		m.Post("/departures/recommend", svc.RecommendDeparture)
		m.Get("/profile", svc.GetProfile)
		m.Patch("/profile", svc.UpdateProfile)
		m.Get("/places/search", svc.Geocode)
		m.Get("/places", svc.ListPlaces)
		m.Post("/places", svc.CreatePlace)
		m.Post("/trips", svc.StartTrip)
		m.Get("/trips/{id}", svc.GetTrip)
		m.Post("/trips/{id}/locations:batch", svc.BatchLocations)
		m.Post("/trips/{id}/complete", svc.CompleteTrip)
		m.Get("/trips/{id}/updates", svc.GetTripUpdates)
		m.Get("/traffic/segments", svc.GetTrafficSegments)
		m.Get("/traffic/predictions", svc.GetTrafficPredictions)
		m.Get("/traffic/anomalies", svc.GetTrafficAnomalies)
		m.Get("/events/active", svc.GetActiveEvents)
		m.Get("/pois/nearby", svc.GetNearbyPOIs)
		m.Get("/transit/stops/nearby", svc.NearbyStops)
		m.Get("/transit/departures", svc.GetTransitDepartures)
		m.Get("/insights/commute", svc.GetCommuteInsights)
		m.Post("/feedback", svc.SubmitFeedback)
		// 5-Pillar Mobility Intelligence & Open-Source Stack Endpoints
		m.Post("/demand/predict", svc.PredictDemand)
		m.Post("/hotspots", svc.DiscoverHotspots)
		m.Post("/hazards/report", svc.ReportRoadHazard)
		m.Get("/hazards/nearby", svc.NearbyRoadHazards)
		m.Get("/spatial/nearby", svc.GetNearbySpatialRadar)
		m.Post("/assistant/query", svc.AssistantQuery)
		m.Get("/stack/libraries", svc.ListStackLibraries)
		m.Get("/intelligence/status", svc.GetIntelligenceStatus)
		// 12-Pillar City Digital Twin, Safety, Road Memory & Privacy Endpoints
		m.Get("/digital-twin/state", svc.GetDigitalTwinState)
		m.Post("/digital-twin/simulate", svc.SimulateUrbanIntervention)
		m.Get("/crowd/predict", svc.GetCrowdForecast)
		m.Get("/safety/animal-conflict", svc.GetAnimalConflict)
		m.Post("/safety/animal-sighting", svc.ReportAnimalSighting)
		m.Get("/safety/pedestrian", svc.GetPedestrianSafety)
		m.Post("/road-memory/observe", svc.ObserveRoadMemory)
		m.Get("/road-memory/corridor", svc.GetRoadMemoryCorridor)
		m.Post("/privacy/telemetry", svc.AggregatePrivacyTelemetry)
		m.Get("/privacy/status", svc.GetPrivacyStatus)
		m.Get("/assistant/proactive-brief", svc.GetProactiveBrief)
	})
}

type planJourneyRequest struct {
	UserID        string   `json:"user_id,omitempty"`
	Origin        GeoPoint `json:"origin"`
	Destination   GeoPoint `json:"destination"`
	DepartureTime *string  `json:"departure_time,omitempty"`
	Modes         []string `json:"modes,omitempty"`
	Preferences   *struct {
		OptimizeFor       string             `json:"optimize_for"`
		AvoidTolls        bool               `json:"avoid_tolls"`
		AvoidHazards      bool               `json:"avoid_hazards"`
		MaxWalkingMinutes int                `json:"max_walking_minutes"`
		Weights           map[string]float64 `json:"weights,omitempty"`
	} `json:"preferences,omitempty"`
}

// PlanJourney calculates, scores, and ranks multimodal route alternatives with shadow ML, hazard & event intelligence.
func (s *Service) PlanJourney(w http.ResponseWriter, r *http.Request) {
	var req planJourneyRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if !validLatLon(req.Origin) || !validLatLon(req.Destination) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid origin and destination coordinates are required", false)
		return
	}

	dep := time.Now().UTC()
	if req.DepartureTime != nil && *req.DepartureTime != "" {
		if parsed, err := time.Parse(time.RFC3339, *req.DepartureTime); err == nil {
			dep = parsed.UTC()
		}
	}

	prefs := RoutePreferencesInput{OptimizeFor: "RELIABILITY", MaxWalkingMinutes: 15, AvoidHazards: true}
	if s.repo != nil && req.UserID != "" {
		if _, err := uuid.Parse(req.UserID); err == nil {
			if prof, err := s.repo.GetProfile(r.Context(), req.UserID); err == nil && prof != nil {
				prefs.OptimizeFor = prof.OptimizeFor
				prefs.AvoidTolls = prof.AvoidTolls
				prefs.MaxWalkingMinutes = prof.MaxWalkingMinutes
				prefs.Weights = prof.Weights
				prefs.PreferredMode = prof.DefaultMode
			}
		}
	}
	if req.Preferences != nil {
		if req.Preferences.OptimizeFor != "" {
			prefs.OptimizeFor = req.Preferences.OptimizeFor
		}
		prefs.AvoidTolls = req.Preferences.AvoidTolls
		if req.Preferences.AvoidHazards {
			prefs.AvoidHazards = true
		}
		if req.Preferences.MaxWalkingMinutes > 0 {
			prefs.MaxWalkingMinutes = req.Preferences.MaxWalkingMinutes
		}
		if len(req.Preferences.Weights) > 0 {
			prefs.Weights = req.Preferences.Weights
		}
	}

	modes := req.Modes
	if len(modes) == 0 {
		modes = []string{"two_wheeler", "car", "metro", "multimodal", "bus"}
	}

	// Fetch nearby road hazards & active corridor events once per request
	var nearbyHazards []RoadHazard
	if s.repo != nil {
		if hz, err := s.repo.NearbyRoadHazards(r.Context(), (req.Origin.Latitude+req.Destination.Latitude)/2.0, (req.Origin.Longitude+req.Destination.Longitude)/2.0, 5000); err == nil {
			nearbyHazards = hz
		}
	}
	activeEvents := s.fetchActiveEvents(r.Context(), req.Origin.Latitude, req.Origin.Longitude, dep)
	midLat := (req.Origin.Latitude + req.Destination.Latitude) / 2.0
	midLon := (req.Origin.Longitude + req.Destination.Longitude) / 2.0
	corridorAvgSpeed := s.localCorridorSpeed(r.Context(), midLat, midLon)
	corridorSafety := s.assessCorridorSafety(r.Context(), midLat, midLon, corridorAvgSpeed, len(nearbyHazards))

	journeyID := uuid.NewString()
	slots := make([]*ScoredRoute, len(modes))
	var wg sync.WaitGroup

	for idx, rawMode := range modes {
		idx := idx
		mode := strings.ToLower(strings.TrimSpace(rawMode))
		wg.Add(1)
		go func() {
			defer wg.Done()
			routes, err := s.routing.GetRoutes(r.Context(), RouteRequest{
				Origin:        req.Origin,
				Destination:   req.Destination,
				Mode:          mode,
				DepartureTime: dep,
			})
			if err != nil || len(routes) == 0 {
				return
			}
			rt := routes[0]
			mult := congestionMultiplier(dep, mode)
			p50 := int(math.Round(float64(rt.DurationSeconds) * mult))
			p80 := int(math.Round(float64(p50) * 1.18))
			p90 := int(math.Round(float64(p50) * 1.30))

			legs, modeSeq, walkMin, transfers := buildMultimodalLegs(mode, rt.DistanceMeters, p50)
			if transfers > 0 {
				// Include transfer wait overhead in total journey ETA.
				sumLegs := 0
				for _, l := range legs {
					sumLegs += l.DurationSeconds
				}
				p50 = sumLegs
				p80 = int(math.Round(float64(p50) * 1.15))
				p90 = int(math.Round(float64(p50) * 1.25))
			}

			// Road hazard & event-aware adjustments for surface modes
			hazardsCount := len(nearbyHazards)
			hazardPenaltyS := 0
			if hazardsCount > 0 && mode != "metro" && mode != "walk" && mode != "bicycle" {
				perHazard := 45
				if mode == "two_wheeler" || mode == "multimodal" {
					perHazard = 20
				}
				hazardPenaltyS = int(math.Min(360, float64(hazardsCount*perHazard)))
				p50 += hazardPenaltyS
				p80 += int(math.Round(float64(hazardPenaltyS) * 1.3))
				p90 += int(math.Round(float64(hazardPenaltyS) * 1.6))
			}

			eventSummary := ""
			if len(activeEvents) > 0 {
				evTitle, _ := activeEvents[0]["title"].(string)
				if mode == "metro" {
					eventSummary = fmt.Sprintf("Metro bypasses %s", evTitle)
				} else if mode != "walk" && mode != "bicycle" {
					evMult := 1.12
					if mVal, ok := activeEvents[0]["road_delay_multiplier"].(float64); ok && mVal > 1.0 {
						evMult = mVal
					}
					if mode == "two_wheeler" || mode == "multimodal" {
						evMult = 1.0 + (evMult-1.0)*0.55
					}
					p50 = int(math.Round(float64(p50) * evMult))
					p80 = int(math.Round(float64(p80) * evMult))
					p90 = int(math.Round(float64(p90) * evMult))
					eventSummary = fmt.Sprintf("Event spillover factored: %s", evTitle)
				}
			}

			// Shadow-mode ML evaluation: never degrade provider baseline on ML failure or missing segments.
			mv := "baseline-provider-v0"
			shadowP50, shadowP90 := 0, 0
			shadowVer := ""
			if s.ml != nil {
				segs := rt.SegmentIDs
				if len(segs) == 0 {
					segs = []string{"baseline-seg-1"}
				}
				if pred, ok := s.ml.PredictJourney(r.Context(), segs, mode, dep, rt.DistanceMeters); ok {
					if len(rt.SegmentIDs) > 0 {
						mv = pred.ModelVersion
						p50 = pred.P50Seconds
						p90 = pred.P90Seconds
						if pred.P80Seconds > 0 {
							p80 = pred.P80Seconds
						} else {
							p80 = int(math.Round(float64(p50+p90) / 2.0))
						}
					} else {
						shadowP50 = pred.P50Seconds
						shadowP90 = pred.P90Seconds
						shadowVer = pred.ModelVersion
					}
				}
			}

			relScore, relBreakdown := buildReliabilityBreakdown(mode, dep, estimateReliability(mode), hazardsCount, eventSummary)
			ci := buildConfidenceInterval(p50, p80, p90, relScore)

			slots[idx] = &ScoredRoute{
				RouteID:               uuid.NewString(),
				Provider:              rt.Provider,
				Mode:                  mode,
				Modes:                 modeSeq,
				Legs:                  legs,
				DistanceMeters:        rt.DistanceMeters,
				P50Seconds:            p50,
				P80Seconds:            p80,
				P90Seconds:            p90,
				ShadowP50Seconds:      shadowP50,
				ShadowP90Seconds:      shadowP90,
				ShadowModelVer:        shadowVer,
				ModelVersion:          mv,
				ReliabilityScore:      relScore,
				ReliabilityBreakdown:  relBreakdown,
				ConfidenceInterval:    ci,
				EstimatedCostINR:      estimateCostINR(mode, rt.DistanceMeters),
				CO2Grams:              estimateCO2Grams(mode, rt.DistanceMeters),
				WalkMinutes:           walkMin,
				Transfers:             transfers,
				HazardsCount:          hazardsCount,
				HazardPenaltySeconds:  hazardPenaltyS,
				EventImpactSummary:    eventSummary,
				PedestrianSafetyScore: corridorSafety.PedestrianSafetyScore,
				AnimalConflictRisk:    corridorSafety.AnimalConflictRisk,
				SafetyAdvisories:      corridorSafety.Advisories,
				Geometry:              rt.Geometry,
				Steps:                 rt.Steps,
			}
		}()
	}
	wg.Wait()

	candidates := make([]ScoredRoute, 0, len(modes))
	for _, sl := range slots {
		if sl != nil {
			candidates = append(candidates, *sl)
		}
	}

	ranked := rankScoredRoutes(candidates, prefs)
	altsOut := make([]map[string]any, 0, len(ranked))
	persisted := make([]PlannedOption, 0, len(ranked))
	modelVersion := "baseline-provider-v0"

	for _, c := range ranked {
		if c.ModelVersion != "baseline-provider-v0" {
			modelVersion = c.ModelVersion
		}
		altsOut = append(altsOut, map[string]any{
			"route_id":         c.RouteID,
			"mode":             strings.ToUpper(c.Mode),
			"mode_sequence":    c.Modes,
			"legs":             c.Legs,
			"duration_seconds": c.P50Seconds,
			"distance_meters":  c.DistanceMeters,
			"eta_range_seconds": map[string]int{
				"p50": c.P50Seconds,
				"p80": c.P80Seconds,
				"p90": c.P90Seconds,
			},
			"confidence_interval":   c.ConfidenceInterval,
			"reliability_breakdown": c.ReliabilityBreakdown,
			"objective_scores":      c.ObjectiveScores,
			"hazard_impact": map[string]any{
				"active_hazards":  c.HazardsCount,
				"penalty_seconds": c.HazardPenaltySeconds,
			},
			"event_impact": c.EventImpactSummary,
			"co2_grams":    c.CO2Grams,
			"estimated_cost": map[string]any{
				"currency": "INR",
				"amount":   c.EstimatedCostINR,
			},
			"reliability_score":       c.ReliabilityScore,
			"ranking_score":           c.Score,
			"transfers":               c.Transfers,
			"walking_minutes":         c.WalkMinutes,
			"pedestrian_safety_score": c.PedestrianSafetyScore,
			"animal_conflict_risk":    c.AnimalConflictRisk,
			"safety_advisories":       c.SafetyAdvisories,
			"explanation":             c.Explanation,
			"geometry":                c.Geometry,
			"steps":                   c.Steps,
		})
		persisted = append(persisted, PlannedOption{
			RouteID:          c.RouteID,
			Provider:         c.Provider,
			Modes:            c.Modes,
			DistanceMeters:   c.DistanceMeters,
			P50Seconds:       c.P50Seconds,
			P80Seconds:       c.P80Seconds,
			P90Seconds:       c.P90Seconds,
			ShadowP50Seconds: c.ShadowP50Seconds,
			ShadowP90Seconds: c.ShadowP90Seconds,
			ShadowModelVer:   c.ShadowModelVer,
			ReliabilityScore: c.ReliabilityScore,
			EstimatedCostINR: c.EstimatedCostINR,
			Explanation:      c.Explanation,
			ModelVersion:     c.ModelVersion,
		})
	}

	if s.repo != nil && len(persisted) > 0 {
		if err := s.repo.SaveJourneyOptions(r.Context(), journeyID, persisted); err != nil {
			s.logger.Warn("failed to persist planned journey options", "err", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"journey_id":     journeyID,
		"generated_at":   time.Now().UTC().Format(time.RFC3339),
		"alternatives":   altsOut,
		"active_events":  activeEvents,
		"active_hazards": len(nearbyHazards),
		"model_version":  modelVersion,
	})
}

type recommendDepartureRequest struct {
	OriginPlaceID          string    `json:"origin_place_id,omitempty"`
	DestinationPlaceID     string    `json:"destination_place_id,omitempty"`
	Origin                 *GeoPoint `json:"origin,omitempty"`
	Destination            *GeoPoint `json:"destination,omitempty"`
	ArrivalBy              *string   `json:"arrival_by,omitempty"`
	AllowedDepartureWindow struct {
		From string `json:"from"`
		To   string `json:"to"`
	} `json:"allowed_departure_window"`
	Mode      string `json:"mode"`
	Objective string `json:"objective"`
}

// RecommendDeparture evaluates slots across the departure window using congestion curves + arrival_by deadline.
func (s *Service) RecommendDeparture(w http.ResponseWriter, r *http.Request) {
	var req recommendDepartureRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	fromT, err1 := time.Parse(time.RFC3339, req.AllowedDepartureWindow.From)
	toT, err2 := time.Parse(time.RFC3339, req.AllowedDepartureWindow.To)
	if err1 != nil || err2 != nil || !toT.After(fromT) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid allowed_departure_window (from < to in RFC3339) is required", false)
		return
	}

	var arrivalBy *time.Time
	if req.ArrivalBy != nil && *req.ArrivalBy != "" {
		if parsed, err := time.Parse(time.RFC3339, *req.ArrivalBy); err == nil {
			arrivalBy = &parsed
		}
	}

	var orig, dest GeoPoint
	if s.repo != nil && req.OriginPlaceID != "" {
		if sp, err := s.repo.GetSavedPlace(r.Context(), req.OriginPlaceID); err == nil {
			orig = sp.Location
		}
	}
	if s.repo != nil && req.DestinationPlaceID != "" {
		if sp, err := s.repo.GetSavedPlace(r.Context(), req.DestinationPlaceID); err == nil {
			dest = sp.Location
		}
	}
	if req.Origin != nil && validLatLon(*req.Origin) {
		orig = *req.Origin
	}
	if req.Destination != nil && validLatLon(*req.Destination) {
		dest = *req.Destination
	}

	mode := strings.ToLower(req.Mode)
	if mode == "" {
		mode = "car"
	}
	baseDur := 1800
	if validLatLon(orig) && validLatLon(dest) {
		routes, _ := s.routing.GetRoutes(r.Context(), RouteRequest{Origin: orig, Destination: dest, Mode: mode, DepartureTime: fromT})
		if len(routes) > 0 {
			baseDur = routes[0].DurationSeconds
		}
	}

	best, altSlots, series, timeSavedMin, reason := evaluateDepartureWindow(fromT, toT, arrivalBy, baseDur, mode, req.Objective)
	altsOut := make([]map[string]any, 0, len(altSlots))
	for _, a := range altSlots {
		altsOut = append(altsOut, map[string]any{
			"departure":                  a.Departure.Format(time.RFC3339),
			"arrival":                    a.Arrival.Format(time.RFC3339),
			"predicted_duration_minutes": int(math.Ceil(float64(a.DurationSeconds) / 60.0)),
			"arrival_confidence":         a.ArrivalConfidence,
		})
	}
	seriesOut := make([]map[string]any, 0, len(series))
	for _, sl := range series {
		seriesOut = append(seriesOut, map[string]any{
			"departure":          sl.Departure.Format(time.RFC3339),
			"arrival":            sl.Arrival.Format(time.RFC3339),
			"duration_minutes":   int(math.Ceil(float64(sl.DurationSeconds) / 60.0)),
			"p90_minutes":        int(math.Ceil(float64(sl.P90Seconds) / 60.0)),
			"arrival_confidence": sl.ArrivalConfidence,
			"congestion_level":   sl.CongestionLevel,
			"is_now":             sl.IsNow,
			"is_optimal":         sl.IsOptimal,
		})
	}
	var activeEvents []map[string]any
	if validLatLon(orig) {
		activeEvents = s.fetchActiveEvents(r.Context(), orig.Latitude, orig.Longitude, best.Departure)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"recommended_departure":      best.Departure.Format(time.RFC3339),
		"predicted_arrival":          best.Arrival.Format(time.RFC3339),
		"predicted_duration_minutes": int(math.Ceil(float64(best.DurationSeconds) / 60.0)),
		"arrival_confidence":         best.ArrivalConfidence,
		"time_saved_vs_now_minutes":  timeSavedMin,
		"slot_series":                seriesOut,
		"active_events":              activeEvents,
		"alternatives":               altsOut,
		"reason":                     reason,
	})
}

func (s *Service) GetProfile(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	userID := r.URL.Query().Get("user_id")
	if _, err := uuid.Parse(userID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id query parameter is required", false)
		return
	}
	prof, err := s.repo.GetProfile(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to load mobility profile", true)
		return
	}
	writeJSON(w, http.StatusOK, prof)
}

func (s *Service) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	var body MobilityProfile
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id is required", false)
		return
	}
	if body.DefaultMode == "" {
		body.DefaultMode = "two_wheeler"
	}
	if body.OptimizeFor == "" {
		body.OptimizeFor = "RELIABILITY"
	}
	if body.Weights == nil {
		body.Weights = map[string]float64{"time": 0.4, "reliability": 0.3, "cost": 0.2, "walk": 0.1}
	}
	if body.Preferences == nil {
		body.Preferences = map[string]any{}
	}
	prof, err := s.repo.UpsertProfile(r.Context(), body)
	if err != nil {
		s.logger.Error("update mobility profile failed", "err", err)
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to update mobility profile", true)
		return
	}
	writeJSON(w, http.StatusOK, prof)
}

func (s *Service) ListPlaces(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"places": []any{}})
		return
	}
	userID := r.URL.Query().Get("user_id")
	if _, err := uuid.Parse(userID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id query parameter is required", false)
		return
	}
	places, err := s.repo.ListSavedPlaces(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to list saved places", true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": places})
}

func (s *Service) CreatePlace(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	var body SavedPlace
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil || body.Name == "" || !validLatLon(body.Location) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id, name, and location are required", false)
		return
	}
	if body.PlaceType == "" {
		body.PlaceType = "custom"
	}
	created, err := s.repo.CreateSavedPlace(r.Context(), body)
	if err != nil {
		s.logger.Error("create saved place failed", "err", err)
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to save place", true)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Service) StartTrip(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID      string    `json:"user_id"`
		PrimaryMode string    `json:"primary_mode"`
		Origin      GeoPoint  `json:"origin"`
		Destination *GeoPoint `json:"destination,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil || !validLatLon(body.Origin) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id and origin are required", false)
		return
	}
	if body.PrimaryMode == "" {
		body.PrimaryMode = "two_wheeler"
	}
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	trip, err := s.repo.StartTrip(r.Context(), body.UserID, strings.ToLower(body.PrimaryMode), body.Origin, body.Destination)
	if err != nil {
		s.logger.Error("start trip failed", "err", err)
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to start trip", true)
		return
	}
	s.indexActiveTripSpatial(r.Context(), trip.ID, body.Origin)
	writeJSON(w, http.StatusCreated, trip)
}

func (s *Service) GetTrip(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	tripID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(tripID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid trip id is required", false)
		return
	}
	trip, err := s.repo.GetTrip(r.Context(), tripID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "NOT_FOUND", "trip not found", false)
		return
	}
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to load trip", true)
		return
	}
	writeJSON(w, http.StatusOK, trip)
}

func (s *Service) BatchLocations(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	tripID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(tripID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid trip id is required", false)
		return
	}
	var body struct {
		Samples []LocationSample `json:"samples"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if len(body.Samples) == 0 || len(body.Samples) > 500 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "samples must contain between 1 and 500 points", false)
		return
	}
	for _, sample := range body.Samples {
		if !validLatLon(GeoPoint{Latitude: sample.Latitude, Longitude: sample.Longitude}) {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid coordinate in samples batch", false)
			return
		}
	}
	n, err := s.repo.AddLocationSamples(r.Context(), tripID, body.Samples)
	if err != nil {
		s.logger.Error("batch location upload failed", "trip_id", tripID, "err", err)
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to store location samples", true)
		return
	}
	last := body.Samples[len(body.Samples)-1]
	s.indexActiveTripSpatial(r.Context(), tripID, GeoPoint{Latitude: last.Latitude, Longitude: last.Longitude})
	if s.cache != nil {
		s.cache.Del(r.Context(), hotTripKey(tripID))
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"trip_id": tripID, "accepted": n, "spatial_indexed": s.cache != nil})
}

func (s *Service) CompleteTrip(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	tripID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(tripID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid trip id is required", false)
		return
	}
	trip, err := s.repo.CompleteTrip(r.Context(), tripID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "NOT_FOUND", "trip not found", false)
		return
	}
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to complete trip", true)
		return
	}
	if s.cache != nil {
		s.cache.Del(r.Context(), hotTripKey(tripID))
		_ = s.cache.GeoRem(r.Context(), activeTripsGeoKey, tripID)
	}
	writeJSON(w, http.StatusOK, trip)
}

func (s *Service) GetTripUpdates(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	tripID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(tripID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid trip id is required", false)
		return
	}
	if s.cache != nil {
		if cached, ok := s.cache.Get(r.Context(), hotTripKey(tripID)); ok {
			var upd LiveTripUpdate
			if json.Unmarshal([]byte(cached), &upd) == nil {
				writeJSON(w, http.StatusOK, upd)
				return
			}
		}
	}
	upd, err := s.repo.GetLiveTripUpdate(r.Context(), tripID)
	if errors.Is(err, ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "NOT_FOUND", "trip not found", false)
		return
	}
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to compute live trip updates", true)
		return
	}
	if s.cache != nil && upd != nil {
		if raw, err := json.Marshal(upd); err == nil {
			s.cache.Set(r.Context(), hotTripKey(tripID), string(raw), 8*time.Second)
		}
	}
	writeJSON(w, http.StatusOK, upd)
}

func (s *Service) GetTrafficSegments(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"segments": []any{}})
		return
	}
	var segIDs []string
	if raw := strings.TrimSpace(r.URL.Query().Get("segment_ids")); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			if p := strings.TrimSpace(part); p != "" {
				segIDs = append(segIDs, p)
			}
		}
	}
	var latP, lonP *float64
	if latStr, lonStr := r.URL.Query().Get("lat"), r.URL.Query().Get("lon"); latStr != "" && lonStr != "" {
		lat, err1 := strconv.ParseFloat(latStr, 64)
		lon, err2 := strconv.ParseFloat(lonStr, 64)
		if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
			writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid lat/lon parameters", false)
			return
		}
		latP, lonP = &lat, &lon
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius_m"))
	segs, err := s.repo.GetTrafficSegments(r.Context(), segIDs, latP, lonP, radius)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to query traffic segments", true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"segments": segs})
}

func (s *Service) GetTrafficPredictions(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("segment_ids"))
	if raw == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "segment_ids query parameter is required", false)
		return
	}
	var segIDs []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			segIDs = append(segIDs, p)
		}
	}
	horizon, _ := strconv.Atoi(r.URL.Query().Get("horizon_minutes"))
	cacheKey := "nexora:traffic:pred:" + strings.Join(segIDs, ",") + ":" + strconv.Itoa(horizon)

	if s.cache != nil {
		if rawJSON, ok := s.cache.Get(r.Context(), cacheKey); ok {
			var cached map[string]any
			if json.Unmarshal([]byte(rawJSON), &cached) == nil {
				cached["cache"] = "hit"
				writeJSON(w, http.StatusOK, cached)
				return
			}
		}
	}

	if s.repo != nil {
		if preds, err := s.repo.GetTrafficPredictions(r.Context(), segIDs, horizon); err == nil && len(preds) > 0 {
			resp := map[string]any{"predictions": preds, "source": "postgres"}
			if s.cache != nil {
				if b, err := json.Marshal(resp); err == nil {
					s.cache.Set(r.Context(), cacheKey, string(b), 30*time.Second)
				}
			}
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	// Fallback to live ML inference service (or deterministic baseline if ML is unreachable).
	if s.ml != nil {
		if mlPreds, ok := s.ml.PredictTraffic(r.Context(), segIDs); ok {
			resp := map[string]any{"predictions": mlPreds, "source": "ml_inference"}
			if s.cache != nil {
				if b, err := json.Marshal(resp); err == nil {
					s.cache.Set(r.Context(), cacheKey, string(b), 30*time.Second)
				}
			}
			writeJSON(w, http.StatusOK, resp)
			return
		}
	}

	fallback := make([]SegmentTrafficPrediction, 0, len(segIDs))
	for _, id := range segIDs {
		fallback = append(fallback, SegmentTrafficPrediction{
			SegmentID:       id,
			SpeedKph:        28.0,
			HorizonsMinutes: []int{15, 30, 60, 120},
			ModelVersion:    "baseline-fallback-v0",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"predictions": fallback, "source": "fallback"})
}

// GetTrafficAnomalies exposes EWMA z-score traffic anomaly detection across road segments.
func (s *Service) GetTrafficAnomalies(w http.ResponseWriter, r *http.Request) {
	segIDs := []string{"corridor-primary"}
	if raw := strings.TrimSpace(r.URL.Query().Get("segment_ids")); raw != "" {
		parsed := make([]string, 0)
		for _, part := range strings.Split(raw, ",") {
			if p := strings.TrimSpace(part); p != "" {
				parsed = append(parsed, p)
			}
		}
		if len(parsed) > 0 {
			segIDs = parsed
		}
	}
	weather := strings.TrimSpace(r.URL.Query().Get("weather"))
	if weather == "" {
		weather = "clear"
	}

	if s.ml != nil {
		if out, ok := s.ml.PostJSON(r.Context(), "/v1/traffic/anomalies", map[string]any{
			"segment_ids": segIDs,
			"weather":     weather,
		}); ok {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}

	// Deterministic fallback anomaly assessment from live repo segments or time-of-day baseline
	anomalies := make([]map[string]any, 0, len(segIDs))
	activeCount := 0
	if s.repo != nil {
		if segs, err := s.repo.GetTrafficSegments(r.Context(), segIDs, nil, nil, 3000); err == nil && len(segs) > 0 {
			for _, seg := range segs {
				expected := math.Max(22.0, float64(seg.SpeedLimitKmph)*0.72)
				dropPct := math.Max(0, math.Round(((expected-seg.CurrentSpeedKph)/expected)*1000)/10)
				isAnom := dropPct >= 28.0
				sev := "none"
				hint := "normal_flow"
				if isAnom {
					activeCount++
					sev = "moderate"
					hint = "unusual_slowdown"
					if dropPct >= 45.0 {
						sev = "high"
						hint = "bottleneck_spillback"
					}
				}
				anomalies = append(anomalies, map[string]any{
					"segment_id":         seg.SegmentID,
					"expected_speed_kph": expected,
					"observed_speed_kph": seg.CurrentSpeedKph,
					"speed_drop_pct":     dropPct,
					"z_score":            -dropPct / 14.0,
					"is_anomaly":         isAnom,
					"severity":           sev,
					"cause_hint":         hint,
				})
			}
		}
	}
	if len(anomalies) == 0 {
		mult := congestionMultiplier(time.Now().UTC(), "car")
		for idx, sid := range segIDs {
			expected := 36.0
			observed := math.Round((expected/mult)*10) / 10
			dropPct := math.Round(((expected-observed)/expected)*1000) / 10
			isAnom := idx == 0 && mult >= 1.25
			sev := "none"
			hint := "normal_flow"
			if isAnom {
				activeCount++
				sev = "moderate"
				hint = "peak_spillback"
			}
			anomalies = append(anomalies, map[string]any{
				"segment_id":         sid,
				"expected_speed_kph": expected,
				"observed_speed_kph": observed,
				"speed_drop_pct":     dropPct,
				"z_score":            -1.4,
				"is_anomaly":         isAnom,
				"severity":           sev,
				"cause_hint":         hint,
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"anomalies":            anomalies,
		"active_anomaly_count": activeCount,
		"model_version":        "ewma-zscore-fallback-v0",
	})
}

// GetActiveEvents returns nearby urban events (synthesized from live telemetry, Overpass venues, or registrations).
func (s *Service) GetActiveEvents(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		writeJSON(w, http.StatusOK, map[string]any{
			"events":        []any{},
			"model_version": "event-aware-dynamic-v2",
		})
		return
	}
	events := s.fetchActiveEvents(r.Context(), lat, lon, time.Now().UTC())
	writeJSON(w, http.StatusOK, map[string]any{
		"events":        events,
		"model_version": "event-aware-dynamic-v2",
	})
}

func (s *Service) fetchActiveEvents(ctx context.Context, lat, lon float64, _ time.Time) []map[string]any {
	if s.ml != nil {
		path := fmt.Sprintf("/v1/events/city?lat=%.5f&lon=%.5f", lat, lon)
		if out, ok := s.ml.GetJSON(ctx, path); ok {
			if rawList, ok := out["events"].([]any); ok {
				res := make([]map[string]any, 0, len(rawList))
				for _, item := range rawList {
					if m, ok := item.(map[string]any); ok {
						if act, ok := m["active_at_time"].(bool); !ok || act {
							res = append(res, m)
						}
					}
				}
				return res
			}
		}
	}
	return []map[string]any{}
}

func (s *Service) NearbyStops(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"stops": []any{}})
		return
	}
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query parameters are required", false)
		return
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius_m"))
	stops, err := s.repo.NearbyTransitStops(r.Context(), lat, lon, radius)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to query nearby transit stops", true)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stops": stops})
}

func (s *Service) GetTransitDepartures(w http.ResponseWriter, r *http.Request) {
	stopID := strings.TrimSpace(r.URL.Query().Get("stop_id"))
	if stopID == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "stop_id query parameter is required", false)
		return
	}
	if s.repo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"stop_id": stopID, "departures": []any{}, "freshness": "static"})
		return
	}
	deps, err := s.repo.GetTransitDepartures(r.Context(), stopID)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to query transit departures", true)
		return
	}
	freshness := "static_schedule"
	for _, d := range deps {
		if d.IsRealtime {
			freshness = "gtfs_rt_live"
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"stop_id":    stopID,
		"departures": deps,
		"freshness":  freshness,
	})
}

func (s *Service) GetCommuteInsights(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	userID := r.URL.Query().Get("user_id")
	if _, err := uuid.Parse(userID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id query parameter is required", false)
		return
	}
	insights, err := s.repo.GetCommuteInsights(r.Context(), userID)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to compute commute insights", true)
		return
	}
	writeJSON(w, http.StatusOK, insights)
}

func (s *Service) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	if s.repo == nil {
		writeError(w, r, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database not configured", true)
		return
	}
	var body struct {
		TripID           string         `json:"trip_id"`
		UserID           string         `json:"user_id"`
		Rating           int            `json:"rating"`
		Comment          string         `json:"comment"`
		OutcomeDurationS *int           `json:"outcome_duration_s,omitempty"`
		Feedback         map[string]any `json:"feedback,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if _, err := uuid.Parse(body.TripID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid trip_id is required", false)
		return
	}
	if _, err := uuid.Parse(body.UserID); err != nil {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid user_id is required", false)
		return
	}
	if body.Rating < 1 || body.Rating > 5 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "rating must be between 1 and 5", false)
		return
	}
	if body.Feedback == nil {
		body.Feedback = map[string]any{}
	}
	id, err := s.repo.SaveTripFeedback(r.Context(), body.TripID, body.UserID, body.Rating, body.Comment, body.OutcomeDurationS, body.Feedback)
	if err != nil {
		s.logger.Error("save trip feedback failed", "err", err)
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to save feedback", true)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"feedback_id": id})
}

// PredictDemand (Pillar 3: TFT / Prophet / XGBoost zone mobility demand & surge pressure).
func (s *Service) PredictDemand(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if s.ml != nil {
		if out, ok := s.ml.PostJSON(r.Context(), "/v1/predict/demand", body); ok {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	cell := "cell_global"
	if h3s, ok := body["h3_index"].(string); ok && h3s != "" {
		cell = h3s
	} else if lat, ok1 := body["latitude"].(float64); ok1 {
		if lon, ok2 := body["longitude"].(float64); ok2 && validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
			cell = spatialCellID(lat, lon)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"forecasts": []map[string]any{
			{
				"h3_index":              cell,
				"horizon_minutes":       30,
				"predicted_demand_idx":  0.65,
				"surge_pressure":        1.15,
				"peak_hour_prob":        0.55,
				"transport_avail_score": 0.80,
				"model_version":         "tft-prophet-xgb-fallback-v0",
			},
		},
	})
}

// DiscoverHotspots (Pillar 2: H3 hexagonal indexing + HDBSCAN traffic hotspot clustering).
func (s *Service) DiscoverHotspots(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if s.ml != nil {
		if out, ok := s.ml.PostJSON(r.Context(), "/v1/hotspots/discover", body); ok {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hotspots":      []any{},
		"model_version": "hdbscan-h3-fallback-v0",
	})
}

// ReportRoadHazard (Pillar 4: YOLO / RT-DETR / MobileNet road intelligence + PostgreSQL + SNS/SQS event outbox).
func (s *Service) ReportRoadHazard(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID       string  `json:"user_id,omitempty"`
		TripID       string  `json:"trip_id,omitempty"`
		SegmentID    string  `json:"segment_id,omitempty"`
		Latitude     float64 `json:"latitude"`
		Longitude    float64 `json:"longitude"`
		ImageURL     string  `json:"image_url,omitempty"`
		ImageBase64  string  `json:"image_base64,omitempty"`
		HintCategory string  `json:"hint_category,omitempty"`
		RainfallMmHr float64 `json:"rainfall_mm_hr,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	if !validLatLon(GeoPoint{Latitude: body.Latitude, Longitude: body.Longitude}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid latitude and longitude are required", false)
		return
	}

	hazardType := "pothole"
	if body.HintCategory != "" {
		hazardType = strings.ToLower(body.HintCategory)
	}
	severity := "medium"
	confidence := 0.85
	laneImpactFactor := 0.80
	modelVer := "rtdetr-yolo-mobilenet-v1"
	h3Idx := spatialCellID(body.Latitude, body.Longitude)
	var bboxes any

	if s.ml != nil {
		if mlOut, ok := s.ml.PostJSON(r.Context(), "/v1/vision/road-hazards", map[string]any{
			"latitude":       body.Latitude,
			"longitude":      body.Longitude,
			"image_ref":      body.ImageURL,
			"image_url":      body.ImageURL,
			"image_base64":   body.ImageBase64,
			"hint_type":      body.HintCategory,
			"hint_category":  body.HintCategory,
			"rainfall_mm_hr": body.RainfallMmHr,
		}); ok {
			if ht, ok := mlOut["hazard_type"].(string); ok && ht != "" && ht != "clear" {
				hazardType = ht
			} else if ht, ok := mlOut["primary_hazard_type"].(string); ok && ht != "" && ht != "clear" {
				hazardType = ht
			}
			if sev, ok := mlOut["severity"].(string); ok && sev != "" {
				severity = sev
			}
			if conf, ok := mlOut["confidence"].(float64); ok && conf > 0 {
				confidence = conf
			}
			if lif, ok := mlOut["lane_impact_factor"].(float64); ok && lif > 0 {
				laneImpactFactor = lif
			}
			if h3s, ok := mlOut["h3_index"].(string); ok && h3s != "" {
				h3Idx = h3s
			}
			if mv, ok := mlOut["model_version"].(string); ok && mv != "" {
				modelVer = mv
			}
			if bb, ok := mlOut["bounding_boxes"]; ok && bb != nil {
				bboxes = bb
			} else if dets, ok := mlOut["detections"].([]any); ok && len(dets) > 0 {
				bboxes = dets
				if first, ok := dets[0].(map[string]any); ok {
					if h3s, ok := first["h3_index"].(string); ok && h3s != "" {
						h3Idx = h3s
					}
				}
			}
		}
	}

	hz := RoadHazard{
		UserID:           body.UserID,
		TripID:           body.TripID,
		SegmentID:        body.SegmentID,
		H3Index:          h3Idx,
		Location:         GeoPoint{Latitude: body.Latitude, Longitude: body.Longitude},
		HazardType:       hazardType,
		Severity:         severity,
		Confidence:       confidence,
		LaneImpactFactor: laneImpactFactor,
		BoundingBoxes:    bboxes,
		ImageRef:         body.ImageURL,
		ModelVersion:     modelVer,
	}

	if s.repo != nil {
		created, err := s.repo.CreateRoadHazard(r.Context(), hz)
		if err != nil {
			s.logger.Error("create road hazard failed", "err", err)
			writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to persist road hazard", true)
			return
		}
		if created != nil {
			s.indexHazardSpatial(r.Context(), *created)
		}
		writeJSON(w, http.StatusCreated, created)
		return
	}

	hz.ID = uuid.NewString()
	hz.Status = "active"
	hz.ReportedAt = time.Now().UTC()
	s.indexHazardSpatial(r.Context(), hz)
	writeJSON(w, http.StatusCreated, hz)
}

// NearbyRoadHazards returns active road hazards around a coordinate, merging hot Redis Spatial entries with PostGIS.
func (s *Service) NearbyRoadHazards(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query parameters are required", false)
		return
	}
	radius, _ := strconv.Atoi(r.URL.Query().Get("radius_m"))
	if radius <= 0 {
		radius = 3000
	}
	hotHazards := make([]RoadHazard, 0)
	hotSet := make(map[string]bool)
	if s.cache != nil {
		if members, err := s.cache.GeoSearchRadius(r.Context(), activeHazardsGeoKey, lat, lon, float64(radius), 25); err == nil {
			for _, m := range members {
				if raw, ok := s.cache.Get(r.Context(), hazardDetailKey(m.Member)); ok {
					var hz RoadHazard
					if json.Unmarshal([]byte(raw), &hz) == nil {
						hotHazards = append(hotHazards, hz)
						hotSet[hz.ID] = true
					}
				}
			}
		}
	}
	if s.repo == nil {
		writeJSON(w, http.StatusOK, map[string]any{"hazards": hotHazards, "spatial_source": "redis-geo"})
		return
	}
	hazards, err := s.repo.NearbyRoadHazards(r.Context(), lat, lon, radius)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "DB_ERROR", "failed to query nearby road hazards", true)
		return
	}
	seen := make(map[string]bool, len(hazards))
	warmed := 0
	for _, h := range hazards {
		seen[h.ID] = true
		if !hotSet[h.ID] && warmed < 10 {
			s.indexHazardSpatial(r.Context(), h)
			warmed++
		}
	}
	for _, h := range hotHazards {
		if !seen[h.ID] {
			hazards = append([]RoadHazard{h}, hazards...)
			seen[h.ID] = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"hazards": hazards})
}

// GetNearbySpatialRadar returns sub-millisecond Redis Spatial (GEOADD/GEOSEARCH) nearby active trips and hot hazards.
func (s *Service) GetNearbySpatialRadar(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query parameters are required", false)
		return
	}
	radiusM, _ := strconv.ParseFloat(r.URL.Query().Get("radius_m"), 64)
	if radiusM <= 0 || radiusM > 25000 {
		radiusM = 2500
	}
	var nearbyTrips, nearbyHazards []cache.GeoMember
	if s.cache != nil {
		nearbyTrips, _ = s.cache.GeoSearchRadius(r.Context(), activeTripsGeoKey, lat, lon, radiusM, 40)
		nearbyHazards, _ = s.cache.GeoSearchRadius(r.Context(), activeHazardsGeoKey, lat, lon, radiusM, 40)
	}
	if nearbyTrips == nil {
		nearbyTrips = []cache.GeoMember{}
	}
	if nearbyHazards == nil {
		nearbyHazards = []cache.GeoMember{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"spatial_source":       "redis-geo",
		"radius_meters":        radiusM,
		"active_nearby_trips":  len(nearbyTrips),
		"nearby_trip_probes":   nearbyTrips,
		"nearby_hazard_coords": nearbyHazards,
	})
}

// AssistantQuery (Pillar 5: Qwen3 + Whisper + BGE-M3 + Multilingual MiniLM reranker in EN/TE/HI).
func (s *Service) AssistantQuery(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, r, http.StatusBadRequest, "INVALID_JSON", "invalid JSON request body", false)
		return
	}
	q, _ := body["query"].(string)
	if strings.TrimSpace(q) == "" {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "query is required", false)
		return
	}
	if s.ml != nil {
		if out, ok := s.ml.PostJSON(r.Context(), "/v1/assistant/query", body); ok {
			// Ensure both "answer" (mobile client contract) and "reply" are populated.
			if _, hasAnswer := out["answer"]; !hasAnswer {
				if rep, ok := out["reply"].(string); ok {
					out["answer"] = rep
				}
			}
			writeJSON(w, http.StatusOK, out)
			return
		}
	}

	// Deterministic explainable fallback when ML service is unreachable
	answer := "MoveSmart recommends checking multimodal Metro + two-wheeler options for the highest reliability."
	intent := "route_recommendation"
	var explainability map[string]any
	if rc, ok := body["route_context"].(map[string]any); ok && len(rc) > 0 {
		intent = "explain_route"
		mode, _ := rc["mode"].(string)
		goal, _ := rc["optimize_for"].(string)
		if goal == "" {
			goal = "RELIABILITY"
		}
		durS, _ := rc["duration_seconds"].(float64)
		rel, _ := rc["reliability_score"].(float64)
		cost, _ := rc["cost_inr"].(float64)
		factors := []map[string]string{
			{
				"label":  fmt.Sprintf("%s Objective Alignment", strings.ToUpper(goal)),
				"impact": "positive",
				"detail": fmt.Sprintf("%s ranked #1 for your %s priority (ETA ~%.0f min).", strings.ToUpper(mode), strings.ToLower(goal), math.Max(1, math.Round(durS/60.0))),
			},
		}
		if rel > 0 {
			factors = append(factors, map[string]string{
				"label":  "Arrival Reliability",
				"impact": "positive",
				"detail": fmt.Sprintf("%.0f%% predicted on-time arrival reliability.", rel*100),
			})
		}
		if cost > 0 {
			factors = append(factors, map[string]string{
				"label":  "Estimated Trip Cost",
				"impact": "neutral",
				"detail": fmt.Sprintf("Estimated ₹%.0f fare/fuel cost.", cost),
			})
		}
		explainability = map[string]any{
			"summary":         fmt.Sprintf("Recommended %s optimizes %s across live corridor conditions.", strings.ToUpper(mode), strings.ToLower(goal)),
			"factors":         factors,
			"confidence_note": "Evaluated using multi-objective route scoring & traffic priors.",
		}
		answer = fmt.Sprintf("Why %s is recommended: %s ranked #1 for %s (~%.0f min ETA, %.0f%% reliable, ₹%.0f est. cost).",
			strings.ToUpper(mode), strings.ToUpper(mode), strings.ToLower(goal), math.Max(1, math.Round(durS/60.0)), rel*100, cost)
	}

	resp := map[string]any{
		"detected_language": "en",
		"intent":            intent,
		"answer":            answer,
		"model_version":     "qwen3-bgem3-minilm-fallback-v0",
	}
	if explainability != nil {
		resp["explainability"] = explainability
	}
	writeJSON(w, http.StatusOK, resp)
}

// ListStackLibraries returns the 6 open-source mobility engineering layers configured in the platform.
func (s *Service) ListStackLibraries(w http.ResponseWriter, r *http.Request) {
	if s.ml != nil {
		if out, ok := s.ml.GetJSON(r.Context(), "/v1/stack/libraries"); ok {
			writeJSON(w, http.StatusOK, out)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"layers": map[string]any{
			"1_routing":           []string{"Valhalla", "GraphHopper", "OSRM", "OpenTripPlanner (OTP)"},
			"2_geospatial":        []string{"PostGIS", "Uber H3", "GeoPandas", "Shapely", "PyProj", "MovingPandas"},
			"3_traffic_ml":        []string{"PyTorch Geometric (STGCN/DCRNN)", "LightGBM", "CatBoost", "XGBoost", "Scikit-learn", "River"},
			"4_demand_analytics":  []string{"PyTorch Forecasting (TFT)", "Prophet", "HDBSCAN", "SciPy"},
			"5_computer_vision":   []string{"Ultralytics YOLO / RT-DETR", "MobileNet", "OpenCV"},
			"6_mobility_ai_agent": []string{"Qwen3", "Whisper", "BGE-M3", "Multilingual MiniLM Reranker"},
		},
	})
}

// GetIntelligenceStatus exposes real-time telemetry from the Python ML brain and SQS event worker.
func (s *Service) GetIntelligenceStatus(w http.ResponseWriter, r *http.Request) {
	if s.ml != nil {
		health, ok1 := s.ml.GetJSON(r.Context(), "/healthz")
		evStatus, ok2 := s.ml.GetJSON(r.Context(), "/v1/events/status")
		if ok1 || ok2 {
			writeJSON(w, http.StatusOK, map[string]any{
				"brain_reachable": true,
				"health":          health,
				"online_learner":  evStatus,
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"brain_reachable": false,
		"mode":            "deterministic_fallback",
	})
}

func validLatLon(p GeoPoint) bool {
	return p.Latitude >= -90 && p.Latitude <= 90 && p.Longitude >= -180 && p.Longitude <= 180 && (p.Latitude != 0 || p.Longitude != 0)
}

func estimateCostINR(mode string, distanceM float64) float64 {
	km := distanceM / 1000.0
	switch mode {
	case "walk", "bicycle":
		return 0
	case "two_wheeler":
		return math.Round(km * 2.5)
	case "car":
		return math.Round(km * 7.0)
	case "bus":
		return math.Min(40, math.Max(10, math.Round(km*2.0)))
	case "metro":
		return math.Min(60, math.Max(15, math.Round(km*3.0)))
	case "multimodal", "two_wheeler_metro":
		return math.Min(65, math.Max(20, math.Round(km*2.8)))
	default:
		return math.Round(km * 5.0)
	}
}

func estimateReliability(mode string) float64 {
	switch mode {
	case "metro":
		return 0.94
	case "multimodal", "two_wheeler_metro":
		return 0.90
	case "walk", "bicycle":
		return 0.92
	case "two_wheeler":
		return 0.80
	case "car":
		return 0.72
	case "bus":
		return 0.65
	default:
		return 0.75
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, retryable bool) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":       code,
			"message":    message,
			"request_id": middleware.GetReqID(r.Context()),
			"retryable":  retryable,
		},
	})
}
