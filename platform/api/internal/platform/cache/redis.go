// Package cache provides a zero-dependency RESP2 Redis client with an L1 in-memory fallback cache.
package cache

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type memItem struct {
	val string
	exp time.Time
}

type geoItem struct {
	lat float64
	lon float64
	exp time.Time
}

// GeoMember describes a geospatial index entry returned by GeoSearchRadius.
type GeoMember struct {
	Member    string  `json:"member"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	DistanceM float64 `json:"distance_m"`
}

// Client speaks Redis RESP2 over TCP and maintains a small L1 in-memory TTL + spatial fallback cache.
type Client struct {
	addr string
	mu   sync.RWMutex
	mem  map[string]memItem
	geo  map[string]map[string]geoItem
}

// New parses a REDIS_URL (e.g. "redis://redis:6379/0" or "redis:6379") and returns a cache Client.
func New(redisURL string) *Client {
	raw := strings.TrimSpace(redisURL)
	if raw == "" {
		return nil
	}
	addr := raw
	if strings.Contains(raw, "://") {
		if u, err := url.Parse(raw); err == nil && u.Host != "" {
			addr = u.Host
		}
	}
	if !strings.Contains(addr, ":") {
		addr += ":6379"
	}
	return &Client{
		addr: addr,
		mem:  make(map[string]memItem),
		geo:  make(map[string]map[string]geoItem),
	}
}

// NewInMemory creates an in-memory cache and L1 spatial client without a Redis server.
func NewInMemory() *Client {
	return &Client{
		mem: make(map[string]memItem),
		geo: make(map[string]map[string]geoItem),
	}
}

// Ping verifies Redis connectivity via the RESP2 PING command.
func (c *Client) Ping(ctx context.Context) error {
	if c == nil || c.addr == "" {
		return errors.New("redis not configured")
	}
	resp, err := c.do(ctx, "PING")
	if err != nil {
		return err
	}
	if resp != "PONG" {
		return fmt.Errorf("unexpected redis PING response: %q", resp)
	}
	return nil
}

// Get returns a cached string from L1 memory or L2 Redis.
func (c *Client) Get(ctx context.Context, key string) (string, bool) {
	if c == nil {
		return "", false
	}
	now := time.Now()
	c.mu.RLock()
	if it, ok := c.mem[key]; ok && now.Before(it.exp) {
		c.mu.RUnlock()
		return it.val, true
	}
	c.mu.RUnlock()

	if c.addr == "" {
		return "", false
	}
	val, err := c.do(ctx, "GET", key)
	if err != nil || val == "" {
		return "", false
	}
	c.setMem(key, val, 15*time.Second)
	return val, true
}

// Set stores a string in L1 memory and L2 Redis with the given TTL.
func (c *Client) Set(ctx context.Context, key, value string, ttl time.Duration) {
	if c == nil {
		return
	}
	sec := int(ttl.Seconds())
	if sec <= 0 {
		sec = 30
	}
	c.setMem(key, value, ttl)
	if c.addr != "" {
		_, _ = c.do(ctx, "SETEX", key, strconv.Itoa(sec), value)
	}
}

// Del removes a key from L1 memory and L2 Redis.
func (c *Client) Del(ctx context.Context, key string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.mem, key)
	delete(c.geo, key)
	c.mu.Unlock()
	if c.addr != "" {
		_, _ = c.do(ctx, "DEL", key)
	}
}

// GeoAdd indexes a member coordinate into Redis Spatial (GEOADD) and L1 fallback memory.
func (c *Client) GeoAdd(ctx context.Context, key, member string, lat, lon float64, ttl time.Duration) error {
	if c == nil || member == "" {
		return nil
	}
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	c.mu.Lock()
	if c.geo == nil {
		c.geo = make(map[string]map[string]geoItem)
	}
	bucket := c.geo[key]
	if bucket == nil {
		bucket = make(map[string]geoItem)
		c.geo[key] = bucket
	}
	if len(bucket) > 1024 {
		now := time.Now()
		for k, v := range bucket {
			if now.After(v.exp) {
				delete(bucket, k)
			}
		}
	}
	bucket[member] = geoItem{lat: lat, lon: lon, exp: time.Now().Add(ttl)}
	c.mu.Unlock()

	if c.addr == "" {
		return nil
	}
	latS := strconv.FormatFloat(lat, 'f', 6, 64)
	lonS := strconv.FormatFloat(lon, 'f', 6, 64)
	if _, err := c.doRaw(ctx, "GEOADD", key, lonS, latS, member); err != nil {
		return err
	}
	sec := int(ttl.Seconds())
	if sec > 0 {
		_, _ = c.doRaw(ctx, "EXPIRE", key, strconv.Itoa(sec))
	}
	return nil
}

// GeoRem removes a member from Redis Spatial (ZREM) and L1 spatial fallback memory.
func (c *Client) GeoRem(ctx context.Context, key, member string) error {
	if c == nil || member == "" {
		return nil
	}
	c.mu.Lock()
	if bucket := c.geo[key]; bucket != nil {
		delete(bucket, member)
	}
	c.mu.Unlock()
	if c.addr == "" {
		return nil
	}
	_, err := c.doRaw(ctx, "ZREM", key, member)
	return err
}

// GeoSearchRadius returns geospatial members ordered by distance ascending within radiusMeters.
// Uses Redis GEOSEARCH ... FROMLONLAT ... BYRADIUS ... m WITHCOORD WITHDIST ASC COUNT when connected,
// transparently falling back to the L1 in-memory spatial index if Redis is unconfigured or offline.
func (c *Client) GeoSearchRadius(ctx context.Context, key string, lat, lon, radiusMeters float64, count int) ([]GeoMember, error) {
	if c == nil || radiusMeters <= 0 {
		return nil, nil
	}
	if count <= 0 {
		count = 25
	}
	if c.addr != "" {
		raw, err := c.doRaw(
			ctx,
			"GEOSEARCH", key,
			"FROMLONLAT", strconv.FormatFloat(lon, 'f', 6, 64), strconv.FormatFloat(lat, 'f', 6, 64),
			"BYRADIUS", strconv.FormatFloat(radiusMeters, 'f', 1, 64), "m",
			"ASC", "COUNT", strconv.Itoa(count),
			"WITHCOORD", "WITHDIST",
		)
		if err == nil {
			if members := parseGeoSearchReply(raw); members != nil {
				return members, nil
			}
		}
	}
	return c.geoSearchMem(key, lat, lon, radiusMeters, count), nil
}

func (c *Client) geoSearchMem(key string, lat, lon, radiusMeters float64, count int) []GeoMember {
	now := time.Now()
	c.mu.Lock()
	bucket := c.geo[key]
	if len(bucket) == 0 {
		c.mu.Unlock()
		return nil
	}
	out := make([]GeoMember, 0, len(bucket))
	for member, it := range bucket {
		if now.After(it.exp) {
			delete(bucket, member)
			continue
		}
		d := haversineGeoM(lat, lon, it.lat, it.lon)
		if d <= radiusMeters {
			out = append(out, GeoMember{
				Member:    member,
				Latitude:  it.lat,
				Longitude: it.lon,
				DistanceM: math.Round(d*10) / 10,
			})
		}
	}
	c.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].DistanceM < out[j].DistanceM })
	if len(out) > count {
		out = out[:count]
	}
	return out
}

func parseGeoSearchReply(raw any) []GeoMember {
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]GeoMember, 0, len(arr))
	for _, entry := range arr {
		row, ok := entry.([]any)
		if !ok || len(row) < 3 {
			continue
		}
		member, _ := row[0].(string)
		distStr, _ := row[1].(string)
		coordArr, _ := row[2].([]any)
		if member == "" || len(coordArr) < 2 {
			continue
		}
		lonStr, _ := coordArr[0].(string)
		latStr, _ := coordArr[1].(string)
		distM, _ := strconv.ParseFloat(distStr, 64)
		lon, errLon := strconv.ParseFloat(lonStr, 64)
		lat, errLat := strconv.ParseFloat(latStr, 64)
		if errLon != nil || errLat != nil {
			continue
		}
		out = append(out, GeoMember{
			Member:    member,
			Latitude:  lat,
			Longitude: lon,
			DistanceM: distM,
		})
	}
	return out
}

func haversineGeoM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000.0
	p1 := lat1 * math.Pi / 180
	p2 := lat2 * math.Pi / 180
	dp := (lat2 - lat1) * math.Pi / 180
	dl := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dp/2)*math.Sin(dp/2) + math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Asin(math.Min(1, math.Sqrt(a)))
}

func (c *Client) setMem(key, value string, ttl time.Duration) {
	c.mu.Lock()
	if len(c.mem) > 512 {
		c.mem = make(map[string]memItem)
	}
	c.mem[key] = memItem{val: value, exp: time.Now().Add(ttl)}
	c.mu.Unlock()
}

func (c *Client) do(ctx context.Context, args ...string) (string, error) {
	v, err := c.doRaw(ctx, args...)
	if err != nil {
		return "", err
	}
	switch t := v.(type) {
	case string:
		return t, nil
	case int64:
		return strconv.FormatInt(t, 10), nil
	default:
		return "", nil
	}
}

func (c *Client) doRaw(ctx context.Context, args ...string) (any, error) {
	d := net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(600 * time.Millisecond))

	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, a := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(a), a)
	}
	if _, err := io.WriteString(conn, b.String()); err != nil {
		return nil, err
	}

	return readRESP(bufio.NewReader(conn))
}

func readRESP(r *bufio.Reader) (any, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if len(line) == 0 {
		return nil, errors.New("empty redis reply")
	}
	switch line[0] {
	case '+':
		return line[1:], nil
	case '-':
		return nil, errors.New(line[1:])
	case ':':
		n, err := strconv.ParseInt(line[1:], 10, 64)
		if err != nil {
			return line[1:], nil
		}
		return n, nil
	case '$':
		n, err := strconv.Atoi(line[1:])
		if err != nil || n < 0 {
			return "", nil
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		return string(buf[:n]), nil
	case '*':
		n, err := strconv.Atoi(line[1:])
		if err != nil || n < 0 {
			return []any(nil), nil
		}
		items := make([]any, 0, n)
		for i := 0; i < n; i++ {
			v, err := readRESP(r)
			if err != nil {
				return nil, err
			}
			items = append(items, v)
		}
		return items, nil
	default:
		return line[1:], nil
	}
}
