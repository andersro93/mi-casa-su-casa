package domain

import (
	"strings"
	"testing"
)

// Ports test/household-slug.test.ts.
func TestValidateHouseholdSlug_AcceptsOrdinarySlugs(t *testing.T) {
	for _, slug := range []string{"casa", "smith-family", "home2", "ab"} {
		if err := ValidateHouseholdSlug(slug); err != nil {
			t.Errorf("ValidateHouseholdSlug(%q) = %v, want nil", slug, err)
		}
	}
}

func TestValidateHouseholdSlug_RejectsReservedMalformedAndOversized(t *testing.T) {
	for _, slug := range []string{
		"members",
		"settings",
		"api",
		"invite",
		"two-factor",
		"postmaster",
		"-casa",
		"casa-",
		"Casa",
		"ca sa",
		"a",
		strings.Repeat("x", 41),
		"",
	} {
		if err := ValidateHouseholdSlug(slug); err == nil {
			t.Errorf("ValidateHouseholdSlug(%q) = nil, want an error", slug)
		}
	}
}

// The Go server serves /healthz and /readyz, which the Workers original did
// not have, so both must join the reserved set (REF §A3, "Household slug").
func TestValidateHouseholdSlug_RejectsGoOnlyHealthRoutes(t *testing.T) {
	for _, slug := range []string{"healthz", "readyz"} {
		err := ValidateHouseholdSlug(slug)
		if err == nil {
			t.Fatalf("ValidateHouseholdSlug(%q) = nil, want a reserved-slug error", slug)
		}
		want := `"` + slug + `" is reserved and cannot be used as a household slug`
		if err.Error() != want {
			t.Errorf("ValidateHouseholdSlug(%q) = %q, want %q", slug, err.Error(), want)
		}
	}
}

// The SPA renders these strings verbatim, so they are part of the contract
// (REF §A3, "Household slug").
func TestValidateHouseholdSlug_ErrorMessages(t *testing.T) {
	cases := []struct {
		name string
		slug string
		want string
	}{
		{
			name: "empty",
			slug: "",
			want: "slug is required",
		},
		{
			name: "too short",
			slug: "a",
			want: "slug must be between 2 and 40 characters",
		},
		{
			name: "too long",
			slug: strings.Repeat("x", 41),
			want: "slug must be between 2 and 40 characters",
		},
		{
			name: "uppercase",
			slug: "Casa",
			want: "slug may only contain lowercase letters, numbers, and hyphens, and must start and end with a letter or number",
		},
		{
			name: "leading hyphen",
			slug: "-casa",
			want: "slug may only contain lowercase letters, numbers, and hyphens, and must start and end with a letter or number",
		},
		{
			name: "reserved",
			slug: "members",
			want: `"members" is reserved and cannot be used as a household slug`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateHouseholdSlug(tc.slug)
			if err == nil {
				t.Fatalf("ValidateHouseholdSlug(%q) = nil, want %q", tc.slug, tc.want)
			}
			if err.Error() != tc.want {
				t.Errorf("ValidateHouseholdSlug(%q) = %q, want %q", tc.slug, err.Error(), tc.want)
			}
		})
	}
}

// The bounds are exported because the SPA and the OpenAPI schema repeat them.
func TestHouseholdSlugLengthBounds(t *testing.T) {
	if HouseholdSlugMinLength != 2 || HouseholdSlugMaxLength != 40 {
		t.Errorf("slug bounds = %d..%d, want 2..40", HouseholdSlugMinLength, HouseholdSlugMaxLength)
	}
	if err := ValidateHouseholdSlug(strings.Repeat("x", HouseholdSlugMaxLength)); err != nil {
		t.Errorf("a slug of exactly the maximum length was rejected: %v", err)
	}
}

func TestNormalizeHouseholdSlug(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{in: "  Casa ", want: "casa"},
		{in: "CASA", want: "casa"},
		{in: "", want: ""},
		{in: "   ", want: ""},
		{in: "\tSmith-Family\n", want: "smith-family"},
	}

	for _, tc := range cases {
		if got := NormalizeHouseholdSlug(tc.in); got != tc.want {
			t.Errorf("NormalizeHouseholdSlug(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// The reserved set is exported so the setup flow can explain the rule; the
// TypeScript list plus the two Go-only health routes is what it must hold.
func TestReservedHouseholdSlugs(t *testing.T) {
	for _, slug := range []string{
		"api", "admin", "assets", "cdn-cgi", "favicon.ico", "forgot-password",
		"health", "households", "household", "inbox", "invite", "invitations",
		"login", "logout", "members", "new-household", "postmaster", "providers",
		"quarantine", "reset-password", "settings", "setup", "static",
		"two-factor", "abuse", "noreply", "no-reply", "hostmaster", "webmaster",
		"healthz", "readyz",
	} {
		if !ReservedHouseholdSlugs[slug] {
			t.Errorf("ReservedHouseholdSlugs is missing %q", slug)
		}
	}
	if len(ReservedHouseholdSlugs) != 31 {
		t.Errorf("ReservedHouseholdSlugs has %d entries, want 31", len(ReservedHouseholdSlugs))
	}
}
