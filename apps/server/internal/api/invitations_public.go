package api

import (
	"context"
	"errors"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

// Ports src/server/routes/invitations.ts (REF §A2, "Invitations — public").
//
// These two routes are the only unauthenticated path into a household, which
// is why they are shaped the way they are:
//
//   - The token travels in the X-Invitation-Token HEADER, never in the URL. A
//     path or query parameter would land in access logs, browser history and
//     the Referer of every image an invite page loads. A token in the query
//     string is therefore not read at all, and a request that puts it there is
//     answered as if it carried no token.
//   - The token is looked up by its SHA-256, so the database never holds a
//     usable link.
//   - Both are rate limited on one shared bucket (20 per 10 minutes): together
//     they are what would tell an attacker whether a guessed token exists.

// LookupInvitation answers what an invitation link points at, so the invite
// page can pick a flow: create an account, sign in first, or accept as
// whoever is already signed in.
func (s server) LookupInvitation(ctx context.Context, request gen.LookupInvitationRequestObject) (gen.LookupInvitationResponseObject, error) {
	token := invitationToken(request.Params.XInvitationToken)
	if token == "" {
		return gen.LookupInvitation400JSONResponse(errorBody("Invitation token header is required")), nil
	}

	invitation, status, err := s.pendingInvitation(ctx, token)
	if err != nil {
		return nil, err
	}
	switch status {
	case invitationMissing:
		return gen.LookupInvitation404JSONResponse(errorBody("Invitation not found or no longer valid")), nil
	case invitationExpired:
		return gen.LookupInvitation410JSONResponse(errorBody("This invitation has expired")), nil
	}

	existing, err := s.Repo.FindUserByEmail(ctx, invitation.Email)
	if err != nil {
		return nil, err
	}
	household, err := s.Repo.GetHouseholdByID(ctx, invitation.HouseholdID)
	if err != nil {
		return nil, err
	}
	inviter, err := s.Repo.FindUserByID(ctx, invitation.InvitedByUserID)
	if err != nil {
		return nil, err
	}

	body := gen.InvitationLookup{
		Invitation: invitationBody(*invitation),
		// Lets the invite page send someone who already has an account to
		// sign in rather than into a sign-up form that would refuse them.
		AccountExists: existing != nil,
	}
	// So the page can say who invited you and to what — the first thing a new
	// household member needs to know.
	if household != nil {
		body.Household = &struct {
			DisplayName string `json:"displayName"`
		}{DisplayName: household.DisplayName}
	}
	if inviter != nil {
		body.InvitedBy = &struct {
			Name string `json:"name"`
		}{Name: inviter.Name}
	}
	if viewer := viewerFrom(ctx); viewer != nil {
		body.Viewer = &struct {
			Email        string `json:"email"`
			EmailMatches bool   `json:"emailMatches"`
		}{
			Email:        viewer.Email,
			EmailMatches: strings.EqualFold(viewer.Email, invitation.Email),
		}
	}

	return gen.LookupInvitation200JSONResponse(body), nil
}

// AcceptInvitation turns an invitation into a membership, either for the
// signed-in caller or for an account created here and now.
//
// The two flows differ in more than a status code. A signed-in caller sends no
// credentials at all — they already have an account, and asking for a password
// again would be a phishing lesson — while an anonymous one must send both,
// and gets the session cookie for the account this request creates.
func (s server) AcceptInvitation(ctx context.Context, request gen.AcceptInvitationRequestObject) (gen.AcceptInvitationResponseObject, error) {
	token := invitationToken(request.Params.XInvitationToken)
	if token == "" {
		return gen.AcceptInvitation400JSONResponse(errorBody("Invitation token header is required")), nil
	}

	invitation, status, err := s.pendingInvitation(ctx, token)
	if err != nil {
		return nil, err
	}
	switch status {
	case invitationMissing:
		return gen.AcceptInvitation404JSONResponse(errorBody("Invitation not found or no longer valid")), nil
	case invitationExpired:
		return gen.AcceptInvitation410JSONResponse(errorBody("This invitation has expired")), nil
	}

	if viewer := viewerFrom(ctx); viewer != nil {
		return s.acceptAsViewer(ctx, *invitation, viewer)
	}
	return s.acceptAsNewAccount(ctx, *invitation, request.Body)
}

// acceptAsViewer accepts on behalf of the signed-in caller.
//
// A mismatched address is refused rather than quietly accepted under the
// signed-in account: an invitation names a person, and honouring it for
// whoever happens to be signed in on that browser would let a household member
// consume an invitation meant for someone else.
func (s server) acceptAsViewer(ctx context.Context, invitation repo.Invitation, viewer *auth.Session) (gen.AcceptInvitationResponseObject, error) {
	if !strings.EqualFold(viewer.Email, invitation.Email) {
		return gen.AcceptInvitation403JSONResponse(errorBody(
			"You are signed in as a different account. Sign out and accept the invitation with the invited email address.")), nil
	}

	if err := s.Repo.AcceptInvitation(ctx, repo.AcceptInvitationInput{
		InvitationID:     invitation.ID,
		HouseholdID:      invitation.HouseholdID,
		AcceptedByUserID: viewer.UserID,
		Role:             invitation.Role,
	}); err != nil {
		applog.Event(applog.LevelError, "invitation_accept_failed", map[string]any{
			"invitationId": invitation.ID,
			"error":        err.Error(),
		})
		return gen.AcceptInvitation500JSONResponse(errorBody("Unable to accept invitation")), nil
	}

	household, err := s.Repo.GetHouseholdByID(ctx, invitation.HouseholdID)
	if err != nil {
		return nil, err
	}

	return gen.AcceptInvitation200JSONResponse{
		Member: gen.Member{
			Id:    viewer.UserID,
			Email: viewer.Email,
			Name:  viewer.Name,
			Role:  gen.MemberRole(invitation.Role),
		},
		Household: householdBody(household),
	}, nil
}

// acceptAsNewAccount creates the invited account and accepts in its name.
func (s server) acceptAsNewAccount(ctx context.Context, invitation repo.Invitation, body *gen.AcceptInvitationRequest) (gen.AcceptInvitationResponseObject, error) {
	name, password, invalid := acceptCredentials(body)
	if invalid != "" {
		return gen.AcceptInvitation400JSONResponse(errorBody(invalid)), nil
	}

	// An account for the invited address already exists — an earlier attempt
	// interrupted after sign-up, or simply somebody who already has one. They
	// are told to sign in, rather than being handed a bare "user already
	// exists" from the credential plugin that explains nothing about what to
	// do next. The code is what the SPA branches on to offer a sign-in link.
	existing, err := s.Repo.FindUserByEmail(ctx, invitation.Email)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return gen.AcceptInvitation409JSONResponse(errorCodeBody(
			"An account with the invited email already exists. Sign in with it, then open the invitation link again.",
			"ACCOUNT_EXISTS")), nil
	}

	userID, err := s.Auth.CreateUser(ctx, name, invitation.Email, password)
	if err != nil {
		applog.Event(applog.LevelError, "invitation_accept_failed", map[string]any{
			"invitationId": invitation.ID,
			"error":        err.Error(),
		})
		if errors.Is(err, auth.ErrPasswordLength) {
			// Never the sentinel's own text: it is written for a log
			// ("auth: …"), and this route answers with REF §A4's wording.
			return gen.AcceptInvitation400JSONResponse(
				errorBody("password: " + passwordLengthMessage(password))), nil
		}
		return gen.AcceptInvitation500JSONResponse(errorBody("Unable to accept invitation")), nil
	}

	if err := s.Repo.AcceptInvitation(ctx, repo.AcceptInvitationInput{
		InvitationID:     invitation.ID,
		HouseholdID:      invitation.HouseholdID,
		AcceptedByUserID: userID,
		Role:             invitation.Role,
	}); err != nil {
		applog.Event(applog.LevelError, "invitation_accept_failed", map[string]any{
			"invitationId": invitation.ID,
			"error":        err.Error(),
		})
		// Compensate: the account was created but the membership was not, so
		// the half-made account is removed and the invitee can simply open the
		// link again instead of being told their address is taken.
		if cleanupErr := s.Repo.DeleteUser(ctx, userID); cleanupErr != nil {
			applog.Event(applog.LevelError, "invitation_accept_failed", map[string]any{
				"invitationId": invitation.ID,
				"during":       "cleanup",
				"error":        cleanupErr.Error(),
			})
		}
		return gen.AcceptInvitation500JSONResponse(errorBody("Unable to accept invitation")), nil
	}

	household, err := s.Repo.GetHouseholdByID(ctx, invitation.HouseholdID)
	if err != nil {
		return nil, err
	}

	// Signed in as part of the same response, as in setup: the invitee has
	// just chosen a password and should not have to type it again on the next
	// screen. A session that could not be minted does not undo the accept —
	// the membership is real, and signing in is the ordinary way to reach it.
	if w, r, ok := middleware.HTTPFromContext(ctx); ok {
		if err := s.Auth.SignIn(ctx, w, r, userID); err != nil {
			applog.Event(applog.LevelError, "invitation_accept_failed", map[string]any{
				"invitationId": invitation.ID,
				"during":       "sign in",
				"error":        err.Error(),
			})
		}
	}

	return gen.AcceptInvitation201JSONResponse{
		Member: gen.Member{
			Id:    userID,
			Email: invitation.Email,
			Name:  name,
			Role:  gen.MemberRole(invitation.Role),
		},
		Household: householdBody(household),
	}, nil
}

