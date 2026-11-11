// Package storage defines the backend-agnostic document store contract.
// Implementations exist for Cloudflare D1 (d1.go) and AWS DynamoDB (dynamodb.go).
package storage

import (
	"context"
	"time"
)

// Document is a stored user document.
type Document struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
}

// DocumentStore is the storage-agnostic interface for the documents feature.
type DocumentStore interface {
	PutDocument(ctx context.Context, userID, title, content string) (string, error)
	GetDocument(ctx context.Context, id string) (*Document, error)
	ListDocuments(ctx context.Context, userID string, limit int) ([]Document, error)
	DeleteDocument(ctx context.Context, id string) (bool, error)
	Ping(ctx context.Context) error
}
