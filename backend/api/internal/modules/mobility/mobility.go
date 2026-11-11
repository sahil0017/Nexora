// Package mobility exposes the NEXORA Move REST endpoints.
package mobility

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Mount registers all /move/* routes on the given router.
func Mount(r chi.Router) {
	r.Route("/move", func(m chi.Router) {
		m.Post("/journeys/plan", PlanJourney)
		m.Get("/places", ListPlaces)
		m.Post("/trips", StartTrip)
		m.Get("/transit/stops/nearby", NearbyStops)
	})
}

// PlanJourney returns route alternatives. M3 replaces the stub with
// provider routing + prediction service calls.
func PlanJourney(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"journey_id": "00000000-0000-0000-0000-000000000010",
		"alternatives": []map[string]any{
			{
				"route_id":         "00000000-0000-0000-0000-000000000011",
				"duration_seconds": 2100,
				"eta": map[string]int{
					"p50_seconds": 2100,
					"p90_seconds": 2700,
				},
				"distance_meters":   12500,
				"mode_sequence":     []string{"two_wheeler"},
				"reliability":       "medium",
				"traffic_freshness": "predicted",
				"geometry": map[string]any{
					"format":      "geojson",
					"coordinates": []any{},
				},
			},
		},
		"model_version": "baseline-v0",
		"note":          "Illustrative response; replace with provider-backed implementation.",
	})
}

func ListPlaces(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"places": []any{}})
}

func StartTrip(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusCreated, map[string]any{
		"trip_id": "00000000-0000-0000-0000-000000000020",
		"status":  "active",
	})
}

func NearbyStops(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"stops": []any{}})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