// acceptCredentials applies REF §A4's `acceptInvitation` schema to an
// anonymous accept. Both properties are optional in the OpenAPI document —
// whether they are required depends on the session, which a schema cannot see
// — so the requirement and its messages live here.
//
// The message is the TypeScript's shape, "<path>: <message>", and carries no
// `fields`: this route reported only the first problem it found, and the invite
// page shows it as one line above the form.
func acceptCredentials(body *gen.AcceptInvitationRequest) (name, password, invalid string) {
	if body != nil {
		if body.Name != nil {
			name = strings.TrimSpace(*body.Name)
		}
		if body.Password != nil {
			password = *body.Password
		}
	}

	if problems := appendTextProblems(nil, "name", name, 80); len(problems) > 0 {
		return "", "", problems[0].field + ": " + problems[0].message
	}
	if problems := appendPasswordProblems(nil, password); len(problems) > 0 {
		return "", "", problems[0].field + ": " + problems[0].message
	}
	return name, password, ""
}

// invitationLookupStatus is what pendingInvitation found.
type invitationLookupStatus int

const (
	// invitationUsable: pending and not yet expired.
	invitationUsable invitationLookupStatus = iota
	// invitationMissing covers "no such token" AND "settled" (accepted,
	// cancelled, already expired by the sweep) with one answer, deliberately:
	// distinguishing them would tell a guesser that a token they tried was
	// real.
	invitationMissing
	invitationExpired
)

// pendingInvitation resolves a token to a usable invitation, applying the two
// refusals both routes share.
//
// The expiry is checked in memory against Deps.Now as well as by the nightly
// sweep that flips the status: an invitation that expired an hour ago has not
// been swept yet, and a link that works past its expiry because a cron job has
// not run is not an expiry at all.
func (s server) pendingInvitation(ctx context.Context, token string) (*repo.Invitation, invitationLookupStatus, error) {
	invitation, err := s.Repo.GetInvitationByTokenHash(ctx, security.HashInvitationToken(token))
	if err != nil {
		return nil, invitationMissing, err
	}
	if invitation == nil || invitation.Status != repo.InvitationPending {
		return nil, invitationMissing, nil
	}
	if repo.IsInvitationExpired(*invitation, s.Now()) {
		return nil, invitationExpired, nil
	}
	return invitation, invitationUsable, nil
}

// invitationToken normalises the header value: absent, empty and
// whitespace-only are all "no token".
func invitationToken(header *string) string {
	if header == nil {
		return ""
	}
	return strings.TrimSpace(*header)
}
