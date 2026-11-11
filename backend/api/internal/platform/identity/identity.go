// Package identity implements authentication and user endpoints.
// Contract shapes follow contracts/openapi/movesmart→nexora v1 spec.
package identity

import (
	"encoding/json"
	"net/http"
)

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	UserID      string `json:"user_id"`
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
}

func HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Email == "" {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "email and password are required")
		return
	}
	// M1: persist user, hash password, issue real JWT.
	writeJSON(w, http.StatusCreated, authResponse{
		UserID:      "00000000-0000-0000-0000-000000000000",
		AccessToken: "placeholder-token",
		TokenType:   "Bearer",
	})
}

func HandleLogin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, authResponse{
		UserID:      "00000000-0000-0000-0000-000000000000",
		AccessToken: "placeholder-token",
		TokenType:   "Bearer",
	})
}

func HandleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"id":            "00000000-0000-0000-0000-000000000000",
		"email":         "user@example.com",
		"display_name":  "User",
		"modules":       []string{"move", "health", "finance", "work"},
		"locale":        "en-IN",
		"timezone":      "Asia/Kolkata",
	})
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
