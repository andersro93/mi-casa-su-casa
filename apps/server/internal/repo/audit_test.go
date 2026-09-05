package repo_test

import (
	"encoding/json"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports the repository half of test/integration/audit-log.test.ts.

func TestRecordAndListAuditEvents(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	owner, casa := ownedHousehold(t, r, rig, "owner@example.com", "casa")
	_, otra := ownedHousehold(t, r, rig, "other@example.com", "otra")

	r.RecordAudit(c, repo.AuditEventInput{
		ActorUserID: &owner,
		HouseholdID: &casa.ID,
		Action:      "provider.created",
		TargetType:  "provider",
		TargetID:    strptr("provider-1"),
		Details:     map[string]any{"providerKey": "netflix"},
	})
	r.RecordAudit(c, repo.AuditEventInput{
		ActorUserID: &owner,
		HouseholdID: &casa.ID,
		Action:      "member.removed",
		TargetType:  "user",
	})
	// An installation-level event has no household and no actor.
	r.RecordAudit(c, repo.AuditEventInput{
		Action:     "installation.setup_completed",
		TargetType: "installation",
		TargetID:   strptr("1"),
	})

	events, err := r.ListAuditEvents(c, casa.ID, 100)
	if err != nil {
		t.Fatalf("ListAuditEvents: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("ListAuditEvents = %d events, want 2 (the installation event has no household)", len(events))
	}
	// Newest first.
	if events[0].Action != "member.removed" || events[1].Action != "provider.created" {
		t.Fatalf("event order = %s, %s", events[0].Action, events[1].Action)
	}
	newest := events[0]
	if newest.ActorUserID == nil || *newest.ActorUserID != owner ||
		newest.HouseholdID == nil || *newest.HouseholdID != casa.ID ||
		newest.TargetType != "user" || newest.TargetID != nil || newest.CreatedAt.IsZero() {
		t.Fatalf("event = %+v", newest)
	}
	if newest.Details != nil {
		t.Fatalf("event without details = %v, want nil", newest.Details)
	}

	var details map[string]any
	if err := json.Unmarshal(events[1].Details, &details); err != nil {
		t.Fatalf("unmarshal details: %v", err)
	}
	if details["providerKey"] != "netflix" {
		t.Fatalf("details = %v", details)
	}

	// Another household sees none of it.
	if empty, err := r.ListAuditEvents(c, otra.ID, 100); err != nil || len(empty) != 0 {
		t.Fatalf("ListAuditEvents(other household) = %+v (%v)", empty, err)
	}

	// The limit is honoured.
	limited, err := r.ListAuditEvents(c, casa.ID, 1)
	if err != nil || len(limited) != 1 || limited[0].Action != "member.removed" {
		t.Fatalf("ListAuditEvents(limit 1) = %+v (%v)", limited, err)
	}
}

func TestRecordAuditNeverFailsTheAction(t *testing.T) {
	r, rig := setup(t)
	c := ctx(t)
	_, household := ownedHousehold(t, r, rig, "owner@example.com", "casa")

	// A cancelled context makes the write fail. RecordAudit returns nothing
	// at all, so an audit hiccup cannot undo or hide the action the user just
	// performed — it is logged and swallowed.
	cancelled, cancel := contextWithCancel(c)
	cancel()
	r.RecordAudit(cancelled, repo.AuditEventInput{
		HouseholdID: &household.ID,
		Action:      "provider.created",
		TargetType:  "provider",
	})

	if got := countRows(t, rig, "audit_events", ""); got != 0 {
		t.Fatalf("audit rows = %d, want 0 (the write failed and was swallowed)", got)
	}
}
