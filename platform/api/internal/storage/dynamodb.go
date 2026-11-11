// Package storage — DynamoDB-backed DocumentStore.
//
// Replaces Cloudflare D1 as the serverless document backend on AWS free tier.
// Table shape (on-demand billing, PAY_PER_REQUEST), single-table layout:
//
//	pk (HASH) = "DOC#<id>"
//	sk (RANGE) = "META#<id>"
//
// Attributes: id, user_id, title, content, created_at (RFC3339).
// User listing uses Scan + FilterExpression — at dev scale this stays inside
// the always-free 25 GB / 25 RCU allocation and avoids GSI management entirely.
package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// DynamoDBStore implements DocumentStore on AWS DynamoDB.
type DynamoDBStore struct {
	client *dynamodb.Client
	table  string
}

// NewDynamoDBStore builds a store against the given table.
func NewDynamoDBStore(client *dynamodb.Client, table string) *DynamoDBStore {
	return &DynamoDBStore{client: client, table: table}
}

// NewDynamoDBClient creates a DynamoDB client from a resolved AWS config.
func NewDynamoDBClient(cfg aws.Config) *dynamodb.Client {
	return dynamodb.NewFromConfig(cfg)
}

type ddbDoc struct {
	PK        string `dynamodbav:"pk"`
	SK        string `dynamodbav:"sk"`
	ID        string `dynamodbav:"id"`
	UserID    string `dynamodbav:"user_id"`
	Title     string `dynamodbav:"title"`
	Content   string `dynamodbav:"content"`
	CreatedAt string `dynamodbav:"created_at"`
}

// PutDocument inserts a document and returns its ID.
func (s *DynamoDBStore) PutDocument(ctx context.Context, userID, title, content string) (string, error) {
	id, err := newID()
	if err != nil {
		return "", fmt.Errorf("dynamodb: generate id: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	item, err := attributevalue.MarshalMap(ddbDoc{
		PK:        "DOC#" + id,
		SK:        "META#" + id,
		ID:        id,
		UserID:    userID,
		Title:     title,
		Content:   content,
		CreatedAt: now,
	})
	if err != nil {
		return "", fmt.Errorf("dynamodb: marshal: %w", err)
	}
	_, err = s.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(s.table),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(pk)"),
	})
	if err != nil {
		return "", fmt.Errorf("dynamodb: put: %w", err)
	}
	return id, nil
}

// GetDocument fetches one document by ID.
func (s *DynamoDBStore) GetDocument(ctx context.Context, id string) (*Document, error) {
	out, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.table),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: "DOC#" + id},
			"sk": &types.AttributeValueMemberS{Value: "META#" + id},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("dynamodb: get: %w", err)
	}
	if out.Item == nil {
		return nil, nil // not found
	}
	return docFromItem(out.Item)
}

// ListDocuments returns a user's documents, newest first, capped at limit.
func (s *DynamoDBStore) ListDocuments(ctx context.Context, userID string, limit int) ([]Document, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	// Scan with a user filter; sort newest-first in memory.
	var items []map[string]types.AttributeValue
	var cursor map[string]types.AttributeValue
	for {
		out, err := s.client.Scan(ctx, &dynamodb.ScanInput{
			TableName:                aws.String(s.table),
			FilterExpression:         aws.String("#u = :u"),
			ExpressionAttributeNames: map[string]string{"#u": "user_id"},
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":u": &types.AttributeValueMemberS{Value: userID},
			},
			ExclusiveStartKey: cursor,
		})
		if err != nil {
			return nil, fmt.Errorf("dynamodb: scan: %w", err)
		}
		items = append(items, out.Items...)
		if out.LastEvaluatedKey == nil || len(items) >= limit*4 { // safety bound
			break
		}
		cursor = out.LastEvaluatedKey
	}
	sort.Slice(items, func(i, j int) bool { // newest first
		ci, _ := attrString(items[i], "created_at")
		cj, _ := attrString(items[j], "created_at")
		return ci > cj
	})
	if len(items) > limit {
		items = items[:limit]
	}
	docs := make([]Document, 0, len(items))
	for _, item := range items {
		doc, err := docFromItem(item)
		if err != nil {
			return nil, err
		}
		docs = append(docs, *doc)
	}
	return docs, nil
}

// DeleteDocument removes a document by ID. Returns true if a row was deleted.
func (s *DynamoDBStore) DeleteDocument(ctx context.Context, id string) (bool, error) {
	_, err := s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.table),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: "DOC#" + id},
			"sk": &types.AttributeValueMemberS{Value: "META#" + id},
		},
		ConditionExpression: aws.String("attribute_exists(pk)"),
	})
	if err != nil {
		var cfe *types.ConditionalCheckFailedException
		if errors.As(err, &cfe) {
			return false, nil // not found
		}
		return false, fmt.Errorf("dynamodb: delete: %w", err)
	}
	return true, nil
}

// Ping verifies table access with a cheap describe.
func (s *DynamoDBStore) Ping(ctx context.Context) error {
	_, err := s.client.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: aws.String(s.table),
	})
	return err
}

func attrString(item map[string]types.AttributeValue, key string) (string, bool) {
	if v, ok := item[key].(*types.AttributeValueMemberS); ok {
		return v.Value, true
	}
	return "", false
}

func docFromItem(item map[string]types.AttributeValue) (*Document, error) {
	var rec ddbDoc
	if err := attributevalue.UnmarshalMap(item, &rec); err != nil {
		return nil, fmt.Errorf("dynamodb: unmarshal: %w", err)
	}
	doc := &Document{ID: rec.ID, UserID: rec.UserID, Title: rec.Title, Content: rec.Content}
	if t, err := time.Parse(time.RFC3339, rec.CreatedAt); err == nil {
		doc.CreatedAt = t
	}
	return doc, nil
}

// newID generates a random 32-hex-char identifier.
func newID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
