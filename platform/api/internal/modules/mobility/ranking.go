package mobility

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// RoutePreferencesInput controls multi-criteria route ranking and constraints.
type RoutePreferencesInput struct {
	OptimizeFor       string
	AvoidTolls        bool
	AvoidHazards      bool
	MaxWalkingMinutes int
	Weights           map[string]float64
	PreferredMode     string
}

// RouteLeg represents one segment of a multimodal journey.
type RouteLeg struct {
	Mode            string  `json:"mode"`
	Label           string  `json:"label,omitempty"`
	DistanceMeters  float64 `json:"distance_meters"`
	DurationSeconds int     `json:"duration_seconds"`
	WaitSeconds     int     `json:"wait_seconds,omitempty"`
}

// ConfidenceInterval provides calibrated ETA bounds and certainty labels.
type ConfidenceInterval struct {
	LowSeconds     int    `json:"low_seconds"`
	MedianSeconds  int    `json:"median_seconds"`
	HighSeconds    int    `json:"high_seconds"`
	SpreadMinutes  int    `json:"spread_minutes"`
	ConfidencePct  int    `json:"confidence_pct"`
	CertaintyLabel string `json:"certainty_label"`
}

// ReliabilityBreakdown explains why a route earned its reliability score.
type ReliabilityBreakdown struct {
	Score   float64  `json:"score"`
	Tier    string   `json:"tier"`
	Factors []string `json:"factors"`
}

// ObjectiveScores exposes normalized 0-100 scores across multi-objective criteria.
type ObjectiveScores struct {
	TimeScore        int `json:"time_score"`
	ReliabilityScore int `json:"reliability_score"`
	CostScore        int `json:"cost_score"`
	WalkScore        int `json:"walk_score"`
	OverallScore     int `json:"overall_score"`
}

// ScoredRoute holds a ranked journey alternative with explanations and shadow ML metadata.
type ScoredRoute struct {
	RouteID              string
	Provider             string
	Mode                 string
	Modes                []string
	Legs                 []RouteLeg
	DistanceMeters       float64
	P50Seconds           int
	P80Seconds           int
	P90Seconds           int
	ShadowP50Seconds     int
	ShadowP90Seconds     int
	ShadowModelVer       string
	ModelVersion         string
	ReliabilityScore     float64
	ReliabilityBreakdown ReliabilityBreakdown
	ConfidenceInterval   ConfidenceInterval
	ObjectiveScores      ObjectiveScores
	EstimatedCostINR     float64
	CO2Grams             int
	WalkMinutes          float64
	Transfers            int
	HazardsCount          int
	HazardPenaltySeconds  int
	EventImpactSummary    string
	PedestrianSafetyScore float64
	AnimalConflictRisk    float64
	SafetyAdvisories      []string
	Score                 float64
	Explanation           []string
	Geometry              string
}

func defaultWeights(optimizeFor string, custom map[string]float64) map[string]float64 {
	if len(custom) > 0 {
		sum := 0.0
		for _, k := range []string{"time", "reliability", "cost", "walk"} {
			if custom[k] > 0 {
				sum += custom[k]
			}
		}
		if sum > 0 {
			return map[string]float64{
				"time":        math.Max(0, custom["time"]) / sum,
				"reliability": math.Max(0, custom["reliability"]) / sum,
				"cost":        math.Max(0, custom["cost"]) / sum,
				"walk":        math.Max(0, custom["walk"]) / sum,
			}
		}
	}
	switch strings.ToUpper(optimizeFor) {
	case "FASTEST":
		return map[string]float64{"time": 0.65, "reliability": 0.20, "cost": 0.10, "walk": 0.05}
	case "CHEAPEST":
		return map[string]float64{"time": 0.20, "reliability": 0.15, "cost": 0.55, "walk": 0.10}
	case "LEAST_WALKING":
		return map[string]float64{"time": 0.25, "reliability": 0.20, "cost": 0.10, "walk": 0.45}
	case "BALANCED":
		return map[string]float64{"time": 0.30, "reliability": 0.30, "cost": 0.25, "walk": 0.15}
	default: // RELIABILITY
		return map[string]float64{"time": 0.30, "reliability": 0.45, "cost": 0.15, "walk": 0.10}
	}
}

