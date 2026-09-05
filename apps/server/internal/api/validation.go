package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/respond"
)

// bodyRootField is the `fields` key for a problem with the request body as a
// whole rather than with one of its properties — a body that is missing, is
// an array where an object belongs, and so on. The TypeScript server used
// the same key (its zod issues had an empty path), so the SPA already knows
// to render it as a form-level message rather than next to an input.
const bodyRootField = "_"

// withSpecValidation checks every request against spec before it reaches
// next, and turns each way that can fail into this project's error envelope:
//
//	400 {"error": "name: is required", "fields": {"name": "is required"}}
//	404 {"error": "Not found"}          — no operation for this path
//	405 {"error": "Method not allowed"} — the path exists, the method doesn't
//
// This is the only place a malformed or ill-typed request is rejected, so
// route handlers below can trust that what reaches them matches the spec:
// required properties are present, types are right, enums hold. It runs
// ahead of the generated strict server's own json.Decode of the body, which
// would otherwise answer a broken body with oapi-codegen's plain-text
// default.
//
// The 404 is deliberate rather than a fall-through to next: the spec is this
// server's routing table, so a path it does not describe does not exist.
func withSpecValidation(spec *openapi3.T, next http.Handler) http.Handler {
	validate := nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		Options: openapi3filter.Options{
			// MultiError so a form with three bad inputs comes back with
			// three messages instead of only the first, which is what makes
			// `fields` worth having.
			MultiError: true,
			// Stated rather than left to the default: request bodies are the
			// half of validation the handlers below rely on most, so turning
			// this on by accident must be a visible edit.
			ExcludeRequestBody: false,
		},
		// The spec's `servers: [{url: /}]` entry is relative (no host) so
		// this would be inert either way; set explicitly so a future spec
		// change that adds an absolute server URL doesn't suddenly start
		// rejecting requests on a Host-header mismatch.
		DoNotValidateServers: true,
		ErrorHandlerWithOpts: writeValidationFailure,
	})
	return validate(next)
}

// writeValidationFailure is the middleware's ErrorHandlerWithOpts: it
// receives the raw kin-openapi error and answers with the project envelope.
//
// The middleware reports a routing failure by leaving MatchedRoute nil, and
// suggests 404 for both flavours of it, so the method-not-allowed case is
// separated out here — a client that used the wrong verb on a real path is
// told exactly that instead of being sent hunting for a typo in the URL.
func writeValidationFailure(_ context.Context, err error, w http.ResponseWriter, _ *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
	if opts.MatchedRoute == nil {
		if errors.Is(err, routers.ErrMethodNotAllowed) {
			respond.Error(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}
		respond.Error(w, http.StatusNotFound, "Not found")
		return
	}

	summary, fields := envelopeFor(collectProblems(err))
	if len(fields) == 0 {
		respond.Error(w, http.StatusBadRequest, summary)
		return
	}
	respond.ErrorFields(w, http.StatusBadRequest, summary, fields)
}

// problem is one rejected input: the name the client knows it by (empty when
// no single input is to blame) and a message to show for it.
type problem struct {
	field   string
	message string
}

// envelopeFor turns the collected problems into the envelope's two halves:
// `fields` (first message per input wins, as the TypeScript server did) and
// the human summary, which is those same messages as "field: message"
// joined by "; " — minus the prefix when the message already names the field
// or when the whole body is at fault.
func envelopeFor(problems []problem) (summary string, fields map[string]string) {
	fields = make(map[string]string, len(problems))
	parts := make([]string, 0, len(problems))
	for _, p := range problems {
		if p.field != "" {
			if _, duplicate := fields[p.field]; duplicate {
				continue
			}
			fields[p.field] = p.message
		}
		parts = append(parts, summarize(p))
	}

	summary = strings.Join(parts, "; ")
	if summary == "" {
		summary = "Invalid request"
	}
	return summary, fields
}

// summarize renders one problem for the summary line.
func summarize(p problem) string {
	if p.field == "" || p.field == bodyRootField || strings.HasPrefix(p.message, p.field) {
		return p.message
	}
	return p.field + ": " + p.message
}

// collectProblems walks a kin-openapi validation error — a tree of
// MultiErrors, one RequestError per rejected parameter or body, and one
// SchemaError per rule the value broke — and flattens it into the problems
// the envelope is built from.
func collectProblems(err error) []problem {
	switch e := err.(type) {
	case openapi3.MultiError:
		var problems []problem
		for _, inner := range e {
			problems = append(problems, collectProblems(inner)...)
		}
		return problems
	case *openapi3filter.RequestError:
		return requestProblems(e)
	case *openapi3.SchemaError:
		return []problem{{field: schemaField(e), message: schemaMessage(e)}}
	default:
		return []problem{{message: firstLine(err.Error())}}
	}
}

// requestProblems flattens one RequestError: kin-openapi reports which
// parameter or body failed here, and carries the schema-level detail inside.
func requestProblems(err *openapi3filter.RequestError) []problem {
	inner := []problem(nil)
	if err.Err != nil {
		inner = collectProblems(err.Err)
	}

	switch {
	case err.Parameter != nil:
		// A parameter has no property path of its own, so every message
		// about it is filed under the name the client sent it as.
		if len(inner) == 0 {
			return []problem{{field: err.Parameter.Name, message: reasonOf(err)}}
		}
		named := make([]problem, 0, len(inner))
		for _, p := range inner {
			named = append(named, problem{field: err.Parameter.Name, message: p.message})
		}
		return named
	case err.RequestBody != nil && errors.Is(err.Err, openapi3filter.ErrInvalidRequired):
		return []problem{{message: "Request body is required"}}
	case err.RequestBody != nil && err.Reason == "failed to decode request body":
		// Body-shaped but unparseable: there is no property to blame, and
		// "failed to decode request body" is not something to show a user.
		// The message the TypeScript server sent for the same mistake is.
		return []problem{{message: "Invalid JSON body"}}
	case len(inner) > 0:
		// Schema failures: each already carries its own property path.
		return inner
	default:
		return []problem{{message: reasonOf(err)}}
	}
}

// schemaField names the property a SchemaError is about, as the client
// spelled it in the request body ("items.0.name" for a nested one), falling
// back to the body-root key when the whole value is at fault.
func schemaField(err *openapi3.SchemaError) string {
	path := err.JSONPointer()
	if len(path) == 0 {
		return bodyRootField
	}
	return strings.Join(path, ".")
}

// schemaMessage is the showable half of a SchemaError. Its Error() is
// deliberately not used: it appends the whole schema and the offending value
// to the message, which is both unreadable and a way to echo submitted data
// back at whoever sent it.
func schemaMessage(err *openapi3.SchemaError) string {
	switch {
	case err.Reason != "":
		return err.Reason
	case err.Origin != nil:
		return firstLine(err.Origin.Error())
	default:
		return fmt.Sprintf("does not match schema %q", err.SchemaField)
	}
}

// reasonOf is a RequestError's own message, without the wrapped cause its
// Error() would append (that cause, when there is one, has already been
// walked into its own problems).
func reasonOf(err *openapi3filter.RequestError) string {
	if err.Reason != "" {
		return err.Reason
	}
	return firstLine(err.Error())
}

// firstLine keeps error text to one line: kin-openapi's own messages run to
// several, with the schema and the value dumped underneath.
func firstLine(message string) string {
	line, _, _ := strings.Cut(message, "\n")
	return line
}
