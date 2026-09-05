package api

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/admin/settings.ts and src/server/routes/admin/audit.ts
// (REF §A2, "Admin"): the household's own name and address, and the trail of
// everything the owners have done to it.
//
// Every route in the four admin_*.go files runs behind tierOwner (routes.go),
// which is the Go spelling of the TypeScript's `adminRoutes.use("/:slug/*",
// requireHouseholdContext)` plus `requireOwner`. That is also why each handler
// starts by resolving the household from the request rather than by looking a
// slug up: the guard already did the lookup AND the authorization, and doing
// it again here would be a second implementation of the tenancy boundary.

// auditLimit is how much of the trail the admin screen reads. REF §A2:
// "newest 100".
const auditLimit = 100

// ListAuditEvents answers the audit screen.
func (s server) ListAuditEvents(ctx context.Context, _ gen.ListAuditEventsRequestObject) (gen.ListAuditEventsResponseObject, error) {
	_, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.ListAuditEvents403JSONResponse(errorBody("Forbidden")), nil
	}

	events, err := s.Repo.ListAuditEvents(ctx, household.ID, auditLimit)
	if err != nil {
		return nil, err
	}

	rows := make([]gen.AuditEvent, 0, len(events))
	for _, event := range events {
		rows = append(rows, gen.AuditEvent{
			Id:          event.ID,
			ActorUserId: event.ActorUserID,
			HouseholdId: event.HouseholdID,
			Action:      event.Action,
			TargetType:  event.TargetType,
			TargetId:    event.TargetID,
			Details:     auditDetails(event.Details),
			CreatedAt:   event.CreatedAt,
		})
	}
	return gen.ListAuditEvents200JSONResponse{Events: rows}, nil
}

// GetHouseholdSettings answers the household settings screen.
func (s server) GetHouseholdSettings(ctx context.Context, _ gen.GetHouseholdSettingsRequestObject) (gen.GetHouseholdSettingsResponseObject, error) {
	_, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.GetHouseholdSettings403JSONResponse(errorBody("Forbidden")), nil
	}

	settings, err := s.Repo.GetHouseholdByID(ctx, household.ID)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return gen.GetHouseholdSettings404JSONResponse(errorBody("Household not found")), nil
	}
	return gen.GetHouseholdSettings200JSONResponse{
		Household: s.householdSettingsBody(*settings),
	}, nil
}

// UpdateHouseholdSettings renames the household.
//
// The slug is deliberately not settable. It is the local part of the
// household's inbound address, so changing it would silently break every
// sender rule a provider has already been pointed at — and would free the old
// address for somebody else to claim.
func (s server) UpdateHouseholdSettings(ctx context.Context, request gen.UpdateHouseholdSettingsRequestObject) (gen.UpdateHouseholdSettingsResponseObject, error) {
	viewer, household, ok := s.adminContext(ctx)
	if !ok {
		return gen.UpdateHouseholdSettings403JSONResponse(errorBody("Forbidden")), nil
	}

	displayName := strings.TrimSpace(request.Body.DisplayName)
	if problems := appendTextProblems(nil, "displayName", displayName, 80); len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateHouseholdSettings400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	settings, err := s.Repo.UpdateHouseholdDisplayName(ctx, household.ID, displayName)
	if err != nil {
		return nil, err
	}
	if settings == nil {
		return gen.UpdateHouseholdSettings404JSONResponse(errorBody("Household not found")), nil
	}

	s.audit(ctx, viewer, household, "household.settings_updated", "household", &household.ID,
		map[string]any{"displayName": displayName})

	return gen.UpdateHouseholdSettings200JSONResponse{
		Household: s.householdSettingsBody(*settings),
	}, nil
}

// householdSettingsBody maps a household onto the settings screen's shape,
// adding the one field that is not stored: the address providers must be told
// to send codes to, which is the slug at the installation's inbound domain.
//
// It is null when EMAIL_DOMAIN is unset, as the TypeScript's was. internal/config
// requires the variable, so a running server never produces that — but the
// nullable field is what the SPA already handles, and inventing "slug@" for a
// misconfigured installation would be worse than saying nothing.
func (s server) householdSettingsBody(household repo.Household) gen.HouseholdSettings {
	body := gen.HouseholdSettings{
		Slug:        household.Slug,
		DisplayName: household.DisplayName,
	}
	if domain := strings.TrimSpace(s.EmailDomain); domain != "" {
		body.EmailAddress = ptr(household.Slug + "@" + domain)
	}
	return body
}

// auditDetails parses a stored details blob back into the object the screen
// renders. Anything that is not a JSON object — including SQL NULL — comes
// back as null rather than as an error: the trail is a record of what
// happened, and one unreadable detail blob must not cost the reader the rest
// of the page.
func auditDetails(raw json.RawMessage) *map[string]any {
	if len(raw) == 0 {
		return nil
	}
	var details map[string]any
	if err := json.Unmarshal(raw, &details); err != nil || details == nil {
		return nil
	}
	return &details
}

// adminContext is the pair every admin handler opens with: the caller and the
// household the tenancy guard resolved.
//
// ok is false only if an admin route were ever mounted without tierOwner, in
// which case refusing is the failure that leaks nothing. Each handler answers
// its own 403 rather than sharing one, because the generated response types
// are per-operation.
func (s server) adminContext(ctx context.Context) (*auth.Session, *middleware.Household, bool) {
	viewer := viewerFrom(ctx)
	household := householdFrom(ctx)
	if viewer == nil || household == nil {
		return nil, nil, false
	}
	return viewer, household, true
}

// audit records one owner action against the current household — the Go
// counterpart of src/server/routes/admin/audit.ts's `audit(c, …)` helper.
//
// It returns nothing, deliberately: RecordAudit logs its own failures
// (`audit_write_failed`) and never returns one, because REF §A6 requires that
// an unwritable trail cannot fail the action it was recording.
func (s server) audit(ctx context.Context, viewer *auth.Session, household *middleware.Household, action, targetType string, targetID *string, details map[string]any) {
	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &viewer.UserID,
		HouseholdID: &household.ID,
		Action:      action,
		TargetType:  targetType,
		TargetID:    targetID,
		Details:     details,
	})
}