// buildMultimodalLegs expands transit & park-and-ride modes into leg-by-leg sequences.
func buildMultimodalLegs(mode string, totalDistM float64, totalDurS int) ([]RouteLeg, []string, float64, int) {
	m := strings.ToLower(mode)
	if m == "multimodal" || m == "two_wheeler_metro" {
		firstMileDist := math.Min(2200, math.Max(700, totalDistM*0.22))
		egressDist := math.Min(450, totalDistM*0.09)
		railDist := math.Max(600, totalDistM-firstMileDist-egressDist)

		firstDur := int(math.Round(firstMileDist / 7.5))
		waitSec := 180
		railDur := int(math.Max(180, math.Round(railDist/9.8)))
		egressDur := int(math.Round(egressDist / 1.3))
		walkMin := float64(egressDur) / 60.0

		legs := []RouteLeg{
			{Mode: "two_wheeler", Label: "First-mile ride to Metro hub", DistanceMeters: math.Round(firstMileDist), DurationSeconds: firstDur},
			{Mode: "metro", Label: "Express Metro corridor", DistanceMeters: math.Round(railDist), DurationSeconds: railDur + waitSec, WaitSeconds: waitSec},
			{Mode: "walk", Label: "Last-mile walk to destination", DistanceMeters: math.Round(egressDist), DurationSeconds: egressDur},
		}
		return legs, []string{"two_wheeler", "metro", "walk"}, math.Round(walkMin*10) / 10, 1
	}

	if m != "metro" && m != "bus" {
		walkMin := 0.0
		if m == "walk" {
			walkMin = float64(totalDurS) / 60.0
		}
		return []RouteLeg{{Mode: m, Label: "Direct corridor", DistanceMeters: totalDistM, DurationSeconds: totalDurS}}, []string{m}, walkMin, 0
	}

	// First/last-mile walk legs (capped reasonably relative to trip distance).
	accessDist := math.Min(600, totalDistM*0.12)
	egressDist := math.Min(500, totalDistM*0.10)
	lineDist := math.Max(300, totalDistM-accessDist-egressDist)

	accessDur := int(math.Round(accessDist / 1.3))
	egressDur := int(math.Round(egressDist / 1.3))
	waitAndTransfer := 240 // 4 min average wait/transfer overhead
	if m == "bus" {
		waitAndTransfer = 360
	}
	lineDur := int(math.Max(120, float64(totalDurS)-float64(accessDur+egressDur)))
	walkMin := float64(accessDur+egressDur) / 60.0

	legs := []RouteLeg{
		{Mode: "walk", Label: "Walk to station", DistanceMeters: math.Round(accessDist), DurationSeconds: accessDur},
		{Mode: m, Label: strings.ToUpper(m) + " line haul", DistanceMeters: math.Round(lineDist), DurationSeconds: lineDur + waitAndTransfer, WaitSeconds: waitAndTransfer},
		{Mode: "walk", Label: "Walk to destination", DistanceMeters: math.Round(egressDist), DurationSeconds: egressDur},
	}
	return legs, []string{"walk", m, "walk"}, math.Round(walkMin*10) / 10, 1
}

// congestionMultiplier estimates peak-hour road slowdown in Indian metro traffic (IST).
func congestionMultiplier(at time.Time, mode string) float64 {
	m := strings.ToLower(mode)
	if m == "metro" || m == "walk" || m == "bicycle" {
		return 1.0 // grade-separated or non-motorized
	}
	loc := time.FixedZone("IST", 5*3600+30*60)
	local := at.In(loc)
	hour := float64(local.Hour()) + float64(local.Minute())/60.0

	// Morning peak (08:30-10:45) and evening peak (17:30-20:45)
	mult := 1.0
	if hour >= 8.5 && hour <= 10.75 {
		mult = 1.32
	} else if hour >= 17.5 && hour <= 20.75 {
		mult = 1.38
	} else if hour >= 11.0 && hour <= 17.0 {
		mult = 1.12
	}
	if m == "two_wheeler" && mult > 1.0 {
		// Two-wheelers filter through congestion slightly faster than cars/buses.
		mult = 1.0 + (mult-1.0)*0.65
	}
	return mult
}

