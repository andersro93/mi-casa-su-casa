package ratelimit_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
)

// counting is an in-memory Store: the fixed-window arithmetic is the part
// worth testing here, and it is the same arithmetic whatever the counters
// are kept in. The Postgres store's own test (postgres_test.go) checks that
// the database half counts the way this fake does.
type counting struct {
	counts map[string]int
	err    error
}

func newCounting() *counting { return &counting{counts: map[string]int{}} }

func (c *counting) Hit(_ context.Context, key string, _ int) (int, error) {
	if c.err != nil {
		return 0, c.err
	}
	c.counts[key]++
	return c.counts[key], nil
}

func (c *counting) Sweep(context.Context, time.Time) (int, error) { return 0, c.err }

// windowStart is a time exactly on a window boundary, so a test can say
// "half a window later" without worrying which window it landed in.
func windowStart(rule ratelimit.Rule) time.Time {
	return time.Unix(1_700_000_000-1_700_000_000%int64(rule.WindowSeconds), 0).UTC()
}

func TestRulesMatchTheReference(t *testing.T) {
	for _, tc := range []struct {
		rule   ratelimit.Rule
		name   string
		window int
		max    int
	}{
		{ratelimit.Setup, "setup", 15 * 60, 5},
		{ratelimit.Invitations, "invitations", 10 * 60, 20},
		{ratelimit.HouseholdCreate, "household-create", 60 * 60, 10},
	} {
		if tc.rule.Name != tc.name || tc.rule.WindowSeconds != tc.window || tc.rule.Max != tc.max {
			t.Errorf("rule %+v, want {%s %d %d}", tc.rule, tc.name, tc.window, tc.max)
		}
	}
}

func TestKeyIsRuleClientAndWindow(t *testing.T) {
	rule := ratelimit.Setup
	start := windowStart(rule)

	if got, want := rule.Key("digest", start), "app:setup:digest:"+windowNumber(start, rule); got != want {
		t.Fatalf("Key = %q, want %q", got, want)
	}
	if a, b := rule.Key("digest", start), rule.Key("digest", start.Add(time.Duration(rule.WindowSeconds-1)*time.Second)); a != b {
		t.Fatalf("same window produced different keys: %q vs %q", a, b)
	}
	if a, b := rule.Key("digest", start), rule.Key("digest", start.Add(time.Duration(rule.WindowSeconds)*time.Second)); a == b {
		t.Fatalf("the next window reused key %q", a)
	}
	if a, b := rule.Key("one", start), rule.Key("two", start); a == b {
		t.Fatalf("two clients share key %q", a)
	}
}

// windowNumber spells the window arithmetic out rather than reusing the
// implementation, so a change to the key layout has to be made deliberately
// in two places.
func windowNumber(at time.Time, rule ratelimit.Rule) string {
	return strconv.FormatInt(at.Unix()/int64(rule.WindowSeconds), 10)
}

func TestConsumeAllowsUpToTheMaximumThenBlocks(t *testing.T) {
	store := newCounting()
	rule := ratelimit.Setup
	now := windowStart(rule).Add(time.Second)

	for attempt := 1; attempt <= rule.Max; attempt++ {
		decision, err := ratelimit.Consume(context.Background(), store, rule, "client-a", now)
		if err != nil {
			t.Fatalf("attempt %d: %v", attempt, err)
		}
		if !decision.Allowed {
			t.Fatalf("attempt %d of %d was blocked", attempt, rule.Max)
		}
		if want := rule.Max - attempt; decision.Remaining != want {
			t.Errorf("attempt %d remaining = %d, want %d", attempt, decision.Remaining, want)
		}
	}

	blocked, err := ratelimit.Consume(context.Background(), store, rule, "client-a", now)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if blocked.Allowed {
		t.Fatalf("attempt %d was allowed, want blocked", rule.Max+1)
	}
	if blocked.RetryAfterSeconds < 1 || blocked.RetryAfterSeconds > rule.WindowSeconds {
		t.Fatalf("RetryAfterSeconds = %d, want between 1 and %d", blocked.RetryAfterSeconds, rule.WindowSeconds)
	}
}

func TestConsumeCountsEachClientSeparately(t *testing.T) {
	store := newCounting()
	rule := ratelimit.Setup
	now := windowStart(rule).Add(time.Second)

	for attempt := 0; attempt <= rule.Max; attempt++ {
		if _, err := ratelimit.Consume(context.Background(), store, rule, "client-a", now); err != nil {
			t.Fatalf("Consume: %v", err)
		}
	}

	other, err := ratelimit.Consume(context.Background(), store, rule, "client-b", now)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !other.Allowed {
		t.Fatal("a second client was blocked by the first client's attempts")
	}
}

func TestConsumeStartsAFreshCountInTheNextWindow(t *testing.T) {
	store := newCounting()
	rule := ratelimit.Setup
	now := windowStart(rule).Add(time.Second)

	for attempt := 0; attempt <= rule.Max; attempt++ {
		if _, err := ratelimit.Consume(context.Background(), store, rule, "client-a", now); err != nil {
			t.Fatalf("Consume: %v", err)
		}
	}

	later := now.Add(time.Duration(rule.WindowSeconds) * time.Second)
	decision, err := ratelimit.Consume(context.Background(), store, rule, "client-a", later)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !decision.Allowed {
		t.Fatal("the window did not reset: still blocked a full window later")
	}
}

func TestRetryAfterIsTheRemainderOfTheWindow(t *testing.T) {
	rule := ratelimit.Setup
	start := windowStart(rule)

	if got := rule.RetryAfter(start); got != rule.WindowSeconds {
		t.Errorf("RetryAfter at the window start = %d, want %d", got, rule.WindowSeconds)
	}
	if got := rule.RetryAfter(start.Add(time.Duration(rule.WindowSeconds-1) * time.Second)); got != 1 {
		t.Errorf("RetryAfter one second before the window end = %d, want 1", got)
	}
	// Never zero: a Retry-After of 0 invites an immediate retry that is
	// certain to be rejected again.
	almost := start.Add(time.Duration(rule.WindowSeconds)*time.Second - time.Millisecond)
	if got := rule.RetryAfter(almost); got < 1 {
		t.Errorf("RetryAfter = %d, want at least 1", got)
	}
}
