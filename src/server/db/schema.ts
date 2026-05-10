export const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sender_rules (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'domain')),
  match_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  UNIQUE (match_type, match_value)
);

CREATE TABLE IF NOT EXISTS user_provider_access (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  UNIQUE (user_id, provider_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  from_header TEXT,
  subject TEXT,
  text_body TEXT NOT NULL,
  extracted_code TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'used', 'expired')),
  classification_reason TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quarantine_messages (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  envelope_from TEXT NOT NULL,
  envelope_to TEXT NOT NULL,
  from_header TEXT,
  subject TEXT,
  text_body TEXT NOT NULL,
  extracted_code TEXT,
  quarantine_reason TEXT NOT NULL,
  raw_size INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  delete_after TEXT NOT NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_provider_received ON messages(provider_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_delete_after ON messages(delete_after);
CREATE INDEX IF NOT EXISTS idx_quarantine_delete_after ON quarantine_messages(delete_after);
CREATE INDEX IF NOT EXISTS idx_sender_rules_lookup ON sender_rules(match_type, match_value);
`;
