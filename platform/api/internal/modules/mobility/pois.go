package mobility

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// NearbyPOI represents a real petrol pump, EV charging station, or speed camera fetched from OpenStreetMap Overpass API.
type NearbyPOI struct {
	ID             string  `json:"id"`
	Kind           string  `json:"kind"` // "fuel" | "ev" | "cam"
	Name           string  `json:"name"`
	Operator       string  `json:"operator,omitempty"`
	Brand          string  `json:"brand,omitempty"`
	Subtitle       string  `json:"subtitle"`
	Latitude       float64 `json:"latitude"`
	Longitude      float64 `json:"longitude"`
	DistanceMeters int     `json:"distance_meters"`
	Address        string  `json:"address,omitempty"`
	OpeningHours   string  `json:"opening_hours,omitempty"`
	ConnectorInfo  string  `json:"connector_info,omitempty"`
	FuelTypes      string  `json:"fuel_types,omitempty"`
	MaxSpeed       string  `json:"maxspeed,omitempty"`
	Source         string  `json:"source"`
}

type poiCacheEntry struct {
	expiresAt time.Time
	pois      []NearbyPOI
}

var (
	poiCacheMu sync.RWMutex
	poiCache   = map[string]poiCacheEntry{}
	poiHTTP    = &http.Client{Timeout: 5 * time.Second}
)

type overpassElement struct {
	Type   string  `json:"type"`
	ID     int64   `json:"id"`
	Lat    float64 `json:"lat"`
	Lon    float64 `json:"lon"`
	Center *struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"center,omitempty"`
	Tags map[string]string `json:"tags"`
}

// GetNearbyPOIs queries the open-source OpenStreetMap Overpass API for accurate fuel stations, EV chargers, and speed cameras.
func (s *Service) GetNearbyPOIs(w http.ResponseWriter, r *http.Request) {
	lat, err1 := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lon, err2 := strconv.ParseFloat(r.URL.Query().Get("lon"), 64)
	if err1 != nil || err2 != nil || !validLatLon(GeoPoint{Latitude: lat, Longitude: lon}) {
		writeError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "valid lat and lon query parameters are required", false)
		return
	}
	radiusM, _ := strconv.Atoi(r.URL.Query().Get("radius_m"))
	if radiusM <= 0 {
		radiusM = 3500
	}
	if radiusM > 15000 {
		radiusM = 15000
	}

	pois, source := fetchOverpassPOIs(r.Context(), lat, lon, radiusM)
	writeJSON(w, http.StatusOK, map[string]any{
		"pois":     pois,
		"source":   source,
		"radius_m": radiusM,
	})
}

func fetchOverpassPOIs(ctx context.Context, lat, lon float64, radiusM int) ([]NearbyPOI, string) {
	endpoint := strings.TrimSpace(os.Getenv("NEXORA_OVERPASS_URL"))
	if endpoint == "" {
		endpoint = "https://overpass-api.de/api/interpreter"
	}

	// Only cache when using the default public Overpass endpoint so test mocks run fresh each call.
	useCache := endpoint == "https://overpass-api.de/api/interpreter"
	cacheKey := fmt.Sprintf("%.3f:%.3f:%d", lat, lon, radiusM)
	if useCache {
		poiCacheMu.RLock()
		if hit, ok := poiCache[cacheKey]; ok && time.Now().Before(hit.expiresAt) {
			poiCacheMu.RUnlock()
			return hit.pois, "openstreetmap-overpass-cached"
		}
		poiCacheMu.RUnlock()
	}

	query := fmt.Sprintf(`[out:json][timeout:4];(
  node["amenity"="fuel"](around:%d,%.5f,%.5f);
  way["amenity"="fuel"](around:%d,%.5f,%.5f);
  node["amenity"="charging_station"](around:%d,%.5f,%.5f);
  way["amenity"="charging_station"](around:%d,%.5f,%.5f);
  node["highway"="speed_camera"](around:%d,%.5f,%.5f);
);out center 30;`,
		radiusM, lat, lon,
		radiusM, lat, lon,
		radiusM, lat, lon,
		radiusM, lat, lon,
		radiusM, lat, lon,
	)

	form := url.Values{}
	form.Set("data", query)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return []NearbyPOI{}, "overpass-unavailable"
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Nexora-Mobility/1.0")

	resp, err := poiHTTP.Do(req)
	if err != nil {
		return []NearbyPOI{}, "overpass-unavailable"
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return []NearbyPOI{}, "overpass-unavailable"
	}

	var decoded struct {
		Elements []overpassElement `json:"elements"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return []NearbyPOI{}, "overpass-unavailable"
	}

	pois := make([]NearbyPOI, 0, len(decoded.Elements))
	for _, el := range decoded.Elements {
		pLat, pLon := el.Lat, el.Lon
		if el.Center != nil && (pLat == 0 && pLon == 0) {
			pLat, pLon = el.Center.Lat, el.Center.Lon
		}
		if !validLatLon(GeoPoint{Latitude: pLat, Longitude: pLon}) {
			continue
		}
		distM := int(math.Round(haversineMeters(lat, lon, pLat, pLon)))
		poi := parseOverpassElement(el, pLat, pLon, distM)
		if poi.Kind != "" {
			pois = append(pois, poi)
		}
	}

	sort.Slice(pois, func(i, j int) bool {
		return pois[i].DistanceMeters < pois[j].DistanceMeters
	})

	if useCache {
		poiCacheMu.Lock()
		if len(poiCache) > 256 {
			poiCache = map[string]poiCacheEntry{}
		}
		poiCache[cacheKey] = poiCacheEntry{
			expiresAt: time.Now().Add(5 * time.Minute),
			pois:      pois,
		}
		poiCacheMu.Unlock()
	}

	return pois, "openstreetmap-overpass"
}

