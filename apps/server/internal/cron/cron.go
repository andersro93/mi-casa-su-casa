// Package cron owns Mi Casa Su Casa's scheduled work: which jobs exist, when
// they fire, and the in-process scheduler that fires them. internal/jobs
// holds what each one DOES; the exit code a CLI invocation turns a run into
// belongs to cmd/mi-casa, which owns every process exit.
//
// One job, matching the single cron expression the Workers deployment
// carried in wrangler.jsonc:
//
//	retention  — 0 3 * * *    purge expired mail, expire invitations,
//	                          record the run, sweep both rate limiters
//
// Cloudflare guaranteed exactly one invocation per schedule however many
// isolates were warm. NOTHING guarantees that here: with several replicas,
// an in-process timer in every one of them would run the purge once per
// replica. The purge is idempotent, so that is wasteful rather than wrong —
// but it is still wrong enough to design against. That is why RunJob is
// exposed as a one-shot an external scheduler can invoke
// (`mi-casa cron retention`), and why StartScheduler runs only under the
// default single-container mode or the dedicated `worker` mode — never under
// `server`, which is what replicas run.
package cron

import (
	"context"
	"fmt"
	"log"
	"runtime/debug"
	"time"

	robfig "github.com/robfig/cron/v3"

	"github.com/andersro93/mi-casa-su-casa/server/internal/jobs"
)

// Jobs is every dispatchable job name, in the order `mi-casa cron` prints
// them in its usage line.
var Jobs = []string{"retention"}

// Schedules maps each job to its cron expression. Interpreted in UTC — see
// StartScheduler for why that is a contract rather than a default.
var Schedules = map[string]string{
	"retention": "0 3 * * *",
}

// IsJob reports whether name is a dispatchable job. Exact match: "Retention"
// and "retention " are not jobs, and a scheduled-job argument that misses by
// a character should fail loudly rather than nearly work.
func IsJob(name string) bool {
	for _, job := range Jobs {
		if job == name {
			return true
		}
	}
	return false
}

// RunJob runs one job to completion and returns the first error it hit.
//
// The job does its own logging (internal/jobs writes the runbook's
// retention_completed / retention_failed lines), so there is nothing to
// print here: this is dispatch and nothing else.
func RunJob(ctx context.Context, name string, d jobs.Deps) error {
	switch name {
	case "retention":
		_, err := jobs.Retention(ctx, d)
		return err
	default:
		// Never a silent no-op: an unrecognised name is what a typo'd
		// scheduled-job argument looks like, and a job that exits 0 having
		// done nothing is worse than one that fails.
		return fmt.Errorf("cron: unknown job %q (expected one of: %v)", name, Jobs)
	}
}

// schedulerStopGrace bounds how long the stop function returned by
// StartScheduler waits for an in-flight job before giving up on it. A purge
// that is mid-batch when SIGTERM arrives is worth a few seconds; one wedged
// on an unresponsive database is not worth hanging the whole shutdown for,
// because the orchestrator's own grace period will SIGKILL us anyway and an
// unbounded wait just turns a clean exit into a killed one. The purge is
// batched and idempotent, so an abandoned run simply resumes tomorrow.
const schedulerStopGrace = 10 * time.Second

// StartScheduler starts the in-process scheduler and returns a function that
// stops it.
//
// The location is UTC EXPLICITLY. robfig/cron defaults to time.Local and the
// image sets no TZ, so UTC would be an accident of the base image rather
// than a contract — while the 30-day retention window this job enforces is a
// privacy commitment stated in UTC. "0 3 * * *" resolves to 03:00Z under UTC
// and 01:00Z under Europe/Oslo, which is a silently wrong purge time and a
// silently wrong retention boundary.
//
// Every invocation goes through runSafely: robfig/cron runs each job in its
// own goroutine, so a panic inside one would take down the entire process
// rather than just that run (a goroutine panic is not recoverable by the
// caller). Catching it here turns a transient database blip into a logged
// line instead of a pod restart loop, and the job is rescheduled normally.
//
// NOTE: this fires once per replica. With more than one replica, drive the
// job from an external scheduler (or exactly one dedicated `worker` replica)
// rather than running `server` mode with this started too — see the package
// comment.
func StartScheduler(d jobs.Deps) func() {
	c := newScheduler(d)
	c.Start()

	return func() {
		stopped := c.Stop()
		select {
		case <-stopped.Done():
		case <-time.After(schedulerStopGrace):
			log.Printf("cron: stop grace elapsed with a job still running; leaving it behind")
		}
	}
}

// newScheduler builds the scheduler without starting it, so a test can read
// back the entries it computed (StartScheduler hands out only a stop func,
// deliberately: nothing in the program has any business reaching into the
// running scheduler).
func newScheduler(d jobs.Deps) *robfig.Cron {
	c := robfig.New(robfig.WithLocation(time.UTC))

	for _, job := range Jobs {
		if _, err := c.AddFunc(Schedules[job], func() {
			// A fresh background context per tick: the scheduler outlives
			// any single request and a job must not be cancelled by one.
			runSafely(context.Background(), job, func(ctx context.Context) error {
				return RunJob(ctx, job, d)
			})
		}); err != nil {
			// Schedules is a compile-time constant map validated by
			// cron_test.go; a parse failure here means the source was edited
			// to something invalid, which should be loud at boot rather than
			// a job that silently never runs.
			panic(fmt.Sprintf("cron: invalid schedule for %q: %v", job, err))
		}
	}
	return c
}

// runSafely runs fn, logging (never propagating) both a returned error and a
// panic: a panicking job must not kill the process.
func runSafely(ctx context.Context, name string, fn func(context.Context) error) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("cron: %s panicked: %v\n%s", name, r, debug.Stack())
		}
	}()
	if err := fn(ctx); err != nil {
		log.Printf("cron: %s failed: %v", name, err)
	}
}
