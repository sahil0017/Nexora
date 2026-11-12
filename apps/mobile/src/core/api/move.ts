// Typed wrappers over the Move (mobility) endpoints.
import { api } from './client';

export type GeoPoint = { latitude: number; longitude: number };

export type LocationSampleInput = GeoPoint & {
  speed_mps?: number;
  heading_degrees?: number;
  accuracy_meters?: number;
  recorded_at?: string;
};

export type TracePoint = GeoPoint & {
  speed_mps?: number;
  heading_degrees?: number;
  accuracy_meters?: number;
  recorded_at: string;
};

export type SpatialRadarMember = {
  member: string;
  latitude: number;
  longitude: number;
  distance_m: number;
};

export type SpatialRadarSnapshot = {
  spatial_source: string;
  radius_meters: number;
  active_nearby_trips: number;
  nearby_trip_probes: SpatialRadarMember[];
  nearby_hazard_coords: SpatialRadarMember[];
};

export type RouteLeg = {
  mode: string;
  label?: string;
  distance_meters: number;
  duration_seconds: number;
  wait_seconds?: number;
};

export type ConfidenceInterval = {
  low_seconds: number;
  median_seconds: number;
  high_seconds: number;
  spread_minutes: number;
  confidence_pct: number;
  certainty_label: string;
};

export type ReliabilityBreakdown = {
  score: number;
  tier: string;
  factors: string[];
};

export type ObjectiveScores = {
  time_score: number;
  reliability_score: number;
  cost_score: number;
  walk_score: number;
  overall_score: number;
};

export type RouteAlternative = {
  route_id: string;
  mode: string;
  mode_sequence?: string[];
  legs?: RouteLeg[];
  duration_seconds: number;
  distance_meters: number;
  eta_range_seconds?: Record<string, number>;
  confidence_interval?: ConfidenceInterval;
  reliability_breakdown?: ReliabilityBreakdown;
  objective_scores?: ObjectiveScores;
  hazard_impact?: { active_hazards: number; penalty_seconds: number };
  event_impact?: string;
  co2_grams?: number;
  estimated_cost: { currency: string; amount: number };
  reliability_score: number;
  ranking_score: number;
  transfers: number;
  walking_minutes: number;
  pedestrian_safety_score?: number;
  animal_conflict_risk?: number;
  safety_advisories?: string[];
  explanation?: string | string[];
  geometry?: string;
  steps?: RouteStep[];
};

/** Decode a Google-encoded polyline (precision 5) into lat/lng points. */
export function decodePolyline(encoded: string): GeoPoint[] {
  if (!encoded) return [];
  const pts: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    pts.push({ latitude: lat * 1e-5, longitude: lng * 1e-5 });
  }
  return pts;
}

export type RouteStep = {
  instruction: string;
  street?: string;
  turn_type: string;
  turn_icon: string;
  distance_meters: number;
  location: GeoPoint;
};

export type NearbyPOI = {
  id: string;
  kind: 'fuel' | 'ev' | 'cam';
  name: string;
  operator?: string;
  brand?: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
  address?: string;
  opening_hours?: string;
  connector_info?: string;
  fuel_types?: string;
  maxspeed?: string;
  source: string;
};

