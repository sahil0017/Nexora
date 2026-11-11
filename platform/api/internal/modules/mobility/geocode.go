package mobility

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// PlaceResult is one geocoded destination candidate.
type PlaceResult struct {
	Name      string  `json:"name"`
	Subtitle  string  `json:"subtitle,omitempty"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Source    string  `json:"source,omitempty"`
}

var geocodeClient = &http.Client{Timeout: 5 * time.Second}

// geocoderURL is configurable (GEOCODER_URL); any Photon-compatible endpoint works.
func geocoderURL() string {
	if v := strings.TrimSpace(os.Getenv("GEOCODER_URL")); v != "" {
		return v
	}
	return "https://photon.komoot.io/api"
}

// Geocode searches places by free text, merging user's Saved Places + Redis Cache + Photon OSM geocoder.
// GET /move/places/search?q=...&lat=..&lon=..&user_id=..
func (s *Service) Geocode(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "q must be at least 2 characters", false)
		return
	}
	qLower := strings.ToLower(q)
	userID := strings.TrimSpace(r.URL.Query().Get("user_id"))
	lat, lon := r.URL.Query().Get("lat"), r.URL.Query().Get("lon")

	var savedMatches []PlaceResult
	if s.repo != nil && userID != "" {
		if _, err := uuid.Parse(userID); err == nil {
			if saved, err := s.repo.ListSavedPlaces(r.Context(), userID); err == nil {
				for _, sp := range saved {
					if strings.Contains(strings.ToLower(sp.Name), qLower) || strings.Contains(strings.ToLower(sp.Address), qLower) {
						savedMatches = append(savedMatches, PlaceResult{
							Name:      sp.Name,
							Subtitle:  "Saved · " + sp.PlaceType,
							Latitude:  sp.Location.Latitude,
							Longitude: sp.Location.Longitude,
							Source:    "saved_place",
						})
					}
				}
			}
		}
	}

	cacheKey := "nexora:geocode:" + qLower + ":" + lat + "," + lon
	if s.cache != nil {
		if raw, ok := s.cache.Get(r.Context(), cacheKey); ok {
			var cached []PlaceResult
			if json.Unmarshal([]byte(raw), &cached) == nil {
				writeJSON(w, http.StatusOK, map[string]any{"places": append(savedMatches, cached...)})
				return
			}
		}
	}

	params := url.Values{"q": {q}, "limit": {"6"}}
	if lat != "" && lon != "" {
		params.Set("lat", lat)
		params.Set("lon", lon)
	}
	results, err := fetchGeocode(r.Context(), geocoderURL()+"?"+params.Encode())
	if err != nil {
		if len(savedMatches) > 0 {
			writeJSON(w, http.StatusOK, map[string]any{"places": savedMatches})
			return
		}
		writeError(w, r, http.StatusBadGateway, "GEOCODER_UNAVAILABLE", "place search is unavailable", true)
		return
	}
	if s.cache != nil && len(results) > 0 {
		if b, err := json.Marshal(results); err == nil {
			s.cache.Set(r.Context(), cacheKey, string(b), 6*time.Hour)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"places": append(savedMatches, results...)})
}

func fetchGeocode(ctx context.Context, endpoint string) ([]PlaceResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := geocodeClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, http.ErrNotSupported
	}
	var fc struct {
		Features []struct {
			Geometry struct {
				Coordinates []float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties map[string]any `json:"properties"`
		} `json:"features"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fc); err != nil {
		return nil, err
	}
	out := make([]PlaceResult, 0, len(fc.Features))
	for _, f := range fc.Features {
		if len(f.Geometry.Coordinates) < 2 {
			continue
		}
		str := func(k string) string { v, _ := f.Properties[k].(string); return v }
		name := str("name")
		if name == "" {
			name = str("street")
		}
		if name == "" {
			continue
		}
		var parts []string
		for _, k := range []string{"district", "city", "state"} {
			if v := str(k); v != "" && v != name {
				parts = append(parts, v)
			}
		}
		out = append(out, PlaceResult{
			Name: name, Subtitle: strings.Join(parts, ", "),
			Longitude: f.Geometry.Coordinates[0], Latitude: f.Geometry.Coordinates[1],
		})
	}
	return out, nil
}