func parseOverpassElement(el overpassElement, pLat, pLon float64, distM int) NearbyPOI {
	tags := el.Tags
	amenity := tags["amenity"]
	highway := tags["highway"]

	brand := firstNonEmptyTag(tags, "brand", "network", "operator")
	rawName := firstNonEmptyTag(tags, "name", "brand", "operator", "network")
	street := firstNonEmptyTag(tags, "addr:street", "addr:full", "addr:suburb")
	hours := tags["opening_hours"]

	poi := NearbyPOI{
		ID:             fmt.Sprintf("osm-%s-%d", el.Type, el.ID),
		Operator:       tags["operator"],
		Brand:          brand,
		Latitude:       pLat,
		Longitude:      pLon,
		DistanceMeters: distM,
		Address:        street,
		OpeningHours:   hours,
		Source:         "OpenStreetMap",
	}

	distLabel := formatDistLabel(distM)

	switch {
	case amenity == "fuel":
		poi.Kind = "fuel"
		if rawName == "" {
			rawName = "Petrol & Fuel Station"
		}
		poi.Name = rawName
		fuels := collectFlagLabels(tags, []struct{ key, label string }{
			{"fuel:petrol", "Petrol"},
			{"fuel:octane_95", "Octane 95"},
			{"fuel:diesel", "Diesel"},
			{"fuel:cng", "CNG"},
			{"fuel:lpg", "LPG"},
		})
		if len(fuels) > 0 {
			poi.FuelTypes = strings.Join(fuels, " · ")
		}
		parts := make([]string, 0, 4)
		if poi.FuelTypes != "" {
			parts = append(parts, poi.FuelTypes)
		} else if brand != "" && brand != rawName {
			parts = append(parts, brand)
		} else {
			parts = append(parts, "Fuel Pump")
		}
		if hours != "" {
			parts = append(parts, hours)
		}
		if street != "" {
			parts = append(parts, street)
		}
		parts = append(parts, distLabel)
		poi.Subtitle = strings.Join(parts, " · ")

	case amenity == "charging_station":
		poi.Kind = "ev"
		if rawName == "" {
			rawName = "EV Charging Station"
		}
		poi.Name = rawName
		sockets := collectFlagLabels(tags, []struct{ key, label string }{
			{"socket:ccs2", "CCS2"},
			{"socket:ccs", "CCS"},
			{"socket:type2", "Type 2"},
			{"socket:chademo", "CHAdeMO"},
			{"socket:type2_combo", "CCS2"},
		})
		if capStr := strings.TrimSpace(tags["capacity"]); capStr != "" {
			sockets = append(sockets, capStr+" bays")
		}
		if len(sockets) > 0 {
			poi.ConnectorInfo = strings.Join(sockets, " · ")
		}
		parts := make([]string, 0, 4)
		if poi.ConnectorInfo != "" {
			parts = append(parts, poi.ConnectorInfo)
		} else if brand != "" {
			parts = append(parts, brand)
		} else {
			parts = append(parts, "EV Charger")
		}
		if hours != "" {
			parts = append(parts, hours)
		}
		if street != "" {
			parts = append(parts, street)
		}
		parts = append(parts, distLabel)
		poi.Subtitle = strings.Join(parts, " · ")

	case highway == "speed_camera":
		poi.Kind = "cam"
		poi.MaxSpeed = tags["maxspeed"]
		if poi.MaxSpeed != "" {
			poi.Name = fmt.Sprintf("Speed Camera · %s km/h", poi.MaxSpeed)
		} else {
			poi.Name = "Traffic Speed Camera"
		}
		poi.Subtitle = strings.TrimSpace(fmt.Sprintf("OSM traffic enforcement · %s", distLabel))
	}
	return poi
}

func firstNonEmptyTag(tags map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(tags[k]); v != "" {
			return v
		}
	}
	return ""
}

func collectFlagLabels(tags map[string]string, specs []struct{ key, label string }) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range specs {
		v := strings.ToLower(strings.TrimSpace(tags[s.key]))
		if v != "" && v != "no" && !seen[s.label] {
			seen[s.label] = true
			if v != "yes" && s.key == "socket:ccs2" {
				out = append(out, s.label)
			} else {
				out = append(out, s.label)
			}
		}
	}
	return out
}

func formatDistLabel(distM int) string {
	if distM >= 1000 {
		return fmt.Sprintf("%.1f km away", float64(distM)/1000.0)
	}
	return fmt.Sprintf("%d m away", distM)
}