func buildConfidenceInterval(p50, p80, p90 int, reliability float64) ConfidenceInterval {
	if p80 <= p50 {
		p80 = int(math.Round(float64(p50) * 1.14))
	}
	if p90 <= p80 {
		p90 = int(math.Round(float64(p50) * 1.26))
	}
	spreadRatio := float64(p90-p50) / math.Max(1, float64(p50))
	lowS := int(math.Max(45, math.Round(float64(p50)*(1.0-math.Min(0.18, spreadRatio*0.35)))))
	spreadMin := int(math.Max(1, math.Round(float64(p90-lowS)/60.0)))
	label := "Moderate"
	if spreadRatio <= 0.16 {
		label = "Tight"
	} else if spreadRatio >= 0.30 {
		label = "Wide"
	}
	return ConfidenceInterval{
		LowSeconds:     lowS,
		MedianSeconds:  p50,
		HighSeconds:    p90,
		SpreadMinutes:  spreadMin,
		ConfidencePct:  int(math.Round(reliability * 100)),
		CertaintyLabel: label,
	}
}

func buildReliabilityBreakdown(mode string, at time.Time, baseRel float64, hazardsCount int, eventSummary string) (float64, ReliabilityBreakdown) {
	m := strings.ToLower(mode)
	rel := baseRel
	factors := make([]string, 0, 4)

	if m == "metro" || m == "multimodal" || m == "two_wheeler_metro" {
		factors = append(factors, "Grade-separated rail insulates corridor from road bottlenecks")
	}
	mult := congestionMultiplier(at, m)
	if mult >= 1.25 && m != "metro" {
		rel -= 0.08
		factors = append(factors, "Peak-hour arterial variance increases delay spread")
	}
	if hazardsCount > 0 && m != "metro" && m != "walk" {
		penalty := math.Min(0.14, float64(hazardsCount)*0.04)
		rel -= penalty
		factors = append(factors, fmt.Sprintf("%d active road hazard(s) nearby", hazardsCount))
	}
	if eventSummary != "" && m != "metro" && m != "walk" {
		rel -= 0.06
		factors = append(factors, eventSummary)
	}
	if len(factors) == 0 {
		factors = append(factors, "Steady corridor travel-time predictability")
	}

	rel = math.Round(math.Max(0.45, math.Min(0.98, rel))*100) / 100
	tier := "medium"
	if rel >= 0.84 {
		tier = "high"
	} else if rel < 0.65 {
		tier = "low"
	}
	return rel, ReliabilityBreakdown{
		Score:   rel,
		Tier:    tier,
		Factors: factors,
	}
}

func estimateCO2Grams(mode string, distanceM float64) int {
	km := distanceM / 1000.0
	switch strings.ToLower(mode) {
	case "walk", "bicycle":
		return 0
	case "metro":
		return int(math.Round(km * 28))
	case "multimodal", "two_wheeler_metro":
		return int(math.Round(km * 35))
	case "bus":
		return int(math.Round(km * 55))
	case "two_wheeler":
		return int(math.Round(km * 48))
	default: // car
		return int(math.Round(km * 145))
	}
}

