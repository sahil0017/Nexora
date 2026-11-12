package voice

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestPostgresRepositoryAll15TablesRoundTrip verifies live PostgreSQL persistence across
// all 15 voice.* tables when NEXORA_TEST_DATABASE_URL is configured.
func TestPostgresRepositoryAll15TablesRoundTrip(t *testing.T) {
	dsn := os.Getenv("NEXORA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set NEXORA_TEST_DATABASE_URL to run live PostgreSQL 15-table integration tests")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect test postgres: %v", err)
	}
	defer pool.Close()

	migPath := filepath.Join("..", "..", "..", "migrations", "0007_voice_intelligence.up.sql")
	migSQL, err := os.ReadFile(migPath)
	if err != nil {
		t.Fatalf("read migration %s: %v", migPath, err)
	}
	if _, err := pool.Exec(ctx, string(migSQL)); err != nil {
		t.Fatalf("apply migration: %v", err)
	}

	repo := NewPostgresRepository(pool)
	vault := NewVoiceVault("integration-test-secret")
	userID := uuid.NewString()
	convID := uuid.NewString()
	recID := uuid.NewString()

	ir := DeterministicFallbackProcess(userID, convID, recID, CaptureRequest{
		UserID:         userID,
		Title:          "Postgres 15-Table Audit Call",
		SourceType:     "call",
		TranscriptText: "Speaker 1: Let us finalize ₹50,000 by Friday.\nSpeaker 2: Agreed, I will send the signed SOW tomorrow.",
		SNRDB:          24,
		DurationMS:     5200,
	})
	ir.ExtractedKnowledge.Entities = []KnowledgeEntityIR{
		{
			EntityID:      uuid.NewString(),
			CanonicalName: "SOW Deliverable",
			EntityType:    "deliverable",
			Aliases:       []string{"signed SOW"},
			Embedding:     []float32{0.25, -0.5, 0.75},
		},
	}
	ir.ExtractedKnowledge.Edges = []KnowledgeEdgeIR{
		{
			FromEntity:   "SOW Deliverable",
			ToEntity:     "Friday Milestone",
			RelationType: "due_by",
			Confidence:   0.88,
			ValidFrom:    time.Now().UTC().Format(time.RFC3339Nano),
		},
	}

	saved, err := repo.SaveConversationIR(ctx, ir, vault, "captured")
	if err != nil {
		t.Fatalf("SaveConversationIR: %v", err)
	}

	sess := &CaptureSession{
		SessionID:         convID,
		ConversationID:    convID,
		UserID:            userID,
		Title:             ir.Title,
		CaptureMode:       "call_dual_track",
		SourceType:        "call",
		State:             "active",
		ChunkCount:        1,
		LastChunkSeq:      1,
		ProcessedSeqs:     []int{1},
		OSCaptureGuidance: "Dual-track test",
	}
	if err := repo.SaveCaptureSession(ctx, sess); err != nil {
		t.Fatalf("SaveCaptureSession: %v", err)
	}
	if gotSess, ok := repo.GetCaptureSession(ctx, convID); !ok || gotSess.ChunkCount != 1 {
		t.Fatalf("GetCaptureSession mismatch: ok=%v sess=%+v", ok, gotSess)
	}

	if len(saved.Utterances) > 0 {
		if _, err := repo.AddCorrection(ctx, userID, convID, CorrectionRequest{
			TargetType:     "utterance_text",
			TargetID:       saved.Utterances[0].UtteranceID,
			CorrectedValue: "Verified transcript turn",
			Reason:         "Integration check",
		}, vault); err != nil {
			t.Fatalf("AddCorrection: %v", err)
		}
	}

	if _, err := repo.ToggleLegalHold(ctx, userID, convID, true, userID, vault); err != nil {
		t.Fatalf("ToggleLegalHold: %v", err)
	}
	if _, err := repo.IncrementExportCount(ctx, userID, convID, vault); err != nil {
		t.Fatalf("IncrementExportCount: %v", err)
	}

	fetched, err := repo.GetConversation(ctx, userID, convID)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(fetched.ExtractedKnowledge.Entities) == 0 || len(fetched.ExtractedKnowledge.Edges) == 0 {
		t.Fatalf("expected persisted knowledge entities and edges, got %+v", fetched.ExtractedKnowledge)
	}
	if fetched.Evidence == nil || fetched.Evidence.ExportCount < 1 {
		t.Fatalf("expected incremented export count in evidence record, got %+v", fetched.Evidence)
	}

	imported, err := repo.BulkUpsertCallLogs(ctx, userID, []CallLogEntry{
		{
			PhoneHash:   HashPhoneNumber("+919876543210"),
			PhoneMasked: MaskPhoneNumber("+919876543210"),
			ContactName: "Vendor Lead",
			Direction:   "inbound",
			DurationSec: 210,
			StartedAt:   time.Now().UTC().Add(-2 * time.Hour),
			Source:      "device_call_log",
			SpamRisk:    "low",
		},
	})
	if err != nil || imported != 1 {
		t.Fatalf("BulkUpsertCallLogs failed: imported=%d err=%v", imported, err)
	}
	if loadedLogs, err := repo.ListCallLogs(ctx, userID, 50); err != nil || len(loadedLogs) != 1 {
		t.Fatalf("ListCallLogs failed: count=%d err=%v", len(loadedLogs), err)
	}
}
