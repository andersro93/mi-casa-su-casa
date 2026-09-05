package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Ports src/server/db/repositories/audit.ts (REF §A6).

// AuditEventInput is one entry in the trail. HouseholdID is nil for
// installation-level events (first-run setup, session revocations), which is
// why those never show up in a household's log.
type AuditEventInput struct {
	ActorUserID *string
	HouseholdID *string
	Action      string
	TargetType  string
	TargetID    *string
	Details     map[string]any
}

// AuditEvent is one row of the admin audit screen. camelCase tags, matching
// what the TypeScript returned.
//
// Details is raw JSON rather than a decoded map: the API hands it straight
// back to the SPA, and re-encoding a decoded map would reorder keys and turn
// integers into floats for no benefit.
type AuditEvent struct {
	ID          string          `json:"id"`
	ActorUserID *string         `json:"actorUserId"`
	HouseholdID *string         `json:"householdId"`
	Action      string          `json:"action"`
	TargetType  string          `json:"targetType"`
	TargetID    *string         `json:"targetId"`
	Details     json.RawMessage `json:"details"`
	CreatedAt   time.Time       `json:"createdAt"`
}

// RecordAudit writes an audit entry and returns nothing at all.
//
// That is the point: an audit hiccup must never undo or hide the action the
// user just performed, so a failure here is logged and swallowed rather than
// handed back to a caller who would have to decide what to do with it — and
// whose only sensible choice would be to ignore it anyway. The TypeScript
// made the same call (`logEvent("error", "audit_write_failed", …)`); the
// structured logger this borrows the event name from arrives in Task 11, at
// which point the log.Printf below becomes a logger call.
func (r *Repo) RecordAudit(ctx context.Context, in AuditEventInput) {
	id, err := newID()
	if err != nil {
		log.Printf("audit_write_failed action=%s error=%v", in.Action, err)
		return
	}

	var details []byte
	if in.Details != nil {
		encoded, err := json.Marshal(in.Details)
		if err != nil {
			log.Printf("audit_write_failed action=%s error=%v", in.Action, err)
			return
		}
		details = encoded
	}

	if err := r.q.InsertAuditEvent(ctx, gen.InsertAuditEventParams{
		ID:          id,
		ActorUserID: in.ActorUserID,
		HouseholdID: in.HouseholdID,
		Action:      in.Action,
		TargetType:  in.TargetType,
		TargetID:    in.TargetID,
		Details:     details,
	}); err != nil {
		log.Printf("audit_write_failed action=%s error=%v", in.Action, err)
	}
}

// ListAuditEvents returns one household's trail, newest first.
func (r *Repo) ListAuditEvents(ctx context.Context, householdID string, limit int) ([]AuditEvent, error) {
	rows, err := r.q.ListAuditEvents(ctx, gen.ListAuditEventsParams{
		HouseholdID: &householdID,
		RowLimit:    int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("repo: list audit events: %w", err)
	}
	events := make([]AuditEvent, 0, len(rows))
	for _, row := range rows {
		events = append(events, AuditEvent{
			ID:          row.ID,
			ActorUserID: row.ActorUserID,
			HouseholdID: row.HouseholdID,
			Action:      row.Action,
			TargetType:  row.TargetType,
			TargetID:    row.TargetID,
			Details:     json.RawMessage(row.Details),
			CreatedAt:   fromTS(row.CreatedAt),
		})
	}
	return events, nil
}
