package auth

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/thecodearcher/limen"
)

// SessionFromRequest resolves the caller from the session cookie.
//
// Everything the app branches on is read off Limen's own validated session:
// the users row comes back as SELECT *, so the display name and the
// two-factor flag — columns of ours that Limen has no opinion about — are in
// User.Raw() without a second query.
func (s *service) SessionFromRequest(r *http.Request) (*Session, error) {
	validated, err := s.limen.GetSession(r)
	if err != nil {
		if isSignedOut(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("auth: validate session: %w", err)
	}
	if validated == nil || validated.User == nil || validated.Session == nil {
		return nil, nil
	}

	raw := validated.User.Raw()
	return &Session{
		UserID:           idString(validated.User.ID),
		Email:            validated.User.Email,
		Name:             rawString(raw, "name"),
		Token:            validated.Session.Token,
		SessionID:        idString(validated.Session.ID),
		TwoFactorEnabled: rawBool(raw, "two_factor_enabled"),
	}, nil
}

// isSignedOut reports whether err means "no valid session" rather than "the
// database is on fire". Matching sentinels keeps a real failure from being
// silently rendered as a signed-out page.
func isSignedOut(err error) bool {
	return errors.Is(err, limen.ErrSessionNotFound) ||
		errors.Is(err, limen.ErrSessionExpired) ||
		errors.Is(err, limen.ErrSessionInvalid) ||
		errors.Is(err, limen.ErrRecordNotFound)
}

// rawString and rawBool read one of our own columns out of the row Limen
// selected. A missing or wrongly-typed value yields the zero value rather
// than an error: these are display fields, and a nil image or an empty name
// is not a reason to refuse a request.
func rawString(raw map[string]any, column string) string {
	value, _ := raw[column].(string)
	return value
}

func rawBool(raw map[string]any, column string) bool {
	value, _ := raw[column].(bool)
	return value
}
