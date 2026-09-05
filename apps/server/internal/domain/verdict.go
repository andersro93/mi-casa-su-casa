package domain

import "fmt"

// Ports the authenticationVerdict function of
// src/server/domain/classify-email.ts (REF §A3, "Classification" step 5).

// Authentication is what the receiving MTA asserted about a message, as
// parsed from its Authentication-Results headers. A nil field means the
// mechanism said nothing at all, which is why these are pointers rather than
// empty strings: "no verdict" and "a verdict of none" are different claims,
// even though the reason text renders both as "none".
type Authentication struct {
	SPF   *string
	DKIM  *string
	DMARC *string
}

// Source says which address a provider rule matched on, and therefore which
// mechanism has any bearing on it.
type Source string

const (
	// SourceHeader is the address in the From header, which is what DKIM
	// signs and DMARC aligns.
	SourceHeader Source = "header"
	// SourceEnvelope is the SMTP envelope sender, which is what SPF checks.
	SourceEnvelope Source = "envelope"
)

// Verdict decides whether a matched sender is trusted. reason is empty when
// trusted, and otherwise the text the caller writes into the quarantine row —
// the strings are the TypeScript ones verbatim, because rows written by the
// Workers deployment are still on display.
//
// The rule is asymmetric on purpose: SPF authenticates the envelope sender
// and says nothing about the From header, so a rule matched on the header
// needs DKIM or DMARC, and a rule matched on the envelope needs SPF. An
// explicit dmarc=fail is the domain owner's own verdict and outranks both.
func Verdict(auth *Authentication, source Source) (trusted bool, reason string) {
	// No Authentication-Results header at all: there is nothing to check, and
	// the provider rule has already matched. This is the Cloudflare-era
	// behaviour and stays, so a message from an MTA that does not annotate is
	// not quarantined wholesale.
	if auth == nil {
		return true, ""
	}

	if value(auth.DMARC) == "fail" {
		return false, "dmarc=fail"
	}

	if source == SourceHeader {
		if value(auth.DKIM) == "pass" || value(auth.DMARC) == "pass" {
			return true, ""
		}
		return false, fmt.Sprintf(
			"From header not authenticated (dkim=%s, dmarc=%s)",
			orNone(auth.DKIM), orNone(auth.DMARC),
		)
	}

	if value(auth.SPF) == "pass" {
		return true, ""
	}
	return false, fmt.Sprintf("envelope sender not authenticated (spf=%s)", orNone(auth.SPF))
}

func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// orNone renders a missing verdict the way the TypeScript `?? "none"` did.
func orNone(v *string) string {
	if v == nil {
		return "none"
	}
	return *v
}
