package api

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// The small conversions every hand-written route in this package repeats: the
// error envelope in the shape the generated response types want it, and the
// repo → wire mappings. They live here rather than in one route's file
// because the next route task needs the same ones.

// The three shapes of REF §A1's failure envelope. Each generated NNN response
// type for an error status is a defined type over gen.Error, so a call site
// converts: gen.CompleteSetup409JSONResponse(errorBody("…")).

// errorBody is the plain envelope: a message and nothing else, which is the
// common case by a wide margin.
func errorBody(message string) gen.Error {
	return gen.Error{Error: message}
}

// errorFieldsBody carries per-input messages alongside the summary, so the SPA
// can render each one next to its own form control.
func errorFieldsBody(message string, fields map[string]string) gen.Error {
	body := gen.Error{Error: message}
	if len(fields) > 0 {
		body.Fields = &fields
	}
	return body
}

// errorCodeBody carries a stable machine-readable discriminator, for the one
// failure the SPA must branch on rather than merely display (ACCOUNT_EXISTS).
func errorCodeBody(message, code string) gen.Error {
	return gen.Error{Error: message, Code: &code}
}

// viewerFrom is the signed-in caller, or nil when nobody is. It reaches the
// request through the pair middleware.CaptureHTTP stashed, because a generated
// strict handler is handed a context and nothing else — and the session value
// middleware.Session put in that request's context is what UserFrom reads.
//
// nil is also the honest answer when the operation's tier mounts no Session
// middleware at all: such a route has no caller to speak of.
func viewerFrom(ctx context.Context) *auth.Session {
	_, r, ok := middleware.HTTPFromContext(ctx)
	if !ok || r == nil {
		return nil
	}
	return middleware.UserFrom(r)
}

// householdFrom is the tenancy context RequireHousehold resolved, or nil when
// the operation's tier does not mount it. It reaches the request the same way
// viewerFrom does, because a strict handler is handed a context and nothing
// else.
func householdFrom(ctx context.Context) *middleware.Household {
	_, r, ok := middleware.HTTPFromContext(ctx)
	if !ok || r == nil {
		return nil
	}
	return middleware.HouseholdFrom(r)
}

// householdContext is the pair every household-scoped handler opens with: the
// caller and the household the tenancy guard resolved.
//
// ok is false only if such a route were ever mounted without tierHousehold or
// tierOwner, in which case refusing is the failure that leaks nothing. Each
// handler answers its own 403 rather than sharing one, because the generated
// response types are per-operation.
func (s server) householdContext(ctx context.Context) (*auth.Session, *middleware.Household, bool) {
	viewer := viewerFrom(ctx)
	household := householdFrom(ctx)
	if viewer == nil || household == nil {
		return nil, nil, false
	}
	return viewer, household, true
}

// emailPattern is REF §A4's email rule verbatim: deliberately loose, because
// the authoritative test of an address is whether mail to it arrives, and a
// stricter pattern only rejects addresses that work.
var emailPattern = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// normalizeEmail trims and lower-cases, so the same account is found however
// the address was typed. Every comparison against a stored address goes
// through this.
func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// householdBody maps a household onto the wire shape, preserving nil: both
// setup and invitation-accept answer with `household: null` rather than
// omitting the key when there is nothing to send.
func householdBody(household *repo.Household) *gen.Household {
	if household == nil {
		return nil
	}
	return &gen.Household{
		Id:          household.ID,
		Slug:        household.Slug,
		DisplayName: household.DisplayName,
		CreatedAt:   household.CreatedAt,
		UpdatedAt:   household.UpdatedAt,
	}
}

// householdSummaries maps the switcher list onto the wire shape. The slice is
// made non-nil even when empty: `households: []` is what the SPA expects, and
// a nil slice would marshal as null.
func householdSummaries(households []repo.HouseholdSummary) []gen.HouseholdSummary {
	summaries := make([]gen.HouseholdSummary, 0, len(households))
	for _, household := range households {
		summaries = append(summaries, gen.HouseholdSummary{
			Id:          household.ID,
			Slug:        household.Slug,
			DisplayName: household.DisplayName,
			Role:        gen.HouseholdSummaryRole(household.Role),
		})
	}
	return summaries
}

// okBody is the acknowledgement every "it is done, and there is nothing to
// show for it" route answers with.
func okBody() gen.Ok { return gen.Ok{Ok: true} }

// invitationBody maps an invitation and its provider scope onto the wire
// shape. The provider entries keep their snake_case keys inside a camelCase
// parent: that is what the TypeScript sent and what the SPA reads.
func invitationBody(invitation repo.Invitation) gen.Invitation {
	providers := make([]gen.InvitationProvider, 0, len(invitation.Providers))
	for _, provider := range invitation.Providers {
		providers = append(providers, gen.InvitationProvider{
			Id:          provider.ID,
			ProviderKey: provider.ProviderKey,
			DisplayName: provider.DisplayName,
		})
	}

	return gen.Invitation{
		Id:               invitation.ID,
		HouseholdId:      invitation.HouseholdID,
		Email:            invitation.Email,
		Name:             invitation.Name,
		Role:             gen.InvitationRole(invitation.Role),
		Status:           gen.InvitationStatus(invitation.Status),
		InvitedByUserId:  invitation.InvitedByUserID,
		AcceptedByUserId: invitation.AcceptedByUserID,
		ExpiresAt:        invitation.ExpiresAt,
		AcceptedAt:       invitation.AcceptedAt,
		CancelledAt:      invitation.CancelledAt,
		CreatedAt:        invitation.CreatedAt,
		UpdatedAt:        invitation.UpdatedAt,
		Providers:        providers,
	}
}

// ptr is the address of a value, for the pointer fields an optional column
// maps to.
func ptr[T any](value T) *T { return &value }

// itoa keeps the message builders above readable — strconv.Itoa spelled at
// each call site drowns the string it is building.
func itoa(n int) string { return strconv.Itoa(n) }
