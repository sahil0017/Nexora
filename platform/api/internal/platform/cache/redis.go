// Package cache provides a zero-dependency RESP2 Redis client with an L1 in-memory fallback cache.
package cache

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type memItem struct {
	val string
	exp time.Time
}

// Client speaks Redis RESP2 over TCP and maintains a small L1 in-memory TTL cache.
type Client struct {
	addr string
	mu   sync.RWMutex
	mem  map[string]memItem
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

func (c *Client) setMem(key, value string, ttl time.Duration) {
	c.mu.Lock()
	if len(c.mem) > 512 {
		c.mem = make(map[string]memItem)
	}
	c.mem[key] = memItem{val: value, exp: time.Now().Add(ttl)}
	c.mu.Unlock()
}

func (c *Client) do(ctx context.Context, args ...string) (string, error) {
	d := net.Dialer{Timeout: 500 * time.Millisecond}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(600 * time.Millisecond))

	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, a := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(a), a)
	}
	if _, err := io.WriteString(conn, b.String()); err != nil {
		return "", err
	}

	r := bufio.NewReader(conn)
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if len(line) == 0 {
		return "", errors.New("empty redis reply")
	}
	switch line[0] {
	case '+':
		return line[1:], nil
	case '-':
		return "", errors.New(line[1:])
	case '$':
		n, err := strconv.Atoi(line[1:])
		if err != nil || n < 0 {
			return "", nil
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return "", err
		}
		return string(buf[:n]), nil
	default:
		return line[1:], nil
	}
}
