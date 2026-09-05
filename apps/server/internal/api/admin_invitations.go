package api

import (
	"context"
	"errors"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/invite"
)

// Ports src/server/routes/admin/invitations.ts (REF §A2, "Admin"): issuing,
// listing, reissuing and cancelling invitations.
//
// The service underneath is internal/invite, shared with "add a member"
// because the two ARE the same act: POST /members is an invitation with no
// provider scope. Nobody in this application is ever handed an account
// somebody else chose a password for — an owner can only offer a link, and
// the invitee sets their own credentials when they accept.
//
// Delivery is reported, not enforced (REF §A3). A self-hosted installation
// with no working SMTP still issues usable invitations; `emailSent:false` plus
// `inviteUrl` is what the owner needs to carry the link across by hand.

// ListInvitations answers the invitations screen.
//
// Stale invitations are marked expired first, so the list never shows a
// pending invitation whose link has already stopped working — the expiry is a
// timestamp, and nothing else would notice it had passed.
func (s server) ListInvitations(ctx context.Context, _ gen.ListInvitationsRequestObject) (gen.ListInvitationsResponseObject, error) {
	_, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ListInvitations403JSONResponse(errorBody("Forbidden")), nil
	}

	if err := s.Repo.RefreshExpiredInvitations(ctx, s.Now(), &household.ID); err != nil {
		return nil, err
	}
	invitations, err := s.Repo.ListInvitations(ctx, household.ID)
	if err != nil {
		return nil, err
	}

	rows := make([]gen.Invitation, 0, len(invitations))
	for _, invitation := range invitations {
		rows = append(rows, invitationBody(invitation))
	}
	return gen.ListInvitations200JSONResponse{Invitations: rows}, nil
}

// CreateInvitation invites somebody, optionally scoped to a set of providers.
func (s server) CreateInvitation(ctx context.Context, request gen.CreateInvitationRequestObject) (gen.CreateInvitationResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.CreateInvitation403JSONResponse(errorBody("Forbidden")), nil
	}

	in, problems := normalizeInvitationBody(
		request.Body.Email, request.Body.Name, request.Body.Role, request.Body.ProviderIds)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CreateInvitation400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	// Every provider id must belong to THIS household. Without the check an
	// owner could scope an invitation to somebody else's provider, and the
	// accept would copy that scope into a real access grant.
	belong, err := s.Repo.ProvidersBelong(ctx, household.ID, in.ProviderIDs)
	if err != nil {
		return nil, err
	}
	if !belong {
		return gen.CreateInvitation400JSONResponse(errorBody(
			"One or more selected providers do not belong to this household")), nil
	}

	result, err := s.issueInvitation(ctx, viewer, household, in)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, errInvitationVanished
	}
	return gen.CreateInvitation201JSONResponse(invitationResultBody(*result)), nil
}

// CreateMember is "add a member", which is an invitation with no provider
// scope — the same handler body as CreateInvitation minus the scope, and the
// same `invitation.created` audit entry, exactly as the TypeScript had it.
func (s server) CreateMember(ctx context.Context, request gen.CreateMemberRequestObject) (gen.CreateMemberResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.CreateMember403JSONResponse(errorBody("Forbidden")), nil
	}

	in, problems := normalizeInvitationBody(request.Body.Email, request.Body.Name, request.Body.Role, nil)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CreateMember400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	result, err := s.issueInvitation(ctx, viewer, household, in)
	if err != nil {
		return nil, err
	}
	if result == nil {
		return nil, errInvitationVanished
	}
	return gen.CreateMember201JSONResponse(invitationResultBody(*result)), nil
}

// ResendInvitation reissues a pending invitation with a new token.
func (s server) ResendInvitation(ctx context.Context, request gen.ResendInvitationRequestObject) (gen.ResendInvitationResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ResendInvitation403JSONResponse(errorBody("Forbidden")), nil
	}

	// Expiring stale invitations first is what makes "not resendable" true of
	// an invitation whose deadline has passed: the service only reissues a
	// pending one.
	if err := s.Repo.RefreshExpiredInvitations(ctx, s.Now(), &household.ID); err != nil {
		return nil, err
	}

	result, err := invite.Resend(ctx, s.inviteDeps(), household.ID, inviterOf(viewer), request.InvitationId)
	if err != nil {
		return nil, err
	}
	if result == nil {
		// One message for "no such invitation" and for "not pending", so the
		// route cannot be used to learn which invitation ids exist.
		return gen.ResendInvitation404JSONResponse(errorBody("Invitation not found or not resendable")), nil
	}

	s.audit(ctx, viewer, household, "invitation.resent", "invitation", &result.Invitation.ID, map[string]any{
		"email":     result.Invitation.Email,
		"replaces":  request.InvitationId,
		"emailSent": result.EmailSent,
	})

	return gen.ResendInvitation200JSONResponse(invitationResultBody(*result)), nil
}

