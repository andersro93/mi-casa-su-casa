// Command mi-casa is the container's entrypoint and the application's
// composition root: the ONE place that reads the environment, opens the
// database pool and hands the assembled collaborators to internal/api.
// Every package below this one receives its dependencies; none of them
// reads os.Getenv or constructs a client at module scope.
//
// It is also the dispatch table. One image, several modes, selected by
// argv[1] — the Go port of the Workers deployment's separate entrypoints.
// See docs/superpowers/plans/2026-09-04-go-migration-reference.md for the
// authoritative table; the short version:
//
//	(none)                 migrate under an advisory lock, then serve + schedule
//	server                 HTTP only — never migrates, never schedules
//	worker                 scheduler only, plus a bare /healthz
//	migrate | migrations   apply migrations, exit 0/1
//	cron <job>             run one job, exit 0/1 (bad job: usage, exit 2)
//	healthcheck            probe /healthz on this pod, exit 0/1
//	anything else          complain, exit 2
//
// The scheduler itself arrives in P7; until then the `cron` and `worker`
// modes exist so the deployment contract is fixed, but neither runs a job.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	// The scratch/distroless image carries no /usr/share/zoneinfo, so
	// time.LoadLocation would fail there for every zone but UTC. Retention
	// windows and digest emails are reckoned in the household's local zone,
	// which must therefore resolve inside the container.
	_ "time/tzdata"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
	"github.com/andersro93/mi-casa-su-casa/server/internal/config"
	"github.com/andersro93/mi-casa-su-casa/server/internal/db"
	dbgen "github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/ratelimit"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/web"
)

// shutdownTimeout bounds how long a draining server waits for in-flight
// requests after SIGTERM. An orchestrator sends SIGTERM and then waits
// (30 seconds by default) before SIGKILL; draining inside that window is
// the difference between a rolling deploy that drops requests and one that
// does not. Deliberately under the default grace period, so we exit on our
// own terms rather than being killed mid-drain.
const shutdownTimeout = 20 * time.Second

// readHeaderTimeout caps how long a client may take to send its request
// headers — the slowloris brake. Only this one and idleTimeout are set:
// ReadTimeout and WriteTimeout would also cap the BODY, and inbound webhook
// payloads can be large and slow. The overall request budget belongs to
// whatever proxy sits in front of this process.
const readHeaderTimeout = 15 * time.Second

// idleTimeout closes keep-alive connections that go quiet, so a long-lived
// proxy does not accumulate sockets against us indefinitely.
const idleTimeout = 120 * time.Second

func main() {
	os.Exit(run(os.Args[1:]))
}

// run is main's testable body: it returns the process's exit code instead
// of calling os.Exit, so nothing below this line has to know it is a
// program.
func run(args []string) int {
	d := parseArgs(args)

	switch d.mode {
	case modeHealthcheck:
		// Deliberately opens no pool and builds no handler: it is a probe
		// of the process already running in this container, and the
		// distroless image has no shell for a curl-style one-liner.
		return healthcheckMode()

	case modeUnknown:
		// An unrecognised subcommand must NOT fall through to the server: a
		// typo'd `mi-casa migrationz` in a scheduled job would otherwise
		// silently become a pod that starts a web server and never
		// completes, instead of failing loudly.
		fmt.Fprintf(os.Stderr, "Unknown dispatch mode: %q. Expected one of: server, worker, migrate (or migrations), cron, healthcheck, or no argument to migrate-then-serve.\n", d.raw)
		return 2

	case modeMigrate:
		return migrateMode()

	case modeCron:
		return cronMode(d.job)

	case modeWorker:
		return workerMode()

	case modeServer:
		// HTTP only — no startup migration, no in-process scheduler. What
		// replicas run: migration is owned by the default mode's
		// advisory-locked step (or an explicit one-off `migrate`), and the
		// scheduler is owned by exactly one `worker` process, never by
		// every HTTP replica at once.
		return serveMode(false, false)

	case modeDefault:
		// No subcommand: migrate under an advisory lock (safe even if
		// several containers boot at once — see db.ApplyMigrations), then
		// serve with the in-process scheduler. What a plain `docker run`
		// exercises for a single-container deployment.
		return serveMode(true, true)
	}

	return 2
}

