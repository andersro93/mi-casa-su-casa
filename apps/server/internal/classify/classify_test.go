package classify_test

import (
	"context"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/classify"
	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
	"github.com/andersro93/mi-casa-su-casa/server/internal/mail"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports the `classifyEmail` block of test/classify-email.test.ts (REF §A3,
// "Classification"). The TypeScript mocked both repositories; here the
// households, providers and sender rules are real rows, so the step-4 lookup
// is exercised along with the steps around it. The `authenticationVerdict`
// block of the same file is ported in internal/domain/verdict_test.go.

func ctx(t *testing.T) context.Context {
	t.Helper()
	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return c
}

func setup(t *testing.T) (*repo.Repo, *testrig.Rig) {
	t.Helper()
	rig := testrig.Setup(t)
	return repo.New(rig.Pool), rig
}

// household seeds an owner and the household they own, the fixture every
// classification starts from.
func household(t *testing.T, r *repo.Repo, rig *testrig.Rig, slug string) repo.Household {
	t.Helper()
	if _, err := rig.Pool.Exec(ctx(t),
		`INSERT INTO "users" ("id", "email", "name") VALUES ($1, $2, $3)`,
		"user-"+slug, "owner-"+slug+"@example.com", "Owner",
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	h, err := r.CreateHousehold(ctx(t), slug, slug, "user-"+slug)
	if err != nil {
		t.Fatalf("CreateHousehold(%q): %v", slug, err)
	}
	return h
}

// provider seeds a provider with one sender rule.
func provider(t *testing.T, r *repo.Repo, householdID, key, matchType, matchValue string) repo.Provider {
	t.Helper()
	p, err := r.CreateProvider(ctx(t), householdID, key, key)
	if err != nil {
		t.Fatalf("CreateProvider(%q): %v", key, err)
	}
	if _, err := r.CreateSenderRule(ctx(t), householdID, p.ID, matchType, matchValue); err != nil {
		t.Fatalf("CreateSenderRule(%q %q): %v", matchType, matchValue, err)
	}
	return p
}

func strptr(v string) *string { return &v }

// parsedEmail is the Go counterpart of the TypeScript createParsedEmail.
func parsedEmail() *mail.Parsed {
	return &mail.Parsed{
		EnvelopeFrom:  "login@service.example",
		EnvelopeTo:    "casa@example.com",
		HouseholdSlug: strptr("casa"),
		FromHeader:    strptr("Service <login@service.example>"),
		Subject:       strptr("Your verification code"),
		MessageID:     "<test-1@example.com>",
		DateHeader:    strptr("Sun, 10 May 2026 12:00:00 +0000"),
		TextBody:      "Your verification code is 123456",
		RawSize:       123,
	}
}

func auth(spf, dkim, dmarc string) *domain.Authentication {
	a := &domain.Authentication{}
	if spf != "" {
		a.SPF = &spf
	}
	if dkim != "" {
		a.DKIM = &dkim
	}
	if dmarc != "" {
		a.DMARC = &dmarc
	}
	return a
}

func classified(t *testing.T, r *repo.Repo, parsed *mail.Parsed) classify.Classification {
	t.Helper()
	result, err := classify.Classify(ctx(t), r, parsed)
	if err != nil {
		t.Fatalf("Classify: %v", err)
	}
	return result
}

func wantCode(t *testing.T, got *string, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Errorf("Code = %q, want nil", *got)
		}
		return
	}
	if got == nil || *got != want {
		t.Errorf("Code = %v, want %q", got, want)
	}
}

func TestClassifyMatchesAConfiguredProviderAndExtractsTheCode(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")
	p := provider(t, r, h.ID, "netflix", repo.MatchDomain, "service.example")

	got := classified(t, r, parsedEmail())

	if got.Kind != classify.KindMatched {
		t.Fatalf("Kind = %q, want matched", got.Kind)
	}
	if got.HouseholdID == nil || *got.HouseholdID != h.ID {
		t.Errorf("HouseholdID = %v, want %q", got.HouseholdID, h.ID)
	}
	if got.HouseholdSlug != "casa" || got.ProviderID != p.ID || got.ProviderKey != "netflix" {
		t.Errorf("match = (%q, %q, %q), want (casa, %q, netflix)",
			got.HouseholdSlug, got.ProviderID, got.ProviderKey, p.ID)
	}
	wantCode(t, got.Code, "123456")
	if got.Reason != "Sender matched a configured rule and a likely verification code was found." {
		t.Errorf("Reason = %q, want the with-code reason", got.Reason)
	}
}

func TestClassifyReportsAMatchWithoutACode(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")
	provider(t, r, h.ID, "netflix", repo.MatchExact, "login@service.example")

	parsed := parsedEmail()
	parsed.TextBody = "Welcome back, there is nothing to verify here."
	got := classified(t, r, parsed)

	if got.Kind != classify.KindMatched {
		t.Fatalf("Kind = %q, want matched", got.Kind)
	}
	wantCode(t, got.Code, "")
	if got.Reason != "Sender matched a configured rule." {
		t.Errorf("Reason = %q, want the plain matched reason", got.Reason)
	}
}

func TestClassifyQuarantinesWithinTheHouseholdWhenNoSenderRuleMatches(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")

	got := classified(t, r, parsedEmail())

	if got.Kind != classify.KindQuarantine {
		t.Fatalf("Kind = %q, want quarantine", got.Kind)
	}
	if got.HouseholdID == nil || *got.HouseholdID != h.ID {
		t.Errorf("HouseholdID = %v, want the resolved household %q", got.HouseholdID, h.ID)
	}
	if got.Reason != "No sender rule matched the inbound email within the addressed household." {
		t.Errorf("Reason = %q, want the no-rule reason", got.Reason)
	}
	// The code is extracted whatever the outcome, so the review screen can
	// still show it.
	wantCode(t, got.Code, "123456")
}

func TestClassifyReportsAnUnknownHouseholdWhenTheSlugDoesNotResolve(t *testing.T) {
	r, rig := setup(t)
	household(t, r, rig, "other")

	got := classified(t, r, parsedEmail())

	if got.Kind != classify.KindQuarantine || got.HouseholdID != nil {
		t.Fatalf("got = %+v, want a quarantine with no household", got)
	}
	if got.Reason != "No household matched the inbound recipient address." {
		t.Errorf("Reason = %q, want the unknown-household reason", got.Reason)
	}
	wantCode(t, got.Code, "123456")
}

func TestClassifyReportsAnUnknownHouseholdWhenTheRecipientHasNoUsableSlug(t *testing.T) {
	r, rig := setup(t)
	household(t, r, rig, "casa")

	parsed := parsedEmail()
	parsed.HouseholdSlug = nil
	got := classified(t, r, parsed)

	if got.Kind != classify.KindQuarantine || got.HouseholdID != nil {
		t.Fatalf("got = %+v, want a quarantine with no household", got)
	}
	if got.Reason != "No household slug could be resolved from the recipient address." {
		t.Errorf("Reason = %q, want the no-slug reason", got.Reason)
	}
	wantCode(t, got.Code, "123456")
}

func TestClassifyQuarantinesARuleMatchWhoseSenderFailedAuthentication(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")
	provider(t, r, h.ID, "netflix", repo.MatchDomain, "netflix.com")

	parsed := parsedEmail()
	parsed.EnvelopeFrom = "codes@netflix.com"
	parsed.FromAddress = strptr("attacker@attacker.example")
	parsed.Authentication = auth("fail", "pass", "pass")

	got := classified(t, r, parsed)

	if got.Kind != classify.KindQuarantine {
		t.Fatalf("Kind = %q, want quarantine", got.Kind)
	}
	if got.HouseholdID == nil || *got.HouseholdID != h.ID {
		t.Errorf("HouseholdID = %v, want %q", got.HouseholdID, h.ID)
	}
	want := "Sender codes@netflix.com matched provider netflix but sender authentication failed: " +
		"envelope sender not authenticated (spf=fail)."
	if got.Reason != want {
		t.Errorf("Reason = %q, want %q", got.Reason, want)
	}
	wantCode(t, got.Code, "123456")
}

func TestClassifyPrefersTheFromHeaderCandidateAndJudgesItAsSuch(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")
	provider(t, r, h.ID, "netflix", repo.MatchDomain, "netflix.com")

	parsed := parsedEmail()
	parsed.EnvelopeFrom = "bounce@sendgrid.example"
	parsed.FromAddress = strptr("info@netflix.com")
	// SPF passes for the envelope, but the rule matched the From header, so
	// only DKIM or DMARC can vouch for it.
	parsed.Authentication = auth("pass", "none", "none")

	got := classified(t, r, parsed)

	want := "Sender info@netflix.com matched provider netflix but sender authentication failed: " +
		"From header not authenticated (dkim=none, dmarc=none)."
	if got.Kind != classify.KindQuarantine || got.Reason != want {
		t.Errorf("got = (%q, %q), want a quarantine with %q", got.Kind, got.Reason, want)
	}
}

func TestClassifyTrustsAMatchWhenTheMessageCarriesNoAuthenticationHeader(t *testing.T) {
	r, rig := setup(t)
	h := household(t, r, rig, "casa")
	provider(t, r, h.ID, "netflix", repo.MatchExact, "login@service.example")

	parsed := parsedEmail()
	parsed.Authentication = nil

	if got := classified(t, r, parsed); got.Kind != classify.KindMatched {
		t.Errorf("Kind = %q, want matched when nothing asserted an authentication result", got.Kind)
	}
}
