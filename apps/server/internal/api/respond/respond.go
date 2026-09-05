// Package respond holds the JSON envelope every hand-written HTTP response
// in this server uses. The SPA reads exactly one shape for a failure —
// `{"error": "..."}`, optionally carrying `fields` (per-input validation
// messages) or `code` (a machine-readable discriminator) — so it lives in
// one place rather than being re-spelled at each call site.
//
// It is its own package rather than a file inside internal/api because the
// middleware that later tasks add writes the same envelope, and internal/api
// will import that middleware to build its handler; a helper living in
// internal/api would make that an import cycle. Nothing here knows about
// routing, so both sides can depend on it.
package respond

import (
	"encoding/json"
	"net/http"
)

// Envelope is the failure shape the SPA parses. Both optional members are
// omitted when empty: a response carrying an empty `fields: {}` invites a
// client to render an empty validation summary.
type Envelope struct {
	Error  string            `json:"error"`
	Fields map[string]string `json:"fields,omitempty"`
	Code   string            `json:"code,omitempty"`
}

// JSON encodes v as the response body with the given status. The header is
// written before the body, so nothing below may add headers afterwards.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Error writes the plain envelope: a human-readable message and nothing
// else. The common case by a wide margin.
func Error(w http.ResponseWriter, status int, message string) {
	JSON(w, status, Envelope{Error: message})
}

// ErrorFields writes the envelope with per-input messages, keyed by the
// field name the form uses — what a 400 from a validated body carries so
// the SPA can put each message next to its own input.
func ErrorFields(w http.ResponseWriter, status int, message string, fields map[string]string) {
	JSON(w, status, Envelope{Error: message, Fields: fields})
}

// ErrorCode writes the envelope with a stable machine-readable code, for
// the few failures the SPA must branch on rather than merely display.
func ErrorCode(w http.ResponseWriter, status int, message, code string) {
	JSON(w, status, Envelope{Error: message, Code: code})
}
