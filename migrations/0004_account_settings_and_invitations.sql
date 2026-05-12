ALTER TABLE user ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0 NOT NULL;

CREATE TABLE two_factor (
  id TEXT PRIMARY KEY NOT NULL,
  secret TEXT NOT NULL,
  backup_codes TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  verified INTEGER DEFAULT 1
);

CREATE INDEX twoFactor_secret_idx ON two_factor(secret);
CREATE INDEX twoFactor_userId_idx ON two_factor(user_id);

CREATE TABLE passkey (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  public_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  transports TEXT,
  created_at INTEGER,
  aaguid TEXT
);

CREATE INDEX passkey_userId_idx ON passkey(user_id);
CREATE INDEX passkey_credentialID_idx ON passkey(credential_id);

CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  invited_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accepted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT household_invitations_role_check CHECK (role in ('member', 'admin')),
  CONSTRAINT household_invitations_status_check CHECK (
    status in ('pending', 'accepted', 'cancelled', 'expired')
  )
);

CREATE INDEX idx_household_invitations_email ON household_invitations(email);
CREATE INDEX idx_household_invitations_status ON household_invitations(status);
CREATE INDEX idx_household_invitations_expires_at ON household_invitations(expires_at);

CREATE TABLE household_invitation_provider_access (
  id TEXT PRIMARY KEY NOT NULL,
  invitation_id TEXT NOT NULL REFERENCES household_invitations(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX household_invitation_provider_access_invitation_provider_unique
ON household_invitation_provider_access(invitation_id, provider_id);
