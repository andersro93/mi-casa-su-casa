package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

// The dispatch table is the container's whole contract with whatever runs
// it: `server` must never migrate, a typo must never boot a web server, and
// `cron` must never exit 0 having done nothing. parseArgs decides all of
// that, and it reads nothing and touches nothing, so it can be checked
// exhaustively here.
func TestParseArgs(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want dispatch
	}{
		{"no arguments migrates then serves", nil, dispatch{mode: modeDefault}},
		{"empty slice is the default mode", []string{}, dispatch{mode: modeDefault}},
		{"an empty argv[1] is the default mode", []string{""}, dispatch{mode: modeDefault}},

		{"server", []string{"server"}, dispatch{mode: modeServer, raw: "server"}},
		{"worker", []string{"worker"}, dispatch{mode: modeWorker, raw: "worker"}},
		{"migrate", []string{"migrate"}, dispatch{mode: modeMigrate, raw: "migrate"}},
		{"migrations is an alias for migrate", []string{"migrations"}, dispatch{mode: modeMigrate, raw: "migrations"}},
		{"healthcheck", []string{"healthcheck"}, dispatch{mode: modeHealthcheck, raw: "healthcheck"}},

		{"cron retention", []string{"cron", "retention"}, dispatch{mode: modeCron, raw: "cron", job: "retention"}},
		{"cron with no job at all", []string{"cron"}, dispatch{mode: modeCron, raw: "cron"}},
		// An unknown job stays `cron`: parseArgs does not know which jobs
		// exist (internal/cron does), and cronMode is where the name is
		// checked — so a bogus name reaches a usage error rather than the
		// generic unknown-mode one, which would name the wrong thing.
		{"cron bogus", []string{"cron", "bogus"}, dispatch{mode: modeCron, raw: "cron", job: "bogus"}},

		{"a typo is not the server", []string{"migrationz"}, dispatch{mode: modeUnknown, raw: "migrationz"}},
		{"case matters", []string{"Server"}, dispatch{mode: modeUnknown, raw: "Server"}},
		{"trailing arguments do not rescue an unknown mode", []string{"serve", "please"}, dispatch{mode: modeUnknown, raw: "serve"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseArgs(tc.args); got != tc.want {
				t.Errorf("parseArgs(%q) = %+v, want %+v", tc.args, got, tc.want)
			}
		})
	}
}

// A name that is not a job prints usage and exits 2, and does so BEFORE
// building anything — which is what lets this test run with no database in
// sight. A cronMode that constructed deps first would fail here on a missing
// DATABASE_URL and return 1, turning "you typed the job name wrong" into
// "the database is down".
func TestCronModeRejectsAnUnknownJobBeforeTouchingAnything(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	for _, job := range []string{"", "Retention", "retention ", "nonsense"} {
		if got := cronMode(job); got != 2 {
			t.Errorf("cronMode(%q) = %d, want 2", job, got)
		}
	}
}

// A real job name goes the other way: it is accepted, and the run fails on
// whatever comes next — here, unloadable configuration, which is exit 1 and
// not the usage code. That is the whole distinction a scheduler acts on: 2
// means "your manifest is wrong", 1 means "the run failed".
func TestCronModeAcceptsAKnownJobAndFailsOnConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if got := cronMode("retention"); got != 1 {
		t.Errorf("cronMode(retention) with unloadable config = %d, want 1", got)
	}
}

// probeHealthz is the body of what the image's HEALTHCHECK runs (the
// distroless image has no shell). Its whole job is turning one HTTP
// response into an exit code, so that mapping is what is tested.
func TestProbeHealthz(t *testing.T) {
	tests := []struct {
		name   string
		status int
		want   int
	}{
		{"200 is healthy", http.StatusOK, 0},
		{"503 is not", http.StatusServiceUnavailable, 1},
		{"500 is not", http.StatusInternalServerError, 1},
		{"404 is not", http.StatusNotFound, 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/healthz" {
					t.Errorf("probed %q, want /healthz", r.URL.Path)
				}
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()

			if got := probeHealthz(portOf(t, srv.URL)); got != tc.want {
				t.Errorf("probeHealthz = %d, want %d", got, tc.want)
			}
		})
	}
}

// A refused connection is the ordinary "the process is still booting" case,
// and must read as unhealthy rather than as an error the probe swallows.
func TestProbeHealthzUnreachablePortIsUnhealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	port := portOf(t, srv.URL)
	srv.Close() // nothing is listening on `port` any more

	if got := probeHealthz(port); got != 1 {
		t.Errorf("probeHealthz on a closed port = %d, want 1", got)
	}
}

// The probe reads PORT through internal/config like everything else, so a
// container whose configuration does not load reports unhealthy instead of
// probing a guessed default. An empty DATABASE_URL is enough to make
// config.FromOS fail regardless of what the developer has exported.
func TestHealthcheckModeIsUnhealthyWhenConfigurationIsBroken(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	if got := healthcheckMode(); got != 1 {
		t.Errorf("healthcheckMode with unloadable config = %d, want 1", got)
	}
}

// A worker is not an HTTP replica: it answers liveness so an orchestrator
// leaves it alone, and nothing else. Serving the API here would put a pod
// that is in no load balancer's rotation one misrouted proxy away from
// real traffic.
func TestWorkerHandlerServesOnlyHealthz(t *testing.T) {
	handler := workerHandler()

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want 200", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"ok":true}` {
		t.Errorf("body = %q, want {\"ok\":true}", got)
	}

	for _, path := range []string{"/readyz", "/api/setup/status", "/"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want 404 — the worker serves only /healthz", path, rec.Code)
		}
	}
}

// The drain log line names the signal, so "was this a rollout or somebody's
// Ctrl-C?" is answered by the log. os.Signal.String() would answer
// "terminated" / "interrupt" instead, which is not what anyone greps for.
func TestSignalName(t *testing.T) {
	if got := signalName(syscall.SIGTERM); got != "SIGTERM" {
		t.Errorf("signalName(SIGTERM) = %q, want \"SIGTERM\"", got)
	}
	if got := signalName(syscall.SIGINT); got != "SIGINT" {
		t.Errorf("signalName(SIGINT) = %q, want \"SIGINT\"", got)
	}
	if got := signalName(syscall.SIGHUP); got == "" {
		t.Error("signalName(SIGHUP) = \"\", want the stdlib description")
	}
}

func portOf(t *testing.T, rawURL string) int {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse %q: %v", rawURL, err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatalf("port of %q: %v", rawURL, err)
	}
	return port
}
