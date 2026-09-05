// Package classify decides what happens to an inbound email: which
// household and provider it belongs to, or why it does not belong to any.
//
// It is a port of src/server/domain/classify-email.ts (REF §A3,
// "Classification"). It sits in its own package rather than in internal/mail
// or internal/domain because it is the one piece that needs both the parsed
// message and the database: internal/repo imports internal/mail for
// mail.Parsed, and internal/domain must not import internal/repo at all, so
// neither of those can host a function that takes a *repo.Repo.
package classify

import (
	"context"
	"fmt"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Kind is the outcome: a message attributed to a provider, or one held for
// review.
type Kind string

const (
	// KindMatched means the sender matched a configured rule and the match
	// was authenticated well enough to trust.
	KindMatched Kind = "matched"
	// KindQuarantine means the message is held for a human to look at.
	KindQuarantine Kind = "quarantine"
)

// Reasons, verbatim from the TypeScript. They are written into rows the
// needs-review screen displays, alongside rows the Workers deployment wrote,
// so the wording has to stay identical rather than merely equivalent.
const (
	ReasonNoSlug      = "No household slug could be resolved from the recipient address."
	ReasonNoHousehold = "No household matched the inbound recipient address."
	ReasonNoRule      = "No sender rule matched the inbound email within the addressed household."
	ReasonMatched     = "Sender matched a configured rule."
	ReasonMatchedCode = "Sender matched a configured rule and a likely verification code was found."
)

// Classification is what the ingest handler acts on.
//
// HouseholdID is nil only on a quarantine whose recipient named no household
// this installation knows — the case the handler rejects outright, because
// there is no row it could be stored against. HouseholdSlug, ProviderID and
// ProviderKey are set on a match only.
type Classification struct {
	Kind          Kind
	HouseholdID   *string
	HouseholdSlug string
	ProviderID    string
	ProviderKey   string
	// Code is the verification code found in the body, if any. It is
	// extracted whatever the outcome, so a quarantined message can still show
	// one on the review screen.
	Code   *string
	Reason string
}

// Classify runs REF §A3's six steps in order: extract the code, resolve the
// household from the recipient slug, match a sender rule, judge the match
// against the authentication verdicts, and report.
//
// Only a database failure returns an error. Every other outcome is a
// classification — an unknown sender is a quarantine, not a failure — so the
// handler above stores something for every message it accepts.
func Classify(ctx context.Context, r *repo.Repo, parsed *mail.Parsed) (Classification, error) {
	// Step 1. Always computed, so a quarantined message still shows its code.
	var code *string
	if found, ok := domain.ExtractVerificationCode(parsed.TextBody); ok {
		code = &found
	}

	// Step 2. Nothing in the recipient address named a household.
	if parsed.HouseholdSlug == nil {
		return quarantine(nil, ReasonNoSlug, code), nil
	}

	// Step 3. The slug named a household that does not exist here.
	household, err := r.GetHouseholdBySlug(ctx, *parsed.HouseholdSlug)
	if err != nil {
		return Classification{}, fmt.Errorf("classify: get household by slug: %w", err)
	}
	if household == nil {
		return quarantine(nil, ReasonNoHousehold, code), nil
	}

	// Step 4. The From address is tried before the envelope sender: it is the
	// one a person sees, so a household that pinned a rule to it means that
	// rule.
	match, err := r.FindProviderMatch(ctx, household.ID, senderCandidates(parsed))
	if err != nil {
		return Classification{}, fmt.Errorf("classify: find provider match: %w", err)
	}
	if match == nil {
		return quarantine(&household.ID, ReasonNoRule, code), nil
	}

	// Step 5. A rule match is not enough on its own: whichever address it
	// matched has to have been authenticated by the mechanism that covers it.
	if trusted, reason := domain.Verdict(parsed.Authentication, match.MatchedSource); !trusted {
		return quarantine(&household.ID, fmt.Sprintf(
			"Sender %s matched provider %s but sender authentication failed: %s.",
			match.MatchedAddress, match.ProviderKey, reason,
		), code), nil
	}

	// Step 6.
	reason := ReasonMatched
	if code != nil {
		reason = ReasonMatchedCode
	}
	return Classification{
		Kind:          KindMatched,
		HouseholdID:   &match.HouseholdID,
		HouseholdSlug: match.HouseholdSlug,
		ProviderID:    match.ProviderID,
		ProviderKey:   match.ProviderKey,
		Code:          code,
		Reason:        reason,
	}, nil
}

// senderCandidates lists the addresses a rule may match, in the order they
// are tried: the visible From address first, the envelope sender second.
func senderCandidates(parsed *mail.Parsed) []repo.Candidate {
	candidates := make([]repo.Candidate, 0, 2)
	if parsed.FromAddress != nil {
		candidates = append(candidates, repo.Candidate{
			Address: *parsed.FromAddress,
			Source:  domain.SourceHeader,
		})
	}
	return append(candidates, repo.Candidate{
		Address: parsed.EnvelopeFrom,
		Source:  domain.SourceEnvelope,
	})
}

func quarantine(householdID *string, reason string, code *string) Classification {
	return Classification{
		Kind:        KindQuarantine,
		HouseholdID: householdID,
		Code:        code,
		Reason:      reason,
	}
}
