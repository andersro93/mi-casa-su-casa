package mail

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Mailgun's inbound webhook contract (REF Part C, verified 2026-09-04) and the
// two guards in front of it.
//
// The Workers deployment had no counterpart to any of this: Cloudflare Email
// Routing handed the Worker a ForwardableEmailMessage, and the only
// authentication needed was that the message came from the platform's own
// runtime. Off Workers the same mail arrives as an ordinary HTTPS POST anybody
// on the internet can make, so the signature IS the authentication — without
// it a stranger could file a message with any code they liked into any
// household's inbox.
//
// Two independent checks, because the signature alone is not enough: a
// captured request stays valid forever unless something bounds its lifetime
// (the timestamp window) and stops the same one being replayed inside that
// window (the token guard).

// MaxRawMessageBytes bounds the `body-mime` field. Mailgun accepts messages up
// to 25 MB; verification mail is tiny, and REF §A3 rejects the rest early —
// the same 2 MiB limit the TypeScript handler applied to rawSize.
const MaxRawMessageBytes = 2 * 1024 * 1024

// MaxUnreviewedQuarantine is how many unreviewed quarantine rows a household
// may accumulate before further unmatched mail is refused (REF §A3).
const MaxUnreviewedQuarantine = 200

// SignatureWindow is how old a Mailgun timestamp may be (REF Part C). It is
// applied in both directions: a timestamp far in the FUTURE is as good a sign
// of a forged request as an ancient one, and letting one through would extend
// the replay window by however far ahead the attacker dared to date it.
const SignatureWindow = 5 * time.Minute

// ReplayWindow is how long a token is remembered. Longer than
// SignatureWindow on purpose: a request may arrive at the very edge of the
// timestamp window, and the token has to outlive the last moment its
// signature is still acceptable.
const ReplayWindow = 10 * time.Minute

// maxReplayTokens caps the guard's memory. Only requests that already passed
// the signature check reach it, so this is not a defence against flooding —
// it is the promise that a process which has been up for months, or one whose
// clock jumped, cannot grow this map without bound.
const maxReplayTokens = 100_000

// Rejection reasons, as they appear in the `inbound_rejected` log line. They
// are named constants because the handler logs one of them and the tests
// assert on it; the operator greps for these three strings.
const (
	ReasonSignature = "signature"
	ReasonStale     = "stale"
	ReasonReplay    = "replay"
)

// rejection is the error VerifyMailgunSignature returns, carrying the reason
// for the log. The reason never reaches the CALLER of the endpoint: Mailgun is
// told 401 and nothing else, so a prober cannot learn whether it got the key
// wrong or merely the clock.
type rejection struct{ reason string }

func (e rejection) Error() string { return "mail: mailgun request rejected: " + e.reason }

// ErrSignature, ErrStale and ErrReplay are the sentinels the handler matches
// with errors.Is when it wants to branch rather than merely log.
var (
	ErrSignature = rejection{ReasonSignature}
	ErrStale     = rejection{ReasonStale}
	ErrReplay    = rejection{ReasonReplay}
)

// RejectionReason extracts the reason from an error returned by
// VerifyMailgunSignature, or "" for any other error.
func RejectionReason(err error) string {
	var r rejection
	if errors.As(err, &r) {
		return r.reason
	}
	return ""
}

// VerifyMailgunSignature checks one webhook POST's authenticity: that
// `signature` is hex HMAC-SHA256 of `timestamp + token` under the account's
// HTTP webhook signing key, and that `timestamp` is a unix-seconds value
// within SignatureWindow of now.
//
// The timestamp is checked FIRST. Both checks must run for a request to be
// accepted, so the order changes nothing about what gets through; it means a
// request with an unusable timestamp is reported as stale rather than as a
// signature failure, which is the more useful line in the log when somebody's
// clock has drifted.
//
// The comparison is constant time (hmac.Equal): a byte-by-byte compare that
// returns early would leak, over enough tries, how much of a guessed
// signature was right.
func VerifyMailgunSignature(key, timestamp, token, signature string, now time.Time) error {
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return ErrStale
	}
	if delta := now.Sub(time.Unix(seconds, 0)); delta > SignatureWindow || delta < -SignatureWindow {
		return ErrStale
	}

	provided, err := hex.DecodeString(signature)
	if err != nil {
		return ErrSignature
	}

	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(token))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return ErrSignature
	}
	return nil
}

// ReplayGuard remembers the tokens of recently accepted webhook posts, so a
// captured request cannot be sent twice inside the window where its signature
// is still valid.
//
// In memory, deliberately: the guard has to answer in the request path, and a
// database round trip per inbound message would buy durability nobody needs.
// The cost is that a restart forgets everything and a second replica keeps its
// own set — a replay inside ten minutes of a restart, or aimed at another
// replica, would be accepted. What it would achieve is one DUPLICATE message,
// and duplicates are already swallowed downstream by the (household,
// message-id) uniqueness that makes ingest idempotent. The guard is the cheap
// half of the defence; the timestamp window is the half that always holds.
type ReplayGuard struct {
	mu   sync.Mutex
	seen map[string]time.Time // token -> when it stops counting as seen
}

// NewReplayGuard returns an empty guard, ready for concurrent use.
func NewReplayGuard() *ReplayGuard {
	return &ReplayGuard{seen: make(map[string]time.Time)}
}

// Seen records token and reports whether it had been presented before, within
// ReplayWindow of now. A nil guard reports false and remembers nothing, so a
// Deps built without one still serves.
//
// Expired entries are pruned on every insert rather than by a background
// goroutine: the map only grows when a request arrives, so that is exactly
// when it is worth walking, and it keeps the guard a value with no lifecycle
// of its own.
func (g *ReplayGuard) Seen(token string, now time.Time) bool {
	if g == nil {
		return false
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	if expiry, ok := g.seen[token]; ok && expiry.After(now) {
		return true
	}

	for candidate, expiry := range g.seen {
		if !expiry.After(now) {
			delete(g.seen, candidate)
		}
	}
	if len(g.seen) >= maxReplayTokens {
		g.evictOldest(len(g.seen) - maxReplayTokens/2)
	}

	g.seen[token] = now.Add(ReplayWindow)
	return false
}

// Len is how many tokens the guard currently remembers. It exists for the
// tests that prove pruning happens; nothing in the server reads it.
func (g *ReplayGuard) Len() int {
	if g == nil {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.seen)
}

// evictOldest drops the n entries closest to expiring. Reached only when the
// cap is hit with nothing expired to prune — a clock that jumped backwards, or
// a rate of accepted posts nobody expects — so the sort is affordable and
// dropping the oldest is the least wrong choice: those are the ones whose
// signatures are nearest to being unusable anyway.
func (g *ReplayGuard) evictOldest(n int) {
	if n <= 0 {
		return
	}
	tokens := make([]string, 0, len(g.seen))
	for token := range g.seen {
		tokens = append(tokens, token)
	}
	sort.Slice(tokens, func(i, j int) bool { return g.seen[tokens[i]].Before(g.seen[tokens[j]]) })
	for _, token := range tokens[:min(n, len(tokens))] {
		delete(g.seen, token)
	}
}
