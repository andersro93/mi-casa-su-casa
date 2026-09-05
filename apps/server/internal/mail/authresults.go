package mail

import (
	"regexp"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
)

// Ports parseAuthenticationResults from src/server/email/parse.ts
// (REF §A3, "Email parsing").

// authResultPattern finds `spf=`, `dkim=` and `dmarc=` verdicts anywhere in
// an Authentication-Results header. It is word-bounded so a property such as
// `xspf=pass` — or the `header.d=` and `smtp.mailfrom=` noise those headers
// are full of — cannot be read as a mechanism.
var authResultPattern = regexp.MustCompile(`(?i)\b(spf|dkim|dmarc)=([a-z]+)`)

// ParseAuthenticationResults reads the verdicts out of every
// Authentication-Results header on a message, keeping the first verdict seen
// per mechanism: the receiving MTA writes its own line first, and anything
// after it was added further upstream.
//
// nil means the message carried no such header at all, which
// domain.Verdict treats as "nothing to distrust". That is a different case
// from a header that asserted nothing, which yields a verdict with three nil
// mechanisms and is judged on its merits.
func ParseAuthenticationResults(values []string) *domain.Authentication {
	if len(values) == 0 {
		return nil
	}

	result := &domain.Authentication{}
	for _, value := range values {
		for _, match := range authResultPattern.FindAllStringSubmatch(value, -1) {
			verdict := strings.ToLower(match[2])
			switch strings.ToLower(match[1]) {
			case "spf":
				if result.SPF == nil {
					result.SPF = &verdict
				}
			case "dkim":
				if result.DKIM == nil {
					result.DKIM = &verdict
				}
			case "dmarc":
				if result.DMARC == nil {
					result.DMARC = &verdict
				}
			}
		}
	}
	return result
}