// --- dispatch parsing -------------------------------------------------

type dispatchMode int

const (
	modeDefault dispatchMode = iota
	modeServer
	modeWorker
	modeMigrate
	modeCron
	modeHealthcheck
	modeUnknown
)

// dispatch is a parsed command line. raw is argv[1] exactly as typed, kept
// so the unknown-mode message can quote what the operator actually wrote;
// job is argv[2] for `cron`, empty otherwise.
type dispatch struct {
	mode dispatchMode
	raw  string
	job  string
}

// parseArgs interprets os.Args[1:]. It reads the environment not at all and
// touches nothing, which is what makes the whole dispatch table testable.
func parseArgs(args []string) dispatch {
	if len(args) == 0 || args[0] == "" {
		return dispatch{mode: modeDefault}
	}

	raw := args[0]
	switch raw {
	case "server":
		return dispatch{mode: modeServer, raw: raw}
	case "worker":
		return dispatch{mode: modeWorker, raw: raw}
	case "migrate", "migrations":
		// `migrations` is an alias kept from the Workers deployment's
		// documented entrypoint; dropping it would break existing job
		// manifests for no gain.
		return dispatch{mode: modeMigrate, raw: raw}
	case "healthcheck":
		return dispatch{mode: modeHealthcheck, raw: raw}
	case "cron":
		job := ""
		if len(args) > 1 {
			job = args[1]
		}
		return dispatch{mode: modeCron, raw: raw, job: job}
	default:
		return dispatch{mode: modeUnknown, raw: raw}
	}
}

// --- healthcheck ------------------------------------------------------

// healthcheckMode probes this container's own /healthz and returns the exit
// code Docker's HEALTHCHECK (and any exec-style liveness probe) should see:
// 0 for a 2xx, 1 for anything else.
//
// The port comes from config.FromOS like every other setting — internal/
// config is the only package in this binary that reads the environment, and
// a second PORT default here is a second thing to get wrong. A container
// whose configuration does not load cannot be serving anything either, so
// reporting it unhealthy is the honest answer rather than a false negative.
func healthcheckMode() int {
	cfg, err := config.FromOS()
	if err != nil {
		log.Printf("configuration error: %v", err)
		return 1
	}
	return probeHealthz(cfg.Port)
}

// probeHealthz turns one HTTP response into an exit code: 0 for a 2xx, 1
// for anything else, including a refused connection.
//
// The timeout is short and explicit: a probe with no deadline can hang for
// as long as the kernel's connect timeout allows, and a HEALTHCHECK that
// never returns reads as "still checking" rather than "unhealthy" — the
// wrong answer for a wedged process.
func probeHealthz(port int) int {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", port))
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return 0
	}
	return 1
}

// --- migrate ----------------------------------------------------------

func migrateMode() int {
	cfg, err := config.FromOS()
	if err != nil {
		log.Printf("configuration error: %v", err)
		return 1
	}

	// context.Background, not a signal-cancelled context: aborting DDL
	// halfway is strictly worse than being SIGKILLed after the grace
	// period, and goose has already committed whatever migrations
	// completed.
	if err := db.ApplyMigrations(context.Background(), cfg.DatabaseURL); err != nil {
		log.Printf("migration failed: %v", err)
		return 1
	}
	log.Print("migrations applied")
	return 0
}

// --- cron -------------------------------------------------------------

// cronMode will run exactly one job and exit with a status a scheduler can
// act on — a failed retention pass should show up as a failed job, not as a
// line in a log nobody reads. The jobs themselves land in P7; until then
// every invocation is a usage error, because exiting 0 having done nothing
// is the one answer a scheduler must never get. The job name is accepted
// and ignored for now so the signature (and the dispatch table above it)
// does not change when the jobs land.
func cronMode(_ string) int {
	fmt.Fprintln(os.Stderr, "usage: mi-casa cron <retention>")
	return 2
}