// rankScoredRoutes applies explicit constraints (max walking) and normalized multi-criteria scoring.
func rankScoredRoutes(candidates []ScoredRoute, prefs RoutePreferencesInput) []ScoredRoute {
	if len(candidates) == 0 {
		return candidates
	}
	weights := defaultWeights(prefs.OptimizeFor, prefs.Weights)

	// Filter by explicit max_walking_minutes constraint when set (keep at least 1 fallback).
	if prefs.MaxWalkingMinutes > 0 {
		filtered := make([]ScoredRoute, 0, len(candidates))
		for _, c := range candidates {
			if c.WalkMinutes <= float64(prefs.MaxWalkingMinutes) {
				filtered = append(filtered, c)
			}
		}
		if len(filtered) > 0 {
			candidates = filtered
		}
	}

	maxDur := 1.0
	maxCost := 1.0
	maxWalk := 1.0
	for _, c := range candidates {
		if float64(c.P50Seconds) > maxDur {
			maxDur = float64(c.P50Seconds)
		}
		if c.EstimatedCostINR > maxCost {
			maxCost = c.EstimatedCostINR
		}
		if c.WalkMinutes > maxWalk {
			maxWalk = c.WalkMinutes
		}
	}

	for i := range candidates {
		c := &candidates[i]
		normDur := float64(c.P50Seconds) / maxDur
		normUnrel := 1.0 - c.ReliabilityScore
		normCost := c.EstimatedCostINR / maxCost
		normWalk := c.WalkMinutes / maxWalk

		// Lower penalty = better rank; convert to 0..1 utility score.
		penalty := weights["time"]*normDur +
			weights["reliability"]*normUnrel +
			weights["cost"]*normCost +
			weights["walk"]*normWalk
		if prefs.AvoidTolls && c.Mode == "car" {
			penalty += 0.05
		}
		if prefs.AvoidHazards && c.HazardsCount > 0 && c.Mode != "metro" {
			penalty += math.Min(0.12, float64(c.HazardsCount)*0.03)
		}
		if prefs.PreferredMode != "" && strings.EqualFold(c.Mode, prefs.PreferredMode) {
			penalty = math.Max(0, penalty-0.04)
		}
		if c.PedestrianSafetyScore > 0 && c.PedestrianSafetyScore < 65 && (c.Mode == "walk" || c.Mode == "bicycle" || c.Mode == "multimodal") {
			penalty += 0.04
		}
		if c.AnimalConflictRisk >= 0.45 && (c.Mode == "two_wheeler" || c.Mode == "car") {
			penalty += 0.03
		}
		c.Score = math.Round((1.0-math.Min(1.0, penalty))*1000) / 1000
		c.ObjectiveScores = ObjectiveScores{
			TimeScore:        int(math.Round((1.0 - normDur*0.85) * 100)),
			ReliabilityScore: int(math.Round(c.ReliabilityScore * 100)),
			CostScore:        int(math.Round((1.0 - normCost*0.90) * 100)),
			WalkScore:        int(math.Round((1.0 - normWalk*0.85) * 100)),
			OverallScore:     int(math.Round(c.Score * 100)),
		}
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	// Populate human-readable ranking explanations.
	for i := range candidates {
		c := &candidates[i]
		expl := make([]string, 0, 4)
		if i == 0 {
			expl = append(expl, fmt.Sprintf("Top match for %s preference", strings.ToUpper(orDefault(prefs.OptimizeFor, "RELIABILITY"))))
		}
		if c.ReliabilityScore >= 0.85 {
			expl = append(expl, fmt.Sprintf("High arrival reliability (%.0f%%)", c.ReliabilityScore*100))
		}
		if c.EstimatedCostINR == 0 {
			expl = append(expl, "Zero direct fare/fuel cost")
		} else if c.EstimatedCostINR <= 40 {
			expl = append(expl, fmt.Sprintf("Low estimated cost (₹%.0f)", c.EstimatedCostINR))
		}
		if c.HazardsCount > 0 && (c.Mode == "metro" || c.Mode == "multimodal") {
			expl = append(expl, fmt.Sprintf("Bypasses %d active road hazard(s)", c.HazardsCount))
		} else if c.HazardPenaltySeconds > 0 {
			expl = append(expl, fmt.Sprintf("Includes +%d min hazard buffer", int(math.Ceil(float64(c.HazardPenaltySeconds)/60.0))))
		}
		if c.EventImpactSummary != "" {
			expl = append(expl, c.EventImpactSummary)
		}
		if c.Transfers > 0 {
			expl = append(expl, fmt.Sprintf("Includes %.0f min total walking", c.WalkMinutes))
		}
		for _, adv := range c.SafetyAdvisories {
			if len(expl) < 5 {
				expl = append(expl, adv)
			}
		}
		if len(expl) == 0 {
			expl = append(expl, "Balanced travel time and predictability")
		}
		c.Explanation = expl
	}
	return candidates
}

type departureSlot struct {
	Departure         time.Time
	Arrival           time.Time
	DurationSeconds   int
	P90Seconds        int
	ArrivalConfidence float64
	CongestionLevel   string
	Score             float64
	IsNow             bool
	IsOptimal         bool
}

// evaluateDepartureWindow samples 10-minute slots across [from, to] to pick the optimal departure time.
func evaluateDepartureWindow(from, to time.Time, arrivalBy *time.Time, baseDurS int, mode, objective string) (departureSlot, []departureSlot, []departureSlot, int, string) {
	step := 10 * time.Minute
	if to.Sub(from) > 4*time.Hour {
		step = 15 * time.Minute
	}

	slots := make([]departureSlot, 0)
	for idx, cur := 0, from; !cur.After(to); idx, cur = idx+1, cur.Add(step) {
		mult := congestionMultiplier(cur, mode)
		durS := int(math.Round(float64(baseDurS) * mult))
		p90S := int(math.Round(float64(durS) * (1.12 + (mult-1.0)*0.45)))
		arr := cur.Add(time.Duration(durS) * time.Second)

		// Lower congestion => tighter variance => higher arrival confidence.
		conf := math.Max(0.55, math.Min(0.95, 0.96-(mult-1.0)*0.65))
		if arrivalBy != nil && arr.After(*arrivalBy) {
			// Penalize slots likely to miss deadline.
			conf *= 0.5
		}

		cong := "low"
		if mult >= 1.30 {
			cong = "heavy"
		} else if mult >= 1.15 {
			cong = "moderate"
		}

		var score float64
		switch strings.ToUpper(objective) {
		case "MINIMIZE_DURATION":
			score = 1.0/float64(durS) + conf*0.0001
		case "ARRIVE_ON_TIME":
			score = conf
			if arrivalBy != nil && !arr.After(*arrivalBy) {
				score += 0.5
			}
		default: // MINIMIZE_DELAY_RISK
			score = conf*2.0 - (float64(durS)/float64(baseDurS))*0.5
		}

		slots = append(slots, departureSlot{
			Departure:         cur,
			Arrival:           arr,
			DurationSeconds:   durS,
			P90Seconds:        p90S,
			ArrivalConfidence: math.Round(conf*100) / 100,
			CongestionLevel:   cong,
			Score:             score,
			IsNow:             idx == 0,
		})
	}

	chrono := make([]departureSlot, len(slots))
	copy(chrono, slots)

	sort.SliceStable(slots, func(i, j int) bool {
		return slots[i].Score > slots[j].Score
	})

	best := slots[0]
	best.IsOptimal = true

	// Mark optimal slot on chronological timeline series and compute time saved vs leaving now.
	nowDur := chrono[0].DurationSeconds
	for i := range chrono {
		if chrono[i].Departure.Equal(best.Departure) {
			chrono[i].IsOptimal = true
		}
	}
	if len(chrono) > 8 {
		// Downsample evenly to keep mobile chart crisp while preserving optimal + now slots.
		sampled := make([]departureSlot, 0, 8)
		stride := float64(len(chrono)-1) / 7.0
		seen := map[int]bool{}
		for k := 0; k < 8; k++ {
			idx := int(math.Round(float64(k) * stride))
			if idx >= len(chrono) {
				idx = len(chrono) - 1
			}
			if !seen[idx] {
				seen[idx] = true
				sampled = append(sampled, chrono[idx])
			}
		}
		chrono = sampled
	}

	timeSavedMin := int(math.Max(0, math.Round(float64(nowDur-best.DurationSeconds)/60.0)))

	var alts []departureSlot
	for i := 1; i < len(slots) && len(alts) < 2; i++ {
		alts = append(alts, slots[i])
	}

	reason := "Optimal balance of low expected congestion and on-time confidence"
	if arrivalBy != nil && best.Arrival.After(*arrivalBy) {
		reason = "Earliest feasible departure; all slots in window risk missing arrival_by deadline"
	} else if timeSavedMin >= 3 {
		reason = fmt.Sprintf("Waiting until %s avoids peak build-up and saves ~%d min", best.Departure.In(time.FixedZone("IST", 5*3600+30*60)).Format("15:04"), timeSavedMin)
	} else if best.ArrivalConfidence >= 0.90 {
		reason = "Off-peak window with minimal expected traffic delay"
	}
	return best, alts, chrono, timeSavedMin, reason
}

func orDefault(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}
