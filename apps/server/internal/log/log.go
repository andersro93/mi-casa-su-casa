// Package log is this server's entire logging surface: one JSON object per
// line on stdout, each carrying an `event` name from the catalogue in
// REF §A7 plus whatever structured fields that event needs.
//
// Ported from src/server/runtime/log.ts. The Workers deployment wrote these
// lines with console.log so Workers Logs / Logpush could index them; a
// container writes them to stdout so the same lines land in `kubectl logs`,
// Loki or whatever the operator points at the stream. The shape is
// unchanged, because the operations runbook (docs/operations.md) tells
// people to grep for these event names.
//
// The one hard rule, restated from REF §A7 and enforced by review rather
// than by the compiler: never log message bodies or verification codes. An
// event says what happened and to which household; it never quotes what the
// email said.
package log

import (
	"context"
	"io"
	"log/slog"
	"os"
	"sort"
	"sync"
	"time"
)

// The three levels the catalogue uses. They are our own strings, written as
// the `level` field, and deliberately not slog's LevelInfo/WARN spelling:
// the log consumers were written against the TypeScript output and match on
// lower case.
const (
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
)

// output is guarded because SetOutput is called from tests while other
// goroutines may be logging. The handler is built once per writer rather
// than once per call so that all Events through it share the handler's own
// mutex — otherwise two goroutines could interleave halves of two lines
// into the same writer.
var (
	mu      sync.RWMutex
	handler slog.Handler = newHandler(os.Stdout)
)

// SetOutput redirects every subsequent Event to w. Passing nil restores
// stdout, which is what a test's cleanup does.
//
// It exists for tests: the production process logs to stdout and nothing
// else, since the container's supervisor is what routes the stream.
func SetOutput(w io.Writer) {
	if w == nil {
		w = os.Stdout
	}
	mu.Lock()
	defer mu.Unlock()
	handler = newHandler(w)
}

// Event writes one line: {"event": …, "level": …, …fields}.
//
// fields may be nil. Its keys are sorted so that two runs of the same code
// produce byte-identical lines — worth more than preserving a caller's map
// order, which Go does not preserve anyway.
func Event(level, event string, fields map[string]any) {
	attrs := make([]slog.Attr, 0, len(fields)+2)
	attrs = append(attrs, slog.String("event", event), slog.String("level", normalise(level)))

	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		attrs = append(attrs, slog.Any(key, fields[key]))
	}

	mu.RLock()
	h := handler
	mu.RUnlock()

	_ = h.Handle(context.Background(), record(level, attrs))
}

// record builds the slog.Record Handle consumes. The slog level carries no
// information the line does not already have — `level` is written as one of
// our own attributes — but a Record needs one, and a faithful mapping means
// a future handler swap (a filtering one, say) keeps working.
func record(level string, attrs []slog.Attr) slog.Record {
	rec := slog.NewRecord(zeroTime, slogLevel(level), "", 0)
	rec.AddAttrs(attrs...)
	return rec
}

// newHandler is the JSON handler with slog's own framing switched off: time,
// level and msg are dropped by dropBuiltin, leaving only the attributes
// Event adds, in the order it adds them.
//
// The time is dropped rather than kept because every consumer of these lines
// stamps its own receive time; two timestamps that disagree by a few
// milliseconds only ever cause arguments.
func newHandler(w io.Writer) slog.Handler {
	return slog.NewJSONHandler(w, &slog.HandlerOptions{
		Level:       slog.LevelDebug,
		ReplaceAttr: dropBuiltin,
	})
}

// dropBuiltin removes slog's built-in attributes. Returning the zero Attr
// tells the handler to omit it entirely.
//
// "level" needs care: it is both slog's built-in key and one of ours, and
// ReplaceAttr cannot see which of the two it is being handed except by the
// value's type — slog's is a slog.Level, ours is a plain string. Dropping by
// key alone would delete the field this package exists to write. The same
// holds for "msg", whose built-in is always empty here.
func dropBuiltin(groups []string, attr slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return attr
	}
	switch attr.Key {
	case slog.TimeKey:
		if attr.Value.Kind() == slog.KindTime {
			return slog.Attr{}
		}
	case slog.SourceKey:
		if _, isBuiltin := attr.Value.Any().(*slog.Source); isBuiltin {
			return slog.Attr{}
		}
	case slog.LevelKey:
		if _, isBuiltin := attr.Value.Any().(slog.Level); isBuiltin {
			return slog.Attr{}
		}
	case slog.MessageKey:
		if attr.Value.Kind() == slog.KindString && attr.Value.String() == "" {
			return slog.Attr{}
		}
	}
	return attr
}

// normalise maps anything that is not one of the catalogue's three levels to
// "info". A typo at a call site should not produce a line no dashboard
// matches; it should produce an ordinary informational line.
func normalise(level string) string {
	switch level {
	case LevelWarn:
		return LevelWarn
	case LevelError:
		return LevelError
	default:
		return LevelInfo
	}
}

func slogLevel(level string) slog.Level {
	switch level {
	case LevelWarn:
		return slog.LevelWarn
	case LevelError:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// zeroTime is the record's timestamp. slog omits a zero time before
// ReplaceAttr ever sees it, so the handler never formats a value that is
// thrown away.
var zeroTime time.Time
