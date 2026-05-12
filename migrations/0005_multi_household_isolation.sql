-- Migrate the original single-household app schema to the household-scoped model.

PRAGMA foreign_keys = OFF;

ALTER TABLE providers RENAME TO providers__legacy;
ALTER TABLE sender_rules RENAME TO sender_rules__legacy;
ALTER TABLE user_provider_access RENAME TO user_provider_access__legacy;
ALTER TABLE messages RENAME TO messages__legacy;
ALTER TABLE quarantine_messages RENAME TO quarantine_messages__legacy;
ALTER TABLE household_invitations RENAME TO household_invitations__legacy;
ALTER TABLE household_invitation_provider_access RENAME TO household_invitation_provider_access__legacy;

CREATE TABLE households (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX households_slug_idx ON households(slug);

CREATE TABLE household_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, user_id)
);

CREATE INDEX household_memberships_household_id_idx ON household_memberships(household_id);
CREATE INDEX household_memberships_user_id_idx ON household_memberships(user_id);

INSERT INTO households (id, slug, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'home', 'Primary household');

INSERT INTO household_memberships (id, household_id, user_id, role)
SELECT
  'membership-' || user.id,
  '00000000-0000-0000-0000-000000000001',
  user.id,
  CASE
    WHEN app_installation.owner_user_id IS NOT NULL AND user.id = app_installation.owner_user_id THEN 'owner'
    ELSE 'member'
  END
FROM user
LEFT JOIN app_installation ON app_installation.id = 1;

CREATE TABLE providers (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX providers_household_id_provider_key_unique
ON providers(household_id, provider_key);

CREATE INDEX providers_household_id_idx ON providers(household_id);

INSERT INTO providers (id, household_id, provider_key, display_name, created_at)
SELECT
  id,
  '00000000-0000-0000-0000-000000000001',
  provider_key,
  display_name,
  created_at
FROM providers__legacy;

CREATE TABLE household_member_provider_access (
  id TEXT PRIMARY KEY NOT NULL,
  household_membership_id TEXT NOT NULL REFERENCES household_memberships(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_membership_id, provider_id)
);

CREATE INDEX household_member_provider_access_membership_idx
ON household_member_provider_access(household_membership_id);

CREATE INDEX household_member_provider_access_provider_idx
ON household_member_provider_access(provider_id);

INSERT INTO household_member_provider_access (id, household_membership_id, provider_id, created_at)
SELECT
  user_provider_access__legacy.id,
  household_memberships.id,
  user_provider_access__legacy.provider_id,
  user_provider_access__legacy.created_at
FROM user_provider_access__legacy
INNER JOIN household_memberships
  ON household_memberships.household_id = '00000000-0000-0000-0000-000000000001'
 AND household_memberships.user_id = user_provider_access__legacy.user_id;

CREATE TABLE sender_rules (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'domain')),
  match_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, match_type, match_value)
);

CREATE INDEX idx_sender_rules_lookup ON sender_rules(household_id, match_type, match_value);

INSERT INTO sender_rules (id, household_id, provider_id, match_type, match_value, created_at)
SELECT
  id,
  '00000000-0000-0000-0000-000000000001',
  provider_id,
  match_type,
  match_value,
  created_at
FROM sender_rules__legacy;

CREATE TABLE messages (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
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
  UNIQUE (household_id, message_id)
);

CREATE INDEX idx_messages_provider_received ON messages(household_id, provider_id, received_at DESC);
CREATE INDEX idx_messages_household_received ON messages(household_id, received_at DESC);
CREATE INDEX idx_messages_delete_after ON messages(delete_after);

INSERT INTO messages (
  id,
  message_id,
  household_id,
  provider_id,
  envelope_from,
  envelope_to,
  from_header,
  subject,
  text_body,
  extracted_code,
  status,
  classification_reason,
  raw_size,
  received_at,
  delete_after,
  created_at
)
SELECT
  id,
  message_id,
  '00000000-0000-0000-0000-000000000001',
  provider_id,
  envelope_from,
  envelope_to,
  from_header,
  subject,
  text_body,
  extracted_code,
  status,
  classification_reason,
  raw_size,
  received_at,
  delete_after,
  created_at
FROM messages__legacy;

CREATE TABLE quarantine_messages (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (household_id, message_id)
);

CREATE INDEX idx_quarantine_household_received ON quarantine_messages(household_id, received_at DESC);
CREATE INDEX idx_quarantine_delete_after ON quarantine_messages(delete_after);

INSERT INTO quarantine_messages (
  id,
  message_id,
  household_id,
  envelope_from,
  envelope_to,
  from_header,
  subject,
  text_body,
  extracted_code,
  quarantine_reason,
  raw_size,
  received_at,
  delete_after,
  reviewed_at,
  created_at
)
SELECT
  id,
  message_id,
  '00000000-0000-0000-0000-000000000001',
  envelope_from,
  envelope_to,
  from_header,
  subject,
  text_body,
  extracted_code,
  quarantine_reason,
  raw_size,
  received_at,
  delete_after,
  reviewed_at,
  created_at
FROM quarantine_messages__legacy;

CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'owner')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accepted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_household_invitations_household_id ON household_invitations(household_id);
CREATE INDEX idx_household_invitations_email ON household_invitations(email);
CREATE INDEX idx_household_invitations_status ON household_invitations(status);
CREATE INDEX idx_household_invitations_expires_at ON household_invitations(expires_at);

INSERT INTO household_invitations (
  id,
  household_id,
  email,
  name,
  role,
  token_hash,
  status,
  invited_by_user_id,
  accepted_by_user_id,
  expires_at,
  accepted_at,
  cancelled_at,
  created_at,
  updated_at
)
SELECT
  id,
  '00000000-0000-0000-0000-000000000001',
  email,
  name,
  CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END,
  token_hash,
  status,
  invited_by_user_id,
  accepted_by_user_id,
  expires_at,
  accepted_at,
  cancelled_at,
  created_at,
  updated_at
FROM household_invitations__legacy;

CREATE TABLE household_invitation_provider_access (
  id TEXT PRIMARY KEY NOT NULL,
  invitation_id TEXT NOT NULL REFERENCES household_invitations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (invitation_id, provider_id)
);

INSERT INTO household_invitation_provider_access (id, invitation_id, provider_id, created_at)
SELECT id, invitation_id, provider_id, created_at
FROM household_invitation_provider_access__legacy;

DROP TABLE household_invitation_provider_access__legacy;
DROP TABLE household_invitations__legacy;
DROP TABLE quarantine_messages__legacy;
DROP TABLE messages__legacy;
DROP TABLE user_provider_access__legacy;
DROP TABLE sender_rules__legacy;
DROP TABLE providers__legacy;

PRAGMA foreign_keys = ON;