// --- serve ------------------------------------------------------------

// serveMode is both the default mode (migrate=true, scheduler=true) and
// `server` mode (both false). Nothing else distinguishes them: `server`
// truly never migrates and never schedules.
func serveMode(migrate, scheduler bool) int {
	cfg, err := config.FromOS()
	if err != nil {
		log.Printf("configuration error: %v", err)
		return 1
	}

	sig, stopSignals := notifyShutdown()
	defer stopSignals()

	if migrate {
		// Guarded by a Postgres advisory lock, so several containers
		// booting at once serialise instead of racing to apply the same
		// DDL. Run on context.Background for the reason migrateMode
		// documents: a signal arriving mid-DDL should not abort it.
		if err := db.ApplyMigrations(context.Background(), cfg.DatabaseURL); err != nil {
			log.Printf("migration failed: %v", err)
			return 1
		}
	}

	// Startup is not cancelled by the shutdown signal either: a SIGTERM one
	// millisecond into boot should produce a process that came up and then
	// drained cleanly, not a half-built Deps and a confusing error.
	deps, closeDeps, err := buildDeps(context.Background(), cfg)
	if err != nil {
		log.Printf("startup failed: %v", err)
		return 1
	}
	defer closeDeps()

	srv := &http.Server{
		// ":port" rather than "0.0.0.0:port": it binds every interface,
		// IPv6 included, which is a superset of what a Docker healthcheck
		// (127.0.0.1) and an IPv6-only cluster each need.
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           web.Handler(api.NewHandler(deps)),
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}

	log.Printf("mi-casa listening on http://0.0.0.0:%d", cfg.Port)
	logStartupConfig(cfg)
	if scheduler {
		// P7 replaces this line with the in-process scheduler. It is logged
		// rather than silently skipped so a single-container deployment
		// does not look like it is running retention when it is not.
		log.Print("  scheduler: not yet implemented (arrives in P7)")
	}

	return serveUntilSignal(sig, srv)
}

// --- worker -----------------------------------------------------------

// workerMode will run ONLY the scheduler, for a deployment that scales the
// HTTP tier (`server` mode) horizontally but still wants one long-running
// process owning the cron-shaped work. Exactly one `worker` replica should
// run at a time. The scheduler arrives in P7; until then this mode boots
// its dependencies and serves nothing but the probe, which is enough to
// pin the deployment shape.
//
// The bare /healthz on PORT is not optional: the image's HEALTHCHECK probes
// /healthz regardless of mode, so without it a `worker` container would
// report unhealthy and get restart-looped by an orchestrator despite doing
// its job perfectly. It is deliberately the ONLY route: a worker is not an
// HTTP replica, and mounting the API here would let a misrouted proxy send
// real traffic to a pod that is not in the load balancer's rotation and
// answers no readiness question about it.
func workerMode() int {
	cfg, err := config.FromOS()
	if err != nil {
		log.Printf("configuration error: %v", err)
		return 1
	}

	sig, stopSignals := notifyShutdown()
	defer stopSignals()

	// The dependencies are built and discarded: P7's scheduler is what will
	// use them. Building them anyway keeps a worker that cannot reach the
	// database from booting into a healthy-looking process that does
	// nothing — the same boot-time failure the serving modes get.
	_, closeDeps, err := buildDeps(context.Background(), cfg)
	if err != nil {
		log.Printf("startup failed: %v", err)
		return 1
	}
	defer closeDeps()

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           workerHandler(),
		ReadHeaderTimeout: readHeaderTimeout,
		IdleTimeout:       idleTimeout,
	}

	log.Printf("mi-casa worker: healthz on http://0.0.0.0:%d", cfg.Port)
	log.Print("  scheduler: not yet implemented (arrives in P7)")
	logStartupConfig(cfg)

	return serveUntilSignal(sig, srv)
}

// workerHandler is the worker's entire HTTP surface: liveness and nothing
// else. It answers the same body package api's own probe does, by hand
// rather than through api.NewHandler, because the point is that no other
// route exists here.
func workerHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		respond.JSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	return mux
}

