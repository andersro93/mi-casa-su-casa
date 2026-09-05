package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// enforcePasswordMaxLength puts REF §A8's upper bound on the two routes that
// accept a new password over HTTP.
//
// The lower bound (12) is Limen's, configured on the credential plugin. There
// is no matching WithPasswordMaxLength, and the plugin's own validator checks
// only the minimum — so without this, `POST /passwords/reset` and
// `POST /passwords/change` would accept a megabyte-long password and hand it
// to Argon2id, which is a CPU denial-of-service that needs no account and, on
// reset, no session either. CreateUser enforces the same bound in Go; this is
// the same rule on the paths CreateUser does not own.
//
// It reads the body, checks it, and replays it downstream: Limen parses the
// body itself (parseAndStoreBody) and restores it for the handler, so the only
// requirement here is to hand it a request whose Body has not been consumed.
//
// Anything it cannot make sense of — a different route, a non-JSON body,
// malformed JSON, a new_password that is not a string — is passed through
// untouched. Limen's own validator is the authority on those; this middleware
// answers exactly one question.
func enforcePasswordMaxLength(next http.Handler) http.Handler {
	guarded := map[string]struct{}{
		BasePath + "/passwords/reset":  {},
		BasePath + "/passwords/change": {},
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := guarded[r.URL.Path]; !ok || r.Method != http.MethodPost || r.Body == nil {
			next.ServeHTTP(w, r)
			return
		}

		// One byte past the cap tells a body that is merely large from one
		// that is over it, without reading an attacker-chosen amount into
		// memory to find out.
		body, err := io.ReadAll(io.LimitReader(r.Body, maxPasswordRequestBody+1))
		_ = r.Body.Close()
		if err != nil {
			writeLimenError(w, http.StatusBadRequest, "could not read the request body")
			return
		}
		if len(body) > maxPasswordRequestBody {
			// A body this size cannot hold an acceptable password, whatever
			// else is in it, so it is refused with the same answer rather
			// than parsed.
			writeLimenError(w, http.StatusUnprocessableEntity, tooLongMessage)
			return
		}

		// Whatever happens below, the handler behind us must still be able to
		// read the body it would have read.
		r.Body = io.NopCloser(bytes.NewReader(body))

		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			next.ServeHTTP(w, r)
			return
		}
		if password, ok := payload["new_password"].(string); ok && len(password) > PasswordMaxLength {
			writeLimenError(w, http.StatusUnprocessableEntity, tooLongMessage)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// maxPasswordRequestBody caps the body these two routes may send at all. Both
// carry one password plus a token or a second password, so 8 KiB is orders of
// magnitude more than either needs and still small enough that reading it
// costs nothing.
const maxPasswordRequestBody = 8 << 10

// tooLongMessage is phrased exactly as Limen's own MaxLength validator phrases
// it ("<field> must have a length of at most <n>", validator.go), so a client
// cannot tell this guard from the plugin's own validation and needs no special
// case for it.
var tooLongMessage = fmt.Sprintf("new_password must have a length of at most %d", PasswordMaxLength)

// writeLimenError emits the body shape Limen's Responder emits for every
// error: {"message": …} as JSON, with the status on the response.
func writeLimenError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"message": message})
}
