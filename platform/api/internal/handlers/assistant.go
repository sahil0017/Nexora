package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Assistant endpoints — placeholder implementations returning stable
// contract-shaped responses. Real agent runs arrive in M2.

type startConversationResponse struct {
	ConversationID string `json:"conversation_id"`
	Status         string `json:"status"`
}

func StartConversation(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusCreated, startConversationResponse{
		ConversationID: "00000000-0000-0000-0000-000000000001",
		Status:         "open",
	})
}

type sendMessageResponse struct {
	ConversationID   string `json:"conversation_id"`
	MessageID        string `json:"message_id"`
	AgentRunID       string `json:"agent_run_id"`
	Status           string `json:"status"`
	RequiresApproval bool   `json:"requires_approval"`
}

func SendMessage(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id") // conversation id, resolved to a run in M2
	writeJSON(w, http.StatusAccepted, sendMessageResponse{
		ConversationID:   "00000000-0000-0000-0000-000000000001",
		MessageID:        "00000000-0000-0000-0000-000000000002",
		AgentRunID:       "00000000-0000-0000-0000-000000000003",
		Status:           "running",
		RequiresApproval: false,
	})
}