export function haversineDistM(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * s2 * s2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

export function computeBearingDeg(from: GeoPoint, to: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.round(((toDeg(Math.atan2(y, x)) % 360) + 360) % 360);
}

async function fetchDirectOverpassPOIs(p: GeoPoint, radiusM: number): Promise<{ pois: NearbyPOI[]; source: string }> {
  const query = `[out:json][timeout:5];(node["amenity"="fuel"](around:${radiusM},${p.latitude},${p.longitude});way["amenity"="fuel"](around:${radiusM},${p.latitude},${p.longitude});node["amenity"="charging_station"](around:${radiusM},${p.latitude},${p.longitude});way["amenity"="charging_station"](around:${radiusM},${p.latitude},${p.longitude});node["highway"="speed_camera"](around:${radiusM},${p.latitude},${p.longitude}););out center 30;`;
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) return { pois: [], source: 'overpass-unavailable' };
  const data = (await resp.json()) as {
    elements?: Array<{
      type: string;
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };
  const pois: NearbyPOI[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const dist = haversineDistM(p, { latitude: lat, longitude: lon });
    const distLabel = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km away` : `${dist} m away`;
    const brand = tags.brand || tags.network || tags.operator;
    const street = tags['addr:street'] || tags['addr:full'] || tags['addr:suburb'];
    const hours = tags.opening_hours;

    if (tags.amenity === 'fuel') {
      const fuels = [
        tags['fuel:petrol'] && tags['fuel:petrol'] !== 'no' ? 'Petrol' : null,
        tags['fuel:diesel'] && tags['fuel:diesel'] !== 'no' ? 'Diesel' : null,
        tags['fuel:cng'] && tags['fuel:cng'] !== 'no' ? 'CNG' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const name = tags.name || brand || 'Petrol & Fuel Station';
      pois.push({
        id: `osm-${el.type}-${el.id}`,
        kind: 'fuel',
        name,
        operator: tags.operator,
        brand,
        fuel_types: fuels || undefined,
        address: street,
        opening_hours: hours,
        latitude: lat,
        longitude: lon,
        distance_meters: dist,
        subtitle: [fuels || brand || 'Fuel Pump', hours, street, distLabel].filter(Boolean).join(' · '),
        source: 'OpenStreetMap',
      });
    } else if (tags.amenity === 'charging_station') {
      const sockets = [
        tags['socket:ccs2'] && tags['socket:ccs2'] !== 'no' ? 'CCS2' : null,
        tags['socket:type2'] && tags['socket:type2'] !== 'no' ? 'Type 2' : null,
        tags['socket:chademo'] && tags['socket:chademo'] !== 'no' ? 'CHAdeMO' : null,
        tags.capacity ? `${tags.capacity} bays` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const name = tags.name || brand || 'EV Charging Station';
      pois.push({
        id: `osm-${el.type}-${el.id}`,
        kind: 'ev',
        name,
        operator: tags.operator,
        brand,
        connector_info: sockets || undefined,
        address: street,
        opening_hours: hours,
        latitude: lat,
        longitude: lon,
        distance_meters: dist,
        subtitle: [sockets || brand || 'EV Charger', hours, street, distLabel].filter(Boolean).join(' · '),
        source: 'OpenStreetMap',
      });
    } else if (tags.highway === 'speed_camera') {
      pois.push({
        id: `osm-${el.type}-${el.id}`,
        kind: 'cam',
        name: tags.maxspeed ? `Speed Camera · ${tags.maxspeed} km/h` : 'Traffic Speed Camera',
        maxspeed: tags.maxspeed,
        latitude: lat,
        longitude: lon,
        distance_meters: dist,
        subtitle: `OSM traffic enforcement · ${distLabel}`,
        source: 'OpenStreetMap',
      });
    }
  }
  pois.sort((a, b) => a.distance_meters - b.distance_meters);
  return { pois, source: 'openstreetmap-overpass' };
}

export type ActiveCityEvent = {
  event_id: string;
  title: string;
  category: string;
  severity: string;
  advisory: string;
  road_delay_multiplier?: number;
  metro_unaffected?: boolean;
};

export type TrafficAnomaly = {
  segment_id: string;
  expected_speed_kph: number;
  observed_speed_kph: number;
  speed_drop_pct: number;
  z_score: number;
  is_anomaly: boolean;
  severity: string;
  cause_hint: string;
};

export type ExplainabilityFactor = {
  label: string;
  impact: string;
  detail: string;
};

export type RouteExplainability = {
  summary: string;
  factors: ExplainabilityFactor[];
  confidence_note?: string;
};

export type RouteContextPayload = {
  mode: string;
  optimize_for: string;
  duration_seconds: number;
  p90_seconds?: number;
  reliability_score: number;
  cost_inr?: number;
  compared_mode?: string;
  compared_duration_seconds?: number;
};

export type JourneyPlan = {
  journey_id: string;
  generated_at: string;
  alternatives: RouteAlternative[];
  active_events?: ActiveCityEvent[];
  active_hazards?: number;
  model_version?: string;
};

export type OptimizeFor = 'FASTEST' | 'RELIABILITY' | 'CHEAPEST' | 'LEAST_WALKING' | 'BALANCED';

export type Place = { name: string; subtitle?: string; latitude: number; longitude: number };

export const MODE_OPTIONS = [
  { key: 'two_wheeler', label: '2W' },
  { key: 'car', label: 'Car' },
  { key: 'metro', label: 'Metro' },
  { key: 'multimodal', label: '2W+Metro' },
  { key: 'bus', label: 'Bus' },
  { key: 'bicycle', label: 'Cycle' },
  { key: 'walk', label: 'Walk' },
] as const;

export const moveApi = {
  planJourney: (body: {
    origin: GeoPoint;
    destination: GeoPoint;
    modes: string[];
    optimizeFor: OptimizeFor;
    avoidTolls?: boolean;
    avoidHazards?: boolean;
    maxWalkingMinutes?: number;
    weights?: Record<string, number>;
    userId?: string;
  }) =>
    api.post<JourneyPlan>('/move/journeys/plan', {
      ...(body.userId ? { user_id: body.userId } : {}),
      origin: body.origin,
      destination: body.destination,
      modes: body.modes,
      preferences: {
        optimize_for: body.optimizeFor,
        ...(body.avoidTolls !== undefined ? { avoid_tolls: body.avoidTolls } : {}),
        ...(body.avoidHazards !== undefined ? { avoid_hazards: body.avoidHazards } : {}),
        ...(body.maxWalkingMinutes !== undefined ? { max_walking_minutes: body.maxWalkingMinutes } : {}),
        ...(body.weights ? { weights: body.weights } : {}),
      },
    }),

  assistantQuery: (query: string, routeContext?: RouteContextPayload, near?: GeoPoint) =>
    api.post<{
      answer: string;
      reply?: string;
      intent?: string;
      detected_intents?: string[];
      detected_language?: string;
      language?: string;
      model_version?: string;
      explainability?: RouteExplainability;
      retrieved_context?: Array<{ id: string; title: string; content: string; relevance_score: number }>;
    }>('/move/assistant/query', {
      query,
      ...(routeContext ? { route_context: routeContext } : {}),
      ...(near ? { latitude: near.latitude, longitude: near.longitude } : {}),
    }),

  trafficAnomalies: (segmentIds: string[] = ['corridor-primary'], weather = 'clear') =>
    api.get<{ anomalies: TrafficAnomaly[]; active_anomaly_count: number; model_version?: string }>(
      `/move/traffic/anomalies?segment_ids=${encodeURIComponent(segmentIds.join(','))}&weather=${encodeURIComponent(weather)}`,
    ),

  activeEvents: (p?: GeoPoint) =>
    api.get<{ events: ActiveCityEvent[]; model_version?: string }>(
      p ? `/move/events/active?lat=${p.latitude}&lon=${p.longitude}` : '/move/events/active',
    ),

  searchPlaces: (q: string, near?: GeoPoint, userId?: string) =>
    api.get<{ places: Place[] }>(
      `/move/places/search?q=${encodeURIComponent(q)}${
        near ? `&lat=${near.latitude}&lon=${near.longitude}` : ''
      }${userId ? `&user_id=${encodeURIComponent(userId)}` : ''}`,
    ),

  listSavedPlaces: async (userId: string) => {
    const res = await api.get<{
      places: Array<{
        id: string;
        name: string;
        place_type: string;
        latitude?: number;
        longitude?: number;
        location?: GeoPoint;
      }>;
    }>(`/move/places?user_id=${encodeURIComponent(userId)}`);
    return {
      places: (res.places ?? []).map(p => ({
        ...p,
        latitude: p.latitude ?? p.location?.latitude ?? 0,
        longitude: p.longitude ?? p.location?.longitude ?? 0,
      })),
    };
  },

  savePlace: (body: {
    user_id: string;
    name: string;
    place_type?: 'home' | 'work' | 'custom';
    location: GeoPoint;
  }) => api.post('/move/places', body),

  intelligenceStatus: () =>
    api.get<{
      brain_reachable: boolean;
      mode?: string;
      health?: { models?: Record<string, string>; events_processed?: number };
      online_learner?: { sqs_polls?: number; active_hazards_count?: number; active_hotspots_count?: number };
    }>('/move/intelligence/status'),

  nearbyHazards: (p: GeoPoint, radiusM = 3000) =>
    api.get<{ hazards: Array<{ id?: string; hazard_type: string; severity: string; confidence?: number }> }>(
      `/move/hazards/nearby?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`,
    ),

  nearbyPois: async (p: GeoPoint, radiusM = 3500): Promise<{ pois: NearbyPOI[]; source: string }> => {
    try {
      const res = await api.get<{ pois: NearbyPOI[]; source: string }>(
        `/move/pois/nearby?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`,
      );
      if (res.pois?.length > 0 || res.source === 'openstreetmap-overpass' || res.source === 'openstreetmap-overpass-cached') {
        return res;
      }
    } catch {
      // Fall through to direct open-source Overpass query if Go proxy is offline
    }
    try {
      return await fetchDirectOverpassPOIs(p, radiusM);
    } catch {
      return { pois: [], source: 'overpass-unavailable' };
    }
  },

  reportHazard: (body: {
    user_id?: string;
    latitude: number;
    longitude: number;
    hint_category: 'pothole' | 'waterlogging' | 'blocked_lane' | 'damaged_road';
  }) =>
    api.post<Hazard>('/move/hazards/report', body),

  predictDemand: (p: GeoPoint, weather = 'clear') =>
    api.post<{
      model_version?: string;
      zones?: Array<{
        h3_index: string;
        predicted_demand?: number;
        surge_pressure?: number;
        peak_hour_probability?: number;
        transport_availability?: number;
        horizons?: Array<{
          horizon_minutes: number;
          predicted_demand: number;
          surge_pressure: number;
          peak_hour_probability: number;
          transport_availability: number;
        }>;
      }>;
      forecasts?: Array<{
        h3_index: string;
        predicted_demand_idx: number;
        surge_pressure: number;
        peak_hour_prob: number;
        transport_avail_score: number;
        model_version?: string;
      }>;
    }>('/move/demand/predict', {
      latitude: p.latitude,
      longitude: p.longitude,
      weather,
    }),

  stackLibraries: () =>
    api.get<{ layers: Record<string, Array<{ name: string; role?: string }> | string[]> }>(
      '/move/stack/libraries',
    ),

  trafficSegments: (p: GeoPoint, radiusM = 3000) =>
    api.get<{
      segments: Array<{ segment_id: string; current_speed_kmph: number; congestion_level: string; freshness: string }>;
    }>(`/move/traffic/segments?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`),

  trafficPredictions: async (segmentIds: string[], horizonMin = 30) => {
    const res = await api.get<{
      source: string;
      predictions: Array<{ segment_id: string; speed_kph?: number; predicted_speed_kmph?: number; model_version: string }>;
    }>(`/move/traffic/predictions?segment_ids=${encodeURIComponent(segmentIds.join(','))}&horizon_minutes=${horizonMin}`);
    return {
      ...res,
      predictions: (res.predictions ?? []).map(p => ({
        ...p,
        speed_kph: p.speed_kph ?? p.predicted_speed_kmph ?? 0,
      })),
    };
  },

  nearbyStops: async (p: GeoPoint, radiusM = 1500) => {
    const res = await api.get<{
      stops: Array<{
        id?: string;
        stop_id?: string;
        name: string;
        mode?: string;
        stop_type?: string;
        distance_m?: number;
        distance_meters?: number;
      }>;
    }>(`/move/transit/stops/nearby?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`);
    return {
      stops: (res.stops ?? []).map(s => ({
        id: s.id ?? s.stop_id ?? s.name,
        name: s.name,
        mode: s.mode ?? s.stop_type ?? 'transit',
        distance_m: s.distance_m ?? s.distance_meters,
      })),
    };
  },

  transitDepartures: (stopId: string) =>
    api.get<{
      stop_id: string;
      freshness: string;
      departures: Array<{ route_id: string; headsign: string; expected_at: string; is_realtime: boolean; delay_seconds: number }>;
    }>(`/move/transit/departures?stop_id=${encodeURIComponent(stopId)}`),

  discoverHotspots: (points: Array<GeoPoint & { speed_mps?: number }>) =>
    api.post<{
      hotspots: Array<{
        h3_index: string;
        point_count?: number;
        sample_count?: number;
        avg_speed_mps?: number;
        avg_speed_kph?: number;
        congestion_score: number;
        severity?: string;
      }>;
      model_version: string;
    }>('/move/hotspots', { points }),
};

export const formatDuration = (seconds: number) => {
  const m = Math.max(1, Math.round(seconds / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};

export const modeLabel = (mode: string) => {
  const m = mode.toLowerCase();
  if (m === 'multimodal' || m === 'two_wheeler_metro') return '2W + Metro';
  return MODE_OPTIONS.find(x => x.key === m)?.label ?? mode;
};

// ---- Identity, profile, saved places, insights, departure advice ----

export type Me = {
  id: string;
  email: string;
  display_name: string;
  modules: string[];
  locale: string;
  timezone: string;
};

export type MobilityProfile = {
  user_id: string;
  default_mode: string;
  optimize_for: OptimizeFor;
  avoid_tolls: boolean;
  max_walking_minutes: number;
  weights?: Record<string, number>;
  preferences?: Record<string, unknown>;
};

export type SavedPlace = {
  id: string;
  name: string;
  place_type: string;
  location: GeoPoint;
  address?: string;
};

export type CommuteInsights = {
  completed_trips: number;
  avg_duration_minutes: number;
  total_time_saved_minutes?: number;
  peak_avoidance_pct?: number;
  avg_reliability_pct?: number;
  personalized_tip?: string;
  avg_rating?: number;
  mode_breakdown: Record<string, number>;
};

export type DepartureSlotPoint = {
  departure: string;
  arrival: string;
  duration_minutes: number;
  p90_minutes: number;
  arrival_confidence: number;
  congestion_level: string;
  is_now?: boolean;
  is_optimal?: boolean;
};

export type DepartureAdvice = {
  recommended_departure: string;
  predicted_arrival: string;
  predicted_duration_minutes: number;
  arrival_confidence: number;
  time_saved_vs_now_minutes?: number;
  slot_series?: DepartureSlotPoint[];
  active_events?: ActiveCityEvent[];
  reason?: string;
};

export type Hazard = {
  id: string;
  hazard_type: string;
  severity: string;
  confidence?: number;
  location: GeoPoint;
};

export const userApi = {
  me: () => api.get<Me>('/me'),
};

export type HealthStatus = {
  status: string;
  service: string;
  version: string;
  database: string;
  docstore: string;
  redis: string;
};

export type DocItem = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at?: string;
};

export const platformApi = {
  health: () => api.get<HealthStatus>('/healthz'),
  ready: () => api.get<{ status: string }>('/readyz'),
  register: (email: string, password: string) =>
    api.post<{ user_id: string; access_token: string; token_type: string }>('/auth/register', { email, password }),
  login: (email: string, password: string) =>
    api.post<{ user_id: string; access_token: string; token_type: string }>('/auth/login', { email, password }),
  saveDoc: (body: { user_id: string; title: string; content: string }) =>
    api.post<{ id: string }>('/documents', body),
  listDocs: (userId: string, limit = 10) =>
    api.get<{ documents: DocItem[]; count: number }>(`/documents?user_id=${encodeURIComponent(userId)}&limit=${limit}`),
  getDoc: (id: string) => api.get<DocItem>(`/documents/${encodeURIComponent(id)}`),
  deleteDoc: (id: string) => api.del<{ deleted?: boolean }>(`/documents/${encodeURIComponent(id)}`),
  startConversation: () =>
    api.post<{ conversation_id: string; status: string }>('/assistant/conversations'),
  sendConversationMessage: (id: string, message: string) =>
    api.post<{ conversation_id: string; message_id: string; status: string }>(
      `/assistant/conversations/${encodeURIComponent(id)}/messages`,
      { message },
    ),
};

export type TripSummary = {
  actual_duration_seconds: number;
  baseline_duration_seconds: number;
  time_saved_seconds: number;
  distance_meters: number;
  estimated_cost_inr: number;
  co2_saved_grams: number;
  insights: string[];
};

export type ActiveTrip = {
  id: string;
  trip_id?: string;
  user_id: string;
  status: 'active' | 'completed';
  primary_mode: string;
  origin: GeoPoint;
  destination?: GeoPoint;
  trip_summary?: TripSummary;
};

function normalizeTrip(raw: ActiveTrip & { trip_id?: string }): ActiveTrip {
  const resolvedId = raw.id || raw.trip_id || '';
  return {
    ...raw,
    id: resolvedId,
    trip_id: resolvedId,
  };
}

export type MeaningfulRouteChange = {
  meaningful_change: boolean;
  change_type: string;
  headline: string;
  reason: string;
  time_saved_seconds: number;
  confidence: number;
  suggested_mode?: string;
  suggested_label?: string;
  suppressed_minor_count: number;
};

export type LiveTripUpdate = {
  trip_id: string;
  status: string;
  remaining_distance_meters: number;
  eta_range_seconds: Record<string, number>;
  delay_seconds?: number;
  traffic_freshness: string;
  disruption_alert?: boolean;
  reroute_recommended?: boolean;
  route_change?: MeaningfulRouteChange;
};

export const moveDataApi = {
  profile: (userId: string) => api.get<MobilityProfile>(`/move/profile?user_id=${userId}`),
  updateProfile: (p: MobilityProfile) => api.patch<MobilityProfile>('/move/profile', p),
  insights: (userId: string) => api.get<CommuteInsights>(`/move/insights/commute?user_id=${userId}`),
  recommendDeparture: (body: {
    origin: GeoPoint;
    destination: GeoPoint;
    mode: string;
    objective: OptimizeFor;
    windowHours: number;
  }) => {
    const from = new Date();
    const to = new Date(from.getTime() + body.windowHours * 3600_000);
    return api.post<DepartureAdvice>('/move/departures/recommend', {
      origin: body.origin,
      destination: body.destination,
      mode: body.mode,
      objective: body.objective,
      allowed_departure_window: { from: from.toISOString(), to: to.toISOString() },
    });
  },
  startTrip: async (body: { user_id: string; primary_mode: string; origin: GeoPoint; destination?: GeoPoint }) =>
    normalizeTrip(await api.post<ActiveTrip>('/move/trips', body)),
  getTrip: async (tripId: string) =>
    normalizeTrip(await api.get<ActiveTrip>(`/move/trips/${encodeURIComponent(tripId)}`)),
  batchLocations: (tripId: string, samples: Array<GeoPoint | LocationSampleInput>) =>
    api.post<{ trip_id: string; accepted: number; spatial_indexed?: boolean }>(
      `/move/trips/${encodeURIComponent(tripId)}/locations:batch`,
      { samples },
    ),
  tripUpdates: (tripId: string) =>
    api.get<LiveTripUpdate>(`/move/trips/${encodeURIComponent(tripId)}/updates`),
  spatialRadar: (p: GeoPoint, radiusM = 2500) =>
    api.get<SpatialRadarSnapshot>(
      `/move/spatial/nearby?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`,
    ),
  completeTrip: async (tripId: string) =>
    normalizeTrip(await api.post<ActiveTrip>(`/move/trips/${encodeURIComponent(tripId)}/complete`)),
  submitFeedback: (body: {
    trip_id: string;
    user_id: string;
    rating: number;
    comment?: string;
    outcome_duration_s?: number;
  }) => api.post<{ feedback_id: string }>('/move/feedback', body),
};

// ---- 12-Pillar City Digital Twin, Cross-Domain Safety, Road Memory & Privacy ----

export type CrowdForecastPoint = {
  h3_index?: string;
  horizon_minutes: number;
  predicted_crowd_density: number;
  bottleneck_risk: string;
  recommended_action?: string;
};

export type AnimalConflictAssessment = {
  h3_index: string;
  conflict_risk_score: number;
  risk_level: string;
  twilight_factor: number;
  nearby_zones?: Array<{
    zone_id: string;
    species_group: string;
    corridor_type: string;
    risk_score: number;
  }>;
  mitigation_advice: string;
};

export type PedestrianSafetyAssessment = {
  h3_index: string;
  walk_safety_score: number;
  safety_grade: string;
  lighting_index: number;
  risk_factors: string[];
  recommendation: string;
};

export type RoadMemoryNode = {
  node_id: string;
  h3_index: string;
  latitude: number;
  longitude: number;
  condition_type: string;
  severity: number;
  observation_count: number;
  quorum_verified: boolean;
  confidence: number;
  last_updated?: string;
};

export type DigitalTwinState = {
  h3_index: string;
  system_health_index: number;
  cross_domain: {
    human_crowd_density: number;
    vehicle_congestion_index: number;
    animal_conflict_index: number;
    coupling_risk_score: number;
    dominant_interaction: string;
  };
  crowd_intelligence: {
    h3_index: string;
    current_density: number;
    forecasts: CrowdForecastPoint[];
  };
  animal_conflict: AnimalConflictAssessment;
  pedestrian_safety: PedestrianSafetyAssessment;
  road_memory_nodes: RoadMemoryNode[];
  model_version: string;
};

export type UrbanSimulationResult = {
  scenario_name: string;
  intervention_type: string;
  h3_index: string;
  baseline_metrics: Record<string, number>;
  projected_metrics: Record<string, number>;
  deltas: {
    speed_delta_kph: number;
    crowd_delta_pct: number;
    pedestrian_safety_delta: number;
    animal_conflict_delta: number;
    co2_reduction_pct: number;
  };
  net_impact_summary: string;
  model_version: string;
};

export type PrivacyStatus = {
  k_threshold: number;
  epsilon_budget: number;
  total_pings_processed: number;
  total_cells_published: number;
  total_cells_suppressed: number;
  model_version: string;
};

export type ProactiveBrief = {
  headline: string;
  system_health_index: number;
  alerts: Array<{
    domain: string;
    severity: string;
    message: string;
  }>;
  privacy_shield: {
    k_threshold: number;
    epsilon_budget: number;
    status: string;
  };
  recommended_actions: string[];
};

export const digitalTwinApi = {
  state: (p: GeoPoint, weather = 'clear') =>
    api.get<DigitalTwinState>(`/move/digital-twin/state?lat=${p.latitude}&lon=${p.longitude}&weather=${encodeURIComponent(weather)}`),
  simulate: (body: {
    latitude: number;
    longitude: number;
    intervention_type: 'car_free_zone' | 'signal_retime' | 'transit_boost' | 'speed_calming' | 'bus_lane';
    intensity_pct: number;
  }) => api.post<UrbanSimulationResult>('/move/digital-twin/simulate', body),
  predictCrowd: (p: GeoPoint) =>
    api.get<{ h3_index: string; current_density: number; forecasts: CrowdForecastPoint[] }>(
      `/move/crowd/predict?lat=${p.latitude}&lon=${p.longitude}`,
    ),
  animalConflict: (p: GeoPoint) =>
    api.get<AnimalConflictAssessment>(`/move/safety/animal-conflict?lat=${p.latitude}&lon=${p.longitude}`),
  reportAnimalSighting: (body: {
    latitude: number;
    longitude: number;
    species_group: string;
    corridor_type?: string;
    severity?: number;
  }) => api.post<{ zone: Record<string, unknown>; model_version: string }>('/move/safety/animal-sighting', body),
  pedestrianSafety: (p: GeoPoint, weather = 'clear') =>
    api.get<PedestrianSafetyAssessment>(
      `/move/safety/pedestrian?lat=${p.latitude}&lon=${p.longitude}&weather=${encodeURIComponent(weather)}`,
    ),
  observeRoadMemory: (body: {
    latitude: number;
    longitude: number;
    condition_type: string;
    severity?: number;
    confidence?: number;
  }) => api.post<{ node: RoadMemoryNode; model_version: string }>('/move/road-memory/observe', body),
  roadMemoryCorridor: (p: GeoPoint, radiusM = 5000) =>
    api.get<{ nodes: RoadMemoryNode[]; model_version: string }>(
      `/move/road-memory/corridor?lat=${p.latitude}&lon=${p.longitude}&radius_m=${radiusM}`,
    ),
  privacyStatus: () => api.get<PrivacyStatus>('/move/privacy/status'),
  sendPrivacyTelemetry: (samples: Array<{ latitude: number; longitude: number; ephemeral_token?: string; speed_kph?: number }>) =>
    api.post<{ published_count: number; suppressed_count: number; guarantees: string[] }>('/move/privacy/telemetry', {
      samples,
    }),
  proactiveBrief: (p: GeoPoint, weather = 'clear') =>
    api.get<ProactiveBrief>(
      `/move/assistant/proactive-brief?lat=${p.latitude}&lon=${p.longitude}&weather=${encodeURIComponent(weather)}`,
    ),
};
