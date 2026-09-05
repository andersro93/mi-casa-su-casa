// Package invite is the invitation service three admin routes share: "invite
// somebody", "add a member" and "resend" are the same act with different
// inputs.
//
// It is deliberately NOT part of internal/domain, where the rest of this
// application's rules live. internal/repo and internal/mail both import
// domain (for the classification types), so a domain package reaching back
// for a repository and a mailer would be an import cycle — and the rule this
// package carries is a workflow over two collaborators rather than a pure
// function over values, which makes a package of its own the honest home for
// it.
package invite

import (
	"context"
	"strings"
	"time"

	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

// Ports src/server/domain/invitations.ts (REF §A3, "Invitations"): minting an
// invitation, mailing it, and reissuing one. The one rule worth stating out
// loud is this:
//
//	A FAILED EMAIL IS NOT A FAILED INVITATION.
//
// The record is written before the mail is attempted, and a transport that
// refuses the message is reported as `emailSent:false` plus `emailError`
// rather than raised. The owner still has `inviteUrl` and can paste it into
// whatever chat the household actually uses — which is the difference between
// a self-hosted installation with no SMTP credentials being usable and being
// bricked.

// InvitationTTL is REF §A3's invitation lifetime.
const TTL = 7 * 24 * time.Hour

// Inviter is the person issuing the invitation, as the invitation mail needs
// to name them.
type Inviter struct {
	ID    string
	Name  string
	Email string
}

// InviteInput is what an invitation is made of: who it is for, what they will
// be, and which providers they may read the moment they accept.
type Input struct {
	Email       string
	Name        string
	Role        string
	ProviderIDs []string
}

// InviteResult is the invitation, the link, and how delivery went. The link is
// the only place the plaintext token ever appears — the database holds its
// SHA-256 — so a caller that drops this value cannot recover it.
type Result struct {
	Invitation repo.Invitation
	InviteURL  string
	EmailSent  bool
	EmailError string
}

// InviteDeps is what inviting needs of the outside world: the store, the
// transport, the clock, and the base URL an invite link is built on. It is a
// struct rather than four parameters because two of the four (Now, AppURL) are
// easy to swap by accident when they are positional.
type Deps struct {
	Repo *repo.Repo
	Mail mail.Sender
	Now  func() time.Time

	// AppURL is the SPA's origin. A trailing slash is tolerated (the
	// TypeScript stripped one too), because an operator setting APP_URL by
	// hand will eventually type one.
	AppURL string
}

// Create writes a pending invitation, mails the link, and reports both.
//
// The order matters: the record is created first, so a transport failure
// leaves an invitation the owner can still act on. Its inverse — mail first,
// record second — would send links that point at nothing.
func Create(ctx context.Context, deps Deps, householdID string, inviter Inviter, in Input) (*Result, error) {
	token, tokenHash, err := security.NewInvitationToken()
	if err != nil {
		return nil, err
	}

	expiresAt := deps.Now().Add(TTL)
	invitationID, err := deps.Repo.CreateInvitation(ctx, repo.CreateInvitationInput{
		HouseholdID:     householdID,
		Email:           in.Email,
		Name:            in.Name,
		Role:            in.Role,
		TokenHash:       tokenHash,
		InvitedByUserID: inviter.ID,
		ExpiresAt:       expiresAt,
		ProviderIDs:     in.ProviderIDs,
	})
	if err != nil {
		return nil, err
	}

	invitation, err := deps.Repo.GetInvitationByID(ctx, householdID, invitationID)
	if err != nil {
		return nil, err
	}
	if invitation == nil {
		// The row was written a statement ago and is scoped to the same
		// household; nil here means something removed it in between, which is
		// the TypeScript's `return null` — the route answers 500.
		return nil, nil
	}

	result := &Result{
		Invitation: *invitation,
		InviteURL:  URL(deps.AppURL, token),
		EmailSent:  true,
	}

	err = deps.Mail.Send(ctx, mail.Invitation(mail.InvitationMail{
		To:           invitation.Email,
		InviteeName:  invitation.Name,
		InviterName:  inviter.Name,
		InviterEmail: inviter.Email,
		InviteURL:    result.InviteURL,
		// The same instant the record carries, in the same spelling the
		// invitation list shows.
		ExpiresAt: expiresAt.UTC().Format(time.RFC3339),
		Role:      invitation.Role,
	}))
	if err != nil {
		// REF §A3: reported, not raised. The log line is REF §A7's
		// `invitation_email_failed`; the address is in it because an operator
		// chasing "the invite never arrived" needs to know which one, and no
		// part of the token or the link is, because a log is not a place to
		// keep a credential.
		applog.Event(applog.LevelError, "invitation_email_failed", map[string]any{
			"invitationId": invitation.ID,
			"to":           invitation.Email,
			"error":        err.Error(),
		})
		result.EmailSent = false
		result.EmailError = err.Error()
	}

	return result, nil
}

// Resend cancels a pending invitation and issues a fresh one to the
// same person with the same role and provider scope.
//
// The old token stops working, which is the point rather than a side effect:
// "resend" is what an owner reaches for when the first link went to the wrong
// inbox, and leaving it live would make the button useless for exactly that.
//
// nil, nil means there was no pending invitation with that id in this
// household — the route answers 404 without saying which of the two it was.
func Resend(ctx context.Context, deps Deps, householdID string, inviter Inviter, invitationID string) (*Result, error) {
	existing, err := deps.Repo.GetInvitationByID(ctx, householdID, invitationID)
	if err != nil {
		return nil, err
	}
	if existing == nil || existing.Status != repo.InvitationPending {
		return nil, nil
	}

	if err := deps.Repo.CancelInvitation(ctx, householdID, invitationID); err != nil {
		return nil, err
	}

	providerIDs := make([]string, 0, len(existing.Providers))
	for _, provider := range existing.Providers {
		providerIDs = append(providerIDs, provider.ID)
	}

	return Create(ctx, deps, householdID, inviter, Input{
		Email:       existing.Email,
		Name:        existing.Name,
		Role:        existing.Role,
		ProviderIDs: providerIDs,
	})
}

// URL is where an invitation link points: REF §A3's
// `APP_URL/invite/<token>`, with any trailing slash on the base removed so the
// path never doubles up.
func URL(appURL, token string) string {
	return strings.TrimSuffix(appURL, "/") + "/invite/" + token
}
