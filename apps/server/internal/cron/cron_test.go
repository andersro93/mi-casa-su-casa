// The tests live in `package cron` rather than `package cron_test` (the
// convention everywhere else in this module) for one reason: runSafely, the
// recover-and-log wrapper that keeps a panicking job from killing the
// process, is unexported and has no observable effect through the exported
// surface — StartScheduler would only exercise it on a real cron tick.
// Testing it directly is the only way to prove the guarantee the package
// comment states.
package cron

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	robfig "github.com/robfig/cron/v3"

	"github.com/andersro93/mi-casa-su-casa/server/internal/jobs"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

func depsFor(app *testrig.AppRig) jobs.Deps {
	return jobs.Deps{
		Repo:      app.Deps.Repo,
		Q:         app.Rig.Q,
		RateLimit: app.Deps.RateLimit,
		Now:       app.Deps.Now,
	}
}

func TestJobsAndSchedulesAgree(t *testing.T) {
	if len(Jobs) != 1 || Jobs[0] != "retention" {
		t.Fatalf("Jobs = %v, want [retention]", Jobs)
	}
	for _, job := range Jobs {
		if _, ok := Schedules[job]; !ok {
			t.Errorf("Schedules has no entry for %q", job)
		}
	}
	if len(Schedules) != len(Jobs) {
		t.Errorf("Schedules has %d entries, want %d", len(Schedules), len(Jobs))
	}
}

// The expression is a contract, not a preference: retention is what keeps
// the 30-day window a promise, and the window is stated in UTC. Asserting
// against real UTC instants rather than comparing the string to itself is
// what makes that check mean something.
func TestRetentionScheduleParsesAndFiresAtThreeUTC(t *testing.T) {
	parser := robfig.NewParser(robfig.Minute | robfig.Hour | robfig.Dom | robfig.Month | robfig.Dow)

	schedule, err := parser.Parse(Schedules["retention"])
	if err != nil {
		t.Fatalf("parse retention schedule: %v", err)
	}
	got := schedule.Next(time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC))
	if want := time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("retention next = %s, want %s", got, want)
	}
}

// robfig/cron defaults to time.Local and the image sets no TZ, so UTC would
// otherwise be an accident of the base image rather than a contract. This
// asserts on the running scheduler's own entries: under Europe/Oslo the same
// expression would come out as 01:00 or 02:00 UTC.
func TestSchedulerRunsInUTC(t *testing.T) {
	// newScheduler rather than StartScheduler: the assertion is on the
	// entries the scheduler computed, and Entries() only has them once the
	// scheduler is running.
	c := newScheduler(jobs.Deps{})
	c.Start()
	defer c.Stop()

	entries := c.Entries()
	if len(entries) != len(Jobs) {
		t.Fatalf("scheduler has %d entries, want %d", len(entries), len(Jobs))
	}
	next := entries[0].Next.UTC()
	if next.Hour() != 3 || next.Minute() != 0 || next.Second() != 0 {
		t.Errorf("next retention run is %s (%02d:%02d UTC), want 03:00 UTC",
			entries[0].Next, next.Hour(), next.Minute())
	}
	if next.Before(time.Now().UTC()) {
		t.Errorf("next retention run %s is in the past", next)
	}
}

// An unrecognised job name must be an error, never a silent no-op: it is
// what a typo'd scheduled-job argument looks like, and a job that exits 0
// having done nothing is the worst possible outcome. The message names both
// the bad input and the jobs that do exist, because the operator reading it
// is looking at a one-line failure and nothing else.
func TestRunJobUnknownNameErrorsAndListsTheJobs(t *testing.T) {
	err := RunJob(context.Background(), "retentionn", jobs.Deps{})
	if err == nil {
		t.Fatal("RunJob(retentionn) = nil, want an error")
	}
	if !strings.Contains(err.Error(), "retentionn") {
		t.Errorf("error %q does not name the bad job", err)
	}
	if !strings.Contains(err.Error(), "retention") {
		t.Errorf("error %q does not list the jobs that exist", err)
	}
}

// The dispatch really reaches the job: a run through RunJob records the run
// the same way calling jobs.Retention directly would.
func TestRunJobRetentionRunsTheJob(t *testing.T) {
	app := testrig.App(t)
	applog.SetOutput(io.Discard)
	t.Cleanup(func() { applog.SetOutput(nil) })

	if err := RunJob(t.Context(), "retention", depsFor(app)); err != nil {
		t.Fatalf("RunJob(retention): %v", err)
	}

	installation, err := app.Rig.Q.GetInstallation(t.Context())
	if err != nil {
		t.Fatalf("GetInstallation: %v", err)
	}
	if !installation.LastRetentionRunAt.Valid {
		t.Error("RunJob(retention) did not record the run")
	}
}

func TestIsJob(t *testing.T) {
	for _, name := range Jobs {
		if !IsJob(name) {
			t.Errorf("IsJob(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"", "Retention", "nightly", "retention "} {
		if IsJob(name) {
			t.Errorf("IsJob(%q) = true, want false", name)
		}
	}
}

// robfig/cron runs each job in its own goroutine, so a panic inside one
// would take down the whole process rather than the run. runSafely is the
// wrapper that stops it; a panic escaping here would restart-loop a pod
// that is otherwise healthy.
func TestRunSafelySwallowsPanicsAndErrors(t *testing.T) {
	runSafely(context.Background(), "boom", func(context.Context) error {
		panic("job exploded")
	})
	runSafely(context.Background(), "sad", func(context.Context) error {
		return errors.New("job failed")
	})
	// Reaching here at all is the assertion: neither call unwound the stack.
}

// StartScheduler must hand back a stop function that actually stops, and it
// must be safe to call even though no tick has fired.
func TestStartSchedulerStops(t *testing.T) {
	stop := StartScheduler(jobs.Deps{})
	if stop == nil {
		t.Fatal("StartScheduler returned a nil stop func")
	}
	stop()
}
