// Package domain holds Mi Casa Su Casa's pure rules — the ones that decide
// what a household may be called, what counts as a verification code and
// whether an inbound sender authenticated. Nothing here talks to the
// database, the network or the clock, so every rule is a table test.
//
// The functions are ports of the TypeScript originals under src/server/domain
// and must keep their behaviour and their user-visible strings: the SPA
// renders the errors verbatim and existing quarantine rows carry the reasons.
package domain

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Ports src/server/domain/household-slug.ts.
//
// Household slugs double as URL path segments and inbound email local parts,
// so they must not collide with app routes or look like system mailboxes.

// ReservedHouseholdSlugs is the set of names a household may not take. It is
// the TypeScript RESERVED_HOUSEHOLD_SLUGS plus "healthz" and "readyz", which
// the Go server serves as liveness and readiness probes and the Workers
// original never had (REF §A3, "Household slug").
var ReservedHouseholdSlugs = map[string]bool{
	"api":             true,
	"admin":           true,
	"assets":          true,
	"cdn-cgi":         true,
	"favicon.ico":     true,
	"forgot-password": true,
	"health":          true,
	"households":      true,
	"household":       true,
	"inbox":           true,
	"invite":          true,
	"invitations":     true,
	"login":           true,
	"logout":          true,
	"members":         true,
	"new-household":   true,
	"postmaster":      true,
	"providers":       true,
	"quarantine":      true,
	"reset-password":  true,
	"settings":        true,
	"setup":           true,
	"static":          true,
	"two-factor":      true,
	"abuse":           true,
	"noreply":         true,
	"no-reply":        true,
	"hostmaster":      true,
	"webmaster":       true,

	// Go-only: the container's probe endpoints.
	"healthz": true,
	"readyz":  true,
}

// Slug length bounds, exported because the OpenAPI schema and the SPA repeat
// them in their own validation.
const (
	HouseholdSlugMinLength = 2
	HouseholdSlugMaxLength = 40
)

// The three fixed validation failures. They are sentinel values so a caller
// can tell them apart without matching on text, but their Error() strings are
// the TypeScript ones verbatim: the SPA renders them next to the input.
var (
	ErrSlugRequired = errors.New("slug is required")
	ErrSlugLength   = fmt.Errorf(
		"slug must be between %d and %d characters",
		HouseholdSlugMinLength, HouseholdSlugMaxLength,
	)
	ErrSlugCharacters = errors.New(
		"slug may only contain lowercase letters, numbers, and hyphens, " +
			"and must start and end with a letter or number",
	)
)

// slugPattern is the TypeScript SLUG_PATTERN unchanged: lower-case letters,
// digits and inner hyphens only.
var slugPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)

// NormalizeHouseholdSlug trims and lower-cases a candidate slug. It is what
// the routes apply before validating or looking up, so " Casa " and "casa"
// address the same household.
func NormalizeHouseholdSlug(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

// ValidateHouseholdSlug reports whether slug may name a household, returning
// nil when it may. The error texts are the TypeScript ones verbatim — the SPA
// shows them next to the input without translating.
//
// The slug is assumed to be normalised already; validation deliberately does
// not normalise, so "Casa" is rejected rather than quietly accepted under a
// different name.
func ValidateHouseholdSlug(slug string) error {
	if slug == "" {
		return ErrSlugRequired
	}
	// Counted in runes, not bytes: the TypeScript original counted UTF-16
	// units, and a non-ASCII slug should fail on the pattern below with the
	// message that explains the real problem, not on a byte count.
	if length := utf8.RuneCountInString(slug); length < HouseholdSlugMinLength || length > HouseholdSlugMaxLength {
		return ErrSlugLength
	}
	if !slugPattern.MatchString(slug) {
		return ErrSlugCharacters
	}
	if ReservedHouseholdSlugs[slug] {
		return fmt.Errorf("%q is reserved and cannot be used as a household slug", slug)
	}
	return nil
}
