// Package privacy persists user data-access permissions and consent audit logs in PostgreSQL.
package privacy

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PermissionItem struct {
	PermissionKey string `json:"permission_key"`
	Domain        string `json:"domain"`
	Granted       bool   `json:"granted"`
	OsStatus      string `json:"os_status"`
	Source        string `json:"source"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}

type AuditItem struct {
	ID            int64  `json:"id"`
	UserID        string `json:"user_id"`
	PermissionKey string `json:"permission_key"`
	Granted       bool   `json:"granted"`
	Source        string `json:"source"`
	CreatedAt     string `json:"created_at"`
}

type Handler struct {
	pg      *pgxpool.Pool
	mu      sync.RWMutex
	memPerm map[string]map[string]PermissionItem
	memAud  []AuditItem
}

func NewHandler(pg *pgxpool.Pool) *Handler {
	return &Handler{
		pg:      pg,
		memPerm: make(map[string]map[string]PermissionItem),
	}
}

func Mount(r chi.Router, h *Handler) {
	r.Route("/privacy", func(pr chi.Router) {
		pr.Get("/permissions", h.GetPermissions)
		pr.Put("/permissions", h.PutPermissions)
		pr.Post("/permissions", h.PutPermissions)
		pr.Get("/audit", h.ListAudit)
	})
}

func resolveUserID(r *http.Request) string {
	if uid := strings.TrimSpace(r.URL.Query().Get("user_id")); uid != "" {
		return uid
	}
	if uid := strings.TrimSpace(r.Header.Get("X-User-ID")); uid != "" {
		return uid
	}
	return "default-user"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (h *Handler) GetPermissions(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r)
	if h.pg == nil {
		h.mu.RLock()
		defer h.mu.RUnlock()
		items := make([]PermissionItem, 0)
		var lastUpdated string
		for _, p := range h.memPerm[userID] {
			items = append(items, p)
			if p.UpdatedAt > lastUpdated {
				lastUpdated = p.UpdatedAt
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"user_id":            userID,
			"consent_configured": len(items) > 0,
			"last_updated_at":    lastUpdated,
			"permissions":        items,
		})
		return
	}

	rows, err := h.pg.Query(r.Context(), `
		SELECT permission_key, domain, granted, os_status, source, updated_at
		FROM user_privacy_permissions
		WHERE user_id = $1
		ORDER BY permission_key ASC
	`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	items := make([]PermissionItem, 0)
	var lastUpdated string
	for rows.Next() {
		var it PermissionItem
		var ts time.Time
		if err := rows.Scan(&it.PermissionKey, &it.Domain, &it.Granted, &it.OsStatus, &it.Source, &ts); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		it.UpdatedAt = ts.UTC().Format(time.RFC3339)
		if it.UpdatedAt > lastUpdated {
			lastUpdated = it.UpdatedAt
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":            userID,
		"consent_configured": len(items) > 0,
		"last_updated_at":    lastUpdated,
		"permissions":        items,
	})
}

func (h *Handler) PutPermissions(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID      string           `json:"user_id"`
		Source      string           `json:"source"`
		Permissions []PermissionItem `json:"permissions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}
	userID := strings.TrimSpace(body.UserID)
	if userID == "" {
		userID = resolveUserID(r)
	}
	source := strings.TrimSpace(body.Source)
	if source == "" {
		source = "mobile_app"
	}
	if len(body.Permissions) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "permissions array is required"})
		return
	}

	now := time.Now().UTC()
	nowStr := now.Format(time.RFC3339)

	if h.pg == nil {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.memPerm[userID] == nil {
			h.memPerm[userID] = make(map[string]PermissionItem)
		}
		for _, p := range body.Permissions {
			if p.PermissionKey == "" {
				continue
			}
			dom := p.Domain
			if dom == "" {
				dom = "General"
			}
			osSt := p.OsStatus
			if osSt == "" {
				osSt = "unknown"
			}
			src := p.Source
			if src == "" {
				src = source
			}
			h.memPerm[userID][p.PermissionKey] = PermissionItem{
				PermissionKey: p.PermissionKey,
				Domain:        dom,
				Granted:       p.Granted,
				OsStatus:      osSt,
				Source:        src,
				UpdatedAt:     nowStr,
			}
			h.memAud = append(h.memAud, AuditItem{
				ID:            int64(len(h.memAud) + 1),
				UserID:        userID,
				PermissionKey: p.PermissionKey,
				Granted:       p.Granted,
				Source:        src,
				CreatedAt:     nowStr,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":          "saved",
			"user_id":         userID,
			"updated_count":   len(body.Permissions),
			"last_updated_at": nowStr,
		})
		return
	}

	ctx := context.Background()
	tx, err := h.pg.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	updated := 0
	for _, p := range body.Permissions {
		if p.PermissionKey == "" {
			continue
		}
		dom := p.Domain
		if dom == "" {
			dom = "General"
		}
		osSt := p.OsStatus
		if osSt == "" {
			osSt = "unknown"
		}
		src := p.Source
		if src == "" {
			src = source
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_privacy_permissions (user_id, permission_key, domain, granted, os_status, source, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (user_id, permission_key) DO UPDATE SET
				domain = EXCLUDED.domain,
				granted = EXCLUDED.granted,
				os_status = EXCLUDED.os_status,
				source = EXCLUDED.source,
				updated_at = EXCLUDED.updated_at
		`, userID, p.PermissionKey, dom, p.Granted, osSt, src, now); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO user_privacy_consent_audit (user_id, permission_key, granted, source, created_at)
			VALUES ($1, $2, $3, $4, $5)
		`, userID, p.PermissionKey, p.Granted, src, now); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		updated++
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":          "saved",
		"user_id":         userID,
		"updated_count":   updated,
		"last_updated_at": nowStr,
	})
}

func (h *Handler) ListAudit(w http.ResponseWriter, r *http.Request) {
	userID := resolveUserID(r)
	if h.pg == nil {
		h.mu.RLock()
		defer h.mu.RUnlock()
		out := make([]AuditItem, 0)
		for i := len(h.memAud) - 1; i >= 0; i-- {
			if h.memAud[i].UserID == userID {
				out = append(out, h.memAud[i])
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"user_id": userID, "audit": out})
		return
	}

	rows, err := h.pg.Query(r.Context(), `
		SELECT id, user_id, permission_key, granted, source, created_at
		FROM user_privacy_consent_audit
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	out := make([]AuditItem, 0)
	for rows.Next() {
		var it AuditItem
		var ts time.Time
		if err := rows.Scan(&it.ID, &it.UserID, &it.PermissionKey, &it.Granted, &it.Source, &ts); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		it.CreatedAt = ts.UTC().Format(time.RFC3339)
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_id": userID, "audit": out})
}