// --- shared plumbing --------------------------------------------------

// logStartupConfig prints the handful of settings worth having in the boot
// log: "why is mail going to the wrong domain?" should be answered by
// scrolling up rather than by an afternoon of debugging.
func logStartupConfig(cfg *config.Config) {
	log.Printf("  app url:      %s", cfg.AppURL)
	log.Printf("  email domain: %s", cfg.EmailDomain)
	log.Printf("  environment:  %s", cfg.Environment)
}

// notifyShutdown subscribes to SIGTERM and SIGINT and returns the channel
// they arrive on, plus an unsubscribe func.
//
// A channel rather than signal.NotifyContext because the channel hands back
// WHICH signal arrived, and the log line names it. "Was this an orchestrated
// rollout or did somebody Ctrl-C the container?" is the first question a
// shutdown log should answer, and a context can only say that something
// happened.
func notifyShutdown() (<-chan os.Signal, func()) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	return ch, func() { signal.Stop(ch) }
}

// signalName renders a signal the way an operator greps for it. os.Signal's
// own String() gives the DESCRIPTION — SIGTERM stringifies as "terminated"
// and SIGINT as "interrupt" — so logging the value directly produces
// "terminated received, shutting down", which is not what anyone searches a
// log for.
func signalName(s os.Signal) string {
	switch s {
	case syscall.SIGTERM:
		return "SIGTERM"
	case syscall.SIGINT:
		return "SIGINT"
	default:
		return s.String()
	}
}

// serveUntilSignal runs srv until it fails or a shutdown signal arrives on
// sig, then drains in-flight requests.
func serveUntilSignal(sig <-chan os.Signal, srv *http.Server) int {
	errc := make(chan error, 1)
	go func() {
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		// The listener died on its own — a port already in use, most
		// likely. ErrServerClosed cannot reach here (nothing has called
		// Shutdown yet), so any error is fatal.
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("server failed: %v", err)
			return 1
		}
		return 0

	case s := <-sig:
		log.Printf("%s received, shutting down", signalName(s))
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			// Requests still in flight when the deadline expired. Worth a
			// line, but not worth a non-zero exit: the process did what it
			// was asked and the orchestrator is about to replace it anyway.
			log.Printf("shutdown: %v", err)
		}
		return 0
	}
}

// --- composition ------------------------------------------------------

// buildDeps assembles every collaborator the API needs and returns a
// function that releases them. This is the only place in the program where
// a client is constructed from configuration.
//
// One builder for every mode, including `worker`, which serves no real
// request. Splitting it into "the bits jobs need" and "the bits routes
// need" would buy a few milliseconds of startup and cost a second
// construction path that can drift from this one — the failure mode being a
// job that behaves subtly differently from the same work done in-process.
func buildDeps(ctx context.Context, cfg *config.Config) (api.Deps, func(), error) {
	pool, err := db.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return api.Deps{}, nil, err
	}
	closePool := func() { pool.Close() }

	q := dbgen.New(pool)

	// Belt-and-braces alongside the migration's own seed row: every setup
	// and readiness read pins app_installation id 1, so a database restored
	// from a partial dump would otherwise fail those reads with "no rows".
	if err := q.EnsureInstallation(ctx); err != nil {
		closePool()
		return api.Deps{}, nil, err
	}

	repository := repo.New(pool)

	deps := api.Deps{
		Pool:             pool,
		Q:                q,
		Repo:             repository,
		RateLimit:        ratelimit.NewPostgres(repository),
		Now:              time.Now,
		AppURL:           cfg.AppURL,
		AppName:          cfg.AppName,
		EmailDomain:      cfg.EmailDomain,
		TrustedProxyHops: cfg.TrustedProxyHops,
		// Only "development" widens the same-site policy to a local dev
		// server; config.IsDevelopmentLike also covers "test", which must
		// not loosen a security check on a deployed environment.
		DevMode: cfg.Environment == "development",
	}
	return deps, closePool, nil
}
