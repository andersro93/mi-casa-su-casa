-- Fixed-window rate limit counters, shared by Better Auth (storage: "database")
-- and the app's own limiter for secret-bearing endpoints (/api/setup/complete,
-- /api/invitations/*, POST /api/households). In-memory limiting is per-isolate
-- on Workers and therefore ineffective.
CREATE TABLE rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

CREATE INDEX rate_limit_last_request_idx ON rate_limit(last_request);
