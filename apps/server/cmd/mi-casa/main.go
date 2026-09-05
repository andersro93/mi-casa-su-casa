// Command mi-casa is the container's entrypoint and, once later phases fill
// it in, the application's composition root: the ONE place that reads the
// environment, opens the database pool and hands the assembled
// collaborators to internal/api.
//
// For now it is a stub — no dispatch modes exist yet, so any invocation
// prints usage and exits 2. See
// docs/superpowers/plans/2026-09-04-go-migration-reference.md for the
// eventual dispatch table this will grow into.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "mi-casa: not yet implemented")
	os.Exit(2)
}
