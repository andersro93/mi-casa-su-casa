package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

// validationSpec is a miniature API — one POST with a required body, one GET
// with a required query parameter — that exercises every branch of the
// validation error handler without dragging in the real spec, which would
// couple these assertions to whatever routes the product happens to have.
const validationSpec = `
openapi: 3.0.3
info:
  title: Validation fixture
  version: "1.0.0"
servers:
  - url: /
paths:
  /api/things:
    post:
      operationId: createThing
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, size]
              properties:
                name:
                  type: string
                  minLength: 1
                size:
                  type: integer
      responses:
        "200":
          description: Created.
  /api/widgets:
    get:
      operationId: listWidgets
      parameters:
        - name: limit
          in: query
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Listed.
`

// validated builds the middleware around a handler that records whether the
// request reached it and answers 200, so every test can state both halves of
// the contract: what the client sees, and whether the request got through.
func validated(t *testing.T) (http.Handler, *bool) {
	t.Helper()

	loader := openapi3.NewLoader()
	spec, err := loader.LoadFromData([]byte(validationSpec))
	if err != nil {
		t.Fatalf("load fixture spec: %v", err)
	}
	if err := spec.Validate(loader.Context); err != nil {
		t.Fatalf("fixture spec is invalid: %v", err)
	}

	reached := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})
	return withSpecValidation(spec, next), &reached
}

// post sends a JSON body to path and returns the recorded response.
func post(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// envelope is the failure body every rejection in this package writes.
type envelope struct {
	Error  string            `json:"error"`
	Fields map[string]string `json:"fields"`
}

// decodeEnvelope fails the test if the response is not the JSON envelope —
// a validation failure that answers with anything else (kin-openapi's own
// plain-text default, say) is exactly what this middleware exists to prevent.
func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) envelope {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	var body envelope
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not JSON (%v): %q", err, rec.Body.String())
	}
	return body
}

// A request the spec accepts must reach the handler untouched — including
// its body, which the validator has to read and put back.
func TestValidRequestReachesTheHandler(t *testing.T) {
	h, reached := validated(t)

	rec := post(t, h, "/api/things", `{"name":"lawn mower","size":2}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if !*reached {
		t.Error("handler was not reached")
	}
}

// The core case every later route relies on: a missing required property is
// a 400 whose `fields` names the input, keyed exactly as the property is in
// the request body.
func TestMissingRequiredFieldIsAFieldKeyed400(t *testing.T) {
	h, reached := validated(t)

	rec := post(t, h, "/api/things", `{"size":2}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if *reached {
		t.Error("an invalid request reached the handler")
	}
	body := decodeEnvelope(t, rec)
	message, ok := body.Fields["name"]
	if !ok {
		t.Fatalf("fields = %v, want an entry for \"name\"", body.Fields)
	}
	if message == "" {
		t.Error("fields[\"name\"] is empty")
	}
	if len(body.Fields) != 1 {
		t.Errorf("fields = %v, want only \"name\"", body.Fields)
	}
	if want := "name: " + message; body.Error != want {
		t.Errorf("error = %q, want %q", body.Error, want)
	}
}

// Every broken input, not just the first: the SPA renders one message per
// input, so the middleware must collect them all and the summary must list
// them in one readable line.
func TestEveryBrokenFieldIsReported(t *testing.T) {
	h, _ := validated(t)

	rec := post(t, h, "/api/things", `{"name":"","size":"big"}`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	body := decodeEnvelope(t, rec)
	for _, field := range []string{"name", "size"} {
		if body.Fields[field] == "" {
			t.Errorf("fields = %v, want an entry for %q", body.Fields, field)
		}
		if !strings.Contains(body.Error, field+": ") {
			t.Errorf("error = %q, want it to mention %q", body.Error, field)
		}
	}
	if !strings.Contains(body.Error, "; ") {
		t.Errorf("error = %q, want the two problems joined by \"; \"", body.Error)
	}
}

// A body that is the wrong shape outright has no property to blame, so it is
// keyed under `_` — the root path the TypeScript server used, which the SPA
// already knows how to render — and the summary is the bare message rather
// than "_: message".
func TestBodyLevelFailureIsKeyedUnderUnderscore(t *testing.T) {
	h, _ := validated(t)

	rec := post(t, h, "/api/things", `["not an object"]`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	body := decodeEnvelope(t, rec)
	message, ok := body.Fields["_"]
	if !ok {
		t.Fatalf("fields = %v, want an entry for \"_\"", body.Fields)
	}
	if body.Error != message {
		t.Errorf("error = %q, want the bare message %q with no \"_: \" prefix", body.Error, message)
	}
}

// Malformed JSON never reaches a handler's decoder, and the client is told
// what is actually wrong instead of kin-openapi's "failed to decode request
// body" — the message the TypeScript server sent for the same mistake.
func TestMalformedJSONIsRejectedWithoutFields(t *testing.T) {
	h, reached := validated(t)

	rec := post(t, h, "/api/things", `{"name":`)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	if *reached {
		t.Error("a malformed body reached the handler")
	}
	body := decodeEnvelope(t, rec)
	if body.Error != "Invalid JSON body" {
		t.Errorf("error = %q, want \"Invalid JSON body\"", body.Error)
	}
	if len(body.Fields) != 0 {
		t.Errorf("fields = %v, want none: there is no input to blame", body.Fields)
	}
}

// Parameters are inputs too: a missing required query parameter is keyed by
// the parameter's own name, so a client can point at the query it sent.
func TestMissingRequiredQueryParameterIsKeyedByName(t *testing.T) {
	h, _ := validated(t)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/widgets", nil))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %q)", rec.Code, rec.Body.String())
	}
	body := decodeEnvelope(t, rec)
	if body.Fields["limit"] == "" {
		t.Errorf("fields = %v, want an entry for \"limit\"", body.Fields)
	}
}

// A path the spec does not describe is a JSON 404 from here, not a fall
// through to the handler: the spec is the routing table, and an XHR that
// gets HTML back fails three layers from the actual mistake.
func TestUnknownPathIsAJSONNotFound(t *testing.T) {
	h, reached := validated(t)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/nope", nil))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body %q)", rec.Code, rec.Body.String())
	}
	if *reached {
		t.Error("an unknown path reached the handler")
	}
	if body := decodeEnvelope(t, rec); body.Error != "Not found" {
		t.Errorf("error = %q, want \"Not found\"", body.Error)
	}
}

// A known path with a method the spec does not define is a 405, not a 404:
// the resource exists, the verb does not.
func TestWrongMethodOnAKnownPathIsMethodNotAllowed(t *testing.T) {
	h, reached := validated(t)

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/things", nil))

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405 (body %q)", rec.Code, rec.Body.String())
	}
	if *reached {
		t.Error("a request with an undefined method reached the handler")
	}
	if body := decodeEnvelope(t, rec); body.Error != "Method not allowed" {
		t.Errorf("error = %q, want \"Method not allowed\"", body.Error)
	}
}
