package api

import "net/http"

// jsonContentType is what every JSON response in this server says it is —
// package respond writes it directly, and withJSONCharset makes the
// generated handlers agree. The charset is redundant (JSON is UTF-8 by
// definition) but it is what the TypeScript server sent, so clients and
// tests that compare the header exactly keep working.
const jsonContentType = "application/json; charset=utf-8"

// withJSONCharset is the one gen.MiddlewareFunc wrapped around every
// generated route: oapi-codegen's response types set a bare
// "application/json", and without this a client would see one Content-Type
// on a route's success body and another on the error envelope package
// respond writes for the same route.
func withJSONCharset(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(&jsonCharsetWriter{ResponseWriter: w}, r)
	})
}

// jsonCharsetWriter rewrites a bare "application/json" Content-Type as the
// header is written. It has to be a writer wrapper rather than a header set
// before the handler runs: the generated code sets the header itself, last,
// overwriting anything put there earlier.
type jsonCharsetWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *jsonCharsetWriter) WriteHeader(status int) {
	if !w.wroteHeader {
		if w.Header().Get("Content-Type") == "application/json" {
			w.Header().Set("Content-Type", jsonContentType)
		}
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *jsonCharsetWriter) Write(b []byte) (int, error) {
	// net/http would write an implicit 200 here, skipping the rewrite above.
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

// Unwrap keeps http.ResponseController working through this wrapper, so a
// later handler that needs to flush or hijack still can.
func (w *jsonCharsetWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
