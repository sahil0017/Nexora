package cache

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
	"time"
)

func TestL1SpatialGeoAddSearchAndRem(t *testing.T) {
	c := &Client{mem: make(map[string]memItem), geo: make(map[string]map[string]geoItem)}
	ctx := context.Background()

	if err := c.GeoAdd(ctx, "hazards:active", "hz-far", 12.9716, 77.5946, 5*time.Minute); err != nil {
		t.Fatalf("GeoAdd far: %v", err)
	}
	if err := c.GeoAdd(ctx, "hazards:active", "hz-near", 12.9730, 77.5950, 5*time.Minute); err != nil {
		t.Fatalf("GeoAdd near: %v", err)
	}
	if err := c.GeoAdd(ctx, "hazards:active", "hz-out-of-range", 13.2000, 77.9000, 5*time.Minute); err != nil {
		t.Fatalf("GeoAdd out of range: %v", err)
	}

	got, err := c.GeoSearchRadius(ctx, "hazards:active", 12.9729, 77.5949, 1000, 10)
	if err != nil {
		t.Fatalf("GeoSearchRadius: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 members within 1km, got %d (%+v)", len(got), got)
	}
	if got[0].Member != "hz-near" || got[1].Member != "hz-far" {
		t.Fatalf("expected distance-ascending order [hz-near, hz-far], got %+v", got)
	}

	if err := c.GeoRem(ctx, "hazards:active", "hz-near"); err != nil {
		t.Fatalf("GeoRem: %v", err)
	}
	gotAfterRem, _ := c.GeoSearchRadius(ctx, "hazards:active", 12.9729, 77.5949, 1000, 10)
	if len(gotAfterRem) != 1 || gotAfterRem[0].Member != "hz-far" {
		t.Fatalf("expected only hz-far after GeoRem, got %+v", gotAfterRem)
	}
}

func TestRESP2GeoSearchWireDecodingAndRoundTrip(t *testing.T) {
	reply := strings.Join([]string{
		"*1\r\n",
		"*3\r\n",
		"$7\r\ntrip-42\r\n",
		"$6\r\n125.40\r\n",
		"*2\r\n",
		"$9\r\n77.595000\r\n",
		"$9\r\n12.973000\r\n",
	}, "")

	// Validate RESP2 reader and GEOSEARCH decoder directly over net.Pipe (zero socket bind required).
	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()

	go func() {
		_, _ = serverConn.Write([]byte(reply))
	}()

	raw, err := readRESP(bufio.NewReader(clientConn))
	if err != nil {
		t.Fatalf("readRESP: %v", err)
	}
	members := parseGeoSearchReply(raw)
	if len(members) != 1 || members[0].Member != "trip-42" || members[0].DistanceM != 125.4 ||
		members[0].Latitude != 12.973 || members[0].Longitude != 77.595 {
		t.Fatalf("unexpected RESP2 GEOSEARCH decode: %+v", members)
	}
}
