// Package identity implements authentication and user endpoints.
// Contract shapes follow contracts/openapi/movesmart→nexora v1 spec.
package identity

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestUserID is the single seeded development user (Sahil Kanungo) used until
// Google / Apple (iOS) OIDC authentication is wired on mobile.
const TestUserID = "00000000-0000-0000-0000-000000000000"

type Handler struct {
	pg *pgxpool.Pool
}

func NewHandler(pg *pgxpool.Pool) *Handler {
	return &Handler{pg: pg}
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	UserID      string `json:"user_id"`
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	HandleRegister(w, r)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	HandleLogin(w, r)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	email := "sahil.kanungo@nexora.ai"
	displayName := "Sahil Kanungo"
	locale := "en-IN"
	timezone := "Asia/Kolkata"
	modules := []string{"move", "health", "finance", "work"}

	if h != nil && h.pg != nil {
		_ = h.pg.QueryRow(r.Context(),
			`SELECT u.email::text, COALESCE(NULLIF(p.display_name, ''), 'Sahil Kanungo'),
			        COALESCE(p.locale, 'en-IN'), COALESCE(p.timezone, 'Asia/Kolkata')
			 FROM identity.users u
			 LEFT JOIN platform.profiles p ON p.user_id = u.id
			 WHERE u.id = $1`,
			TestUserID,
		).Scan(&email, &displayName, &locale, &timezone)

		rows, err := h.pg.Query(r.Context(),
			`SELECT module_key FROM platform.module_preferences
			 WHERE user_id = $1 AND enabled = true
			 ORDER BY module_key ASC`,
			TestUserID,
		)
		if err == nil {
			var dbMods []string
			for rows.Next() {
				var m string
				if scanErr := rows.Scan(&m); scanErr == nil {
					dbMods = append(dbMods, m)
				}
			}
			rows.Close()
			if len(dbMods) > 0 {
				modules = dbMods
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":           TestUserID,
		"email":        email,
		"display_name": displayName,
		"modules":      modules,
		"locale":       locale,
		"timezone":     timezone,
	})
}

func HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email and password are required")
		return
	}
	writeJSON(w, http.StatusCreated, authResponse{
		UserID:      TestUserID,
		AccessToken: "placeholder-token",
		TokenType:   "Bearer",
	})
}

func HandleLogin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, authResponse{
		UserID:      TestUserID,
		AccessToken: "placeholder-token",
		TokenType:   "Bearer",
	})
}

func HandleMe(w http.ResponseWriter, r *http.Request) {
	(*Handler)(nil).Me(w, r)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":       code,
			"message":    message,
			"request_id": "",
			"details":    []any{},
		},
	})
}
