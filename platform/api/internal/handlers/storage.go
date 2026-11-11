package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

// PutDocument stores a document in Cloudflare D1.
// Route: POST /api/v1/documents  {user_id, title, content}
func (h *Handler) PutDocument(w http.ResponseWriter, r *http.Request) {
	if h.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "document storage not configured"})
		return
	}

	var body struct {
		UserID  string `json:"user_id"`
		Title   string `json:"title"`
		Content string `json:"content"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if body.UserID == "" || body.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id and content are required"})
		return
	}

	id, err := h.docs.PutDocument(r.Context(), body.UserID, body.Title, body.Content)
	if err != nil {
		h.logger.Error("docstore insert failed", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to store document"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// GetDocument fetches a document by ID from D1.
// Route: GET /api/v1/documents/{id}
func (h *Handler) GetDocument(w http.ResponseWriter, r *http.Request) {
	if h.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "document storage not configured"})
		return
	}

	doc, err := h.docs.GetDocument(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.logger.Error("docstore select failed", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to fetch document"})
		return
	}
	if doc == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "document not found"})
		return
	}

	writeJSON(w, http.StatusOK, doc)
}

// ListDocuments lists a user's documents from D1.
// Route: GET /api/v1/documents?user_id=...&limit=...
func (h *Handler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	if h.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "document storage not configured"})
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user_id query parameter is required"})
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	docs, err := h.docs.ListDocuments(r.Context(), userID, limit)
	if err != nil {
		h.logger.Error("docstore list failed", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to list documents"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"documents": docs, "count": len(docs)})
}

// DeleteDocument removes a document by ID from D1.
// Route: DELETE /api/v1/documents/{id}
func (h *Handler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	if h.docs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "document storage not configured"})
		return
	}

	deleted, err := h.docs.DeleteDocument(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.logger.Error("docstore delete failed", "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to delete document"})
		return
	}
	if !deleted {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "document not found"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"deleted": chi.URLParam(r, "id")})
}