// CancelInvitation makes an invitation's link stop working.
func (s server) CancelInvitation(ctx context.Context, request gen.CancelInvitationRequestObject) (gen.CancelInvitationResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.CancelInvitation403JSONResponse(errorBody("Forbidden")), nil
	}

	invitation, err := s.Repo.GetInvitationByID(ctx, household.ID, request.InvitationId)
	if err != nil {
		return nil, err
	}
	if invitation == nil {
		return gen.CancelInvitation404JSONResponse(errorBody("Invitation not found")), nil
	}

	if err := s.Repo.CancelInvitation(ctx, household.ID, request.InvitationId); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "invitation.cancelled", "invitation", &request.InvitationId, nil)

	return gen.CancelInvitation200JSONResponse(okBody()), nil
}

// errInvitationVanished is the TypeScript's `!result` branch: the invitation
// was written and then could not be read back, one statement later, from the
// same household. Nothing removes rows in between, so this is a "cannot
// happen" that must still not be silently successful — it becomes REF §A1 item
// 11's logged 500 rather than the TypeScript's bespoke one, because an
// unreachable branch does not earn a response shape of its own in the spec.
var errInvitationVanished = errors.New("api: invitation disappeared immediately after it was created")

// issueInvitation is the half CreateInvitation and CreateMember share: mint
// the invitation, mail it, and record that it happened.
//
// nil, nil is the TypeScript's `!result` branch — the record vanished between
// being written and being read back — which each caller answers itself.
func (s server) issueInvitation(ctx context.Context, viewer *auth.Session, household *middleware.Household, in invite.Input) (*invite.Result, error) {
	result, err := invite.Create(ctx, s.inviteDeps(), household.ID, inviterOf(viewer), in)
	if err != nil || result == nil {
		return nil, err
	}

	// `emailSent` is part of the trail on purpose: when somebody says they
	// never got an invitation, the first question is whether it was ever
	// handed to a transport.
	s.audit(ctx, viewer, household, "invitation.created", "invitation", &result.Invitation.ID, map[string]any{
		"email":     result.Invitation.Email,
		"role":      result.Invitation.Role,
		"emailSent": result.EmailSent,
	})
	return result, nil
}

// inviteDeps assembles the invitation service's collaborators from this
// server's own.
func (s server) inviteDeps() invite.Deps {
	return invite.Deps{Repo: s.Repo, Mail: s.Mail, Now: s.Now, AppURL: s.AppURL}
}

// inviterOf is the caller as the invitation mail needs to name them.
func inviterOf(viewer *auth.Session) invite.Inviter {
	return invite.Inviter{ID: viewer.UserID, Name: viewer.Name, Email: viewer.Email}
}

// maxInvitationProviders is REF §A4's cap on an invitation's provider scope.
// It is a sanity bound rather than a policy: a household with more than fifty
// providers is not a household.
const maxInvitationProviders = 50

// normalizeInvitationBody applies REF §A4's `invitation` schema (and, with a
// nil scope, its `createMember` schema, which is the same minus providerIds).
func normalizeInvitationBody(rawEmail, rawName string, rawRole *string, rawProviderIDs *[]string) (invite.Input, []problem) {
	in := invite.Input{
		Email:       normalizeEmail(rawEmail),
		Name:        strings.TrimSpace(rawName),
		ProviderIDs: []string{},
	}

	var problems []problem
	// As in validateSetupBody: the shape check runs only on an address that
	// survived the length rule, so one empty input does not produce two
	// messages on one control.
	if emailProblems := appendTextProblems(nil, "email", in.Email, 254); len(emailProblems) > 0 {
		problems = append(problems, emailProblems...)
	} else if !emailPattern.MatchString(in.Email) {
		problems = append(problems, problem{field: "email", message: "email must be a valid email address"})
	}
	problems = appendTextProblems(problems, "name", in.Name, 80)

	role, roleProblems := normalizeRole(rawRole)
	problems = append(problems, roleProblems...)
	in.Role = role

	if rawProviderIDs != nil {
		if len(*rawProviderIDs) > maxInvitationProviders {
			problems = append(problems, problem{
				field:   "providerIds",
				message: "at most " + itoa(maxInvitationProviders) + " providers can be scoped",
			})
		} else {
			for _, id := range *rawProviderIDs {
				trimmed := strings.TrimSpace(id)
				// Each id is bounded exactly as REF §A4 bounds it. Anything
				// outside those bounds could not name a provider anyway, so
				// this only changes WHICH refusal the owner sees — a message
				// against the control they used, rather than "does not belong
				// to this household".
				if entryProblems := appendTextProblems(nil, "providerIds", trimmed, 64); len(entryProblems) > 0 {
					problems = append(problems, entryProblems...)
					break
				}
				in.ProviderIDs = append(in.ProviderIDs, trimmed)
			}
		}
	}

	return in, problems
}

// invitationResultBody maps the service's result onto the wire shape.
// `emailError` is omitted rather than sent empty when delivery succeeded, so
// its presence alone means something went wrong.
func invitationResultBody(result invite.Result) gen.InvitationResult {
	body := gen.InvitationResult{
		Invitation: invitationBody(result.Invitation),
		InviteUrl:  result.InviteURL,
		EmailSent:  result.EmailSent,
	}
	if result.EmailError != "" {
		body.EmailError = ptr(result.EmailError)
	}
	return body
}
