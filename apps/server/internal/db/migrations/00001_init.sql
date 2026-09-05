-- +goose Up

-- ===========================================================================
-- Auth tables (Limen-owned; REF §B4)
--
-- Limen does not auto-migrate — it expects these tables to already exist —
-- so they are created here alongside the app's own. Column set and
-- constraint names come from REF §B4 verbatim; the tables §B4 gives as a
-- prose column list (sessions, accounts, verifications, rate_limits) use
-- this file's `id text PRIMARY KEY DEFAULT gen_random_uuid()::text`
-- convention, matching the two tables §B4 spells out in full.
--
-- The names are quoted throughout because "users" is the Postgres spelling
-- of the D1 predecessor's `user`, which is a reserved word: quoting keeps
-- every reference to these tables looking the same whether or not the
-- identifier happens to need it.
-- ===========================================================================

CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"public_id" text NOT NULL DEFAULT gen_random_uuid()::text,
	"first_name" text,
	"last_name" text,
	"email" text NOT NULL,
	"password" text,
	"email_verified_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	"deleted_at" timestamptz,
	-- Ours, not part of Limen's own column set (REF §A5): the display name
	-- the UI shows, the avatar, and the two-factor flag the account
	-- settings screen reads without joining "two_factors".
	"name" text NOT NULL DEFAULT '',
	"image" text,
	"two_factor_enabled" boolean NOT NULL DEFAULT false,
	CONSTRAINT "users_email_unique" UNIQUE ("email"),
	CONSTRAINT "users_public_id_unique" UNIQUE ("public_id")
);

CREATE TABLE "sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
	"token" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"expires_at" timestamptz NOT NULL,
	"last_access" timestamptz,
	-- A JSON *string*, not jsonb: Limen writes and reads it as opaque text.
	-- It carries our ip_address digest and the user agent, which
	-- /api/settings unpacks for the device list (REF §B4).
	"metadata" text,
	CONSTRAINT "sessions_token_unique" UNIQUE ("token")
);

CREATE TABLE "accounts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamptz,
	"refresh_token_expires_at" timestamptz,
	"scope" text,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "accounts_provider_account_unique" UNIQUE ("provider", "provider_account_id")
);

CREATE TABLE "verifications" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Limen's own rate limiter, distinct from the app's "rate_limit" below.
-- Both exist because they answer to different owners: Limen writes this one
-- for auth endpoints, we write ours for the secret-bearing app endpoints.
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"key" text NOT NULL,
	"count" integer NOT NULL DEFAULT 0,
	"expires_at" timestamptz NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE ("key")
);

CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text,
	"user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "two_factors_user_unique" UNIQUE ("user_id")
);

CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX "accounts_user_idx" ON "accounts" ("user_id");
CREATE INDEX "verifications_identifier_idx" ON "verifications" ("identifier");

-- ===========================================================================
-- App tables (REF §A5)
--
-- Ported from the D1 migrations 0001-0011 as they stood at the end: ids are
-- `text` UUIDs the app generates (never serial — they are minted before the
-- INSERT, e.g. to hash an invitation token against), every timestamp is
-- `timestamptz` where D1 stored ISO text, and audit details become `jsonb`
-- so a query can reach inside them.
-- ===========================================================================

CREATE TABLE "households" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "households_slug_unique" UNIQUE ("slug")
);

CREATE TABLE "household_memberships" (
	"id" text PRIMARY KEY,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	"user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
	"role" text NOT NULL CHECK ("role" IN ('owner', 'member')),
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "household_memberships_household_user_unique" UNIQUE ("household_id", "user_id")
);
CREATE INDEX "household_memberships_household_idx" ON "household_memberships" ("household_id");
CREATE INDEX "household_memberships_user_idx" ON "household_memberships" ("user_id");

CREATE TABLE "providers" (
	"id" text PRIMARY KEY,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	-- Unique per household, not globally: two households may each have their
	-- own "bank" provider without colliding.
	"provider_key" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "providers_household_key_unique" UNIQUE ("household_id", "provider_key")
);
CREATE INDEX "providers_household_idx" ON "providers" ("household_id");

CREATE TABLE "household_member_provider_access" (
	"id" text PRIMARY KEY,
	"household_membership_id" text NOT NULL REFERENCES "household_memberships" ("id") ON DELETE CASCADE,
	"provider_id" text NOT NULL REFERENCES "providers" ("id") ON DELETE CASCADE,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "household_member_provider_access_unique" UNIQUE ("household_membership_id", "provider_id")
);
CREATE INDEX "household_member_provider_access_membership_idx"
	ON "household_member_provider_access" ("household_membership_id");
CREATE INDEX "household_member_provider_access_provider_idx"
	ON "household_member_provider_access" ("provider_id");

CREATE TABLE "sender_rules" (
	"id" text PRIMARY KEY,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	"provider_id" text NOT NULL REFERENCES "providers" ("id") ON DELETE CASCADE,
	"match_type" text NOT NULL CHECK ("match_type" IN ('exact', 'domain')),
	"match_value" text NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "sender_rules_household_match_unique" UNIQUE ("household_id", "match_type", "match_value")
);
-- The classifier's hot path: given a household and an envelope sender, find
-- the matching rule by exact address then by domain.
CREATE INDEX "sender_rules_lookup_idx" ON "sender_rules" ("household_id", "match_type", "match_value");

CREATE TABLE "messages" (
	"id" text PRIMARY KEY,
	-- The RFC 5322 Message-ID, unique per household rather than globally:
	-- the same broadcast can legitimately land in two households.
	"message_id" text NOT NULL,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	"provider_id" text NOT NULL REFERENCES "providers" ("id") ON DELETE CASCADE,
	"envelope_from" text NOT NULL,
	"envelope_to" text NOT NULL,
	"from_header" text,
	"subject" text,
	"text_body" text NOT NULL,
	"extracted_code" text,
	"status" text NOT NULL DEFAULT 'new' CHECK ("status" IN ('new', 'used', 'expired')),
	"classification_reason" text NOT NULL,
	"raw_size" integer NOT NULL,
	-- Display only. received_at and delete_after come from server time so a
	-- sender-controlled Date: header cannot reorder the inbox or push a
	-- message past retention.
	"date_header" timestamptz,
	"received_at" timestamptz NOT NULL,
	"delete_after" timestamptz NOT NULL,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "messages_household_message_unique" UNIQUE ("household_id", "message_id")
);
CREATE INDEX "messages_household_provider_received_idx"
	ON "messages" ("household_id", "provider_id", "received_at" DESC);
CREATE INDEX "messages_household_received_idx" ON "messages" ("household_id", "received_at" DESC);
-- Unscoped by household on purpose: the retention job sweeps every
-- household's expired mail in one pass.
CREATE INDEX "messages_delete_after_idx" ON "messages" ("delete_after");

CREATE TABLE "quarantine_messages" (
	"id" text PRIMARY KEY,
	"message_id" text NOT NULL,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	"envelope_from" text NOT NULL,
	"envelope_to" text NOT NULL,
	"from_header" text,
	"subject" text,
	"text_body" text NOT NULL,
	"extracted_code" text,
	"quarantine_reason" text NOT NULL,
	"raw_size" integer NOT NULL,
	"date_header" timestamptz,
	"received_at" timestamptz NOT NULL,
	"delete_after" timestamptz NOT NULL,
	-- NULL until an owner works through the needs-review queue; there is no
	-- provider_id because quarantine is precisely the mail no rule matched.
	"reviewed_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "quarantine_messages_household_message_unique" UNIQUE ("household_id", "message_id")
);
CREATE INDEX "quarantine_messages_household_received_idx"
	ON "quarantine_messages" ("household_id", "received_at" DESC);
CREATE INDEX "quarantine_messages_delete_after_idx" ON "quarantine_messages" ("delete_after");

CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY,
	-- No foreign keys on actor_user_id or household_id: the trail has to
	-- outlive both the actor and the household it describes, and a cascade
	-- would quietly erase exactly the record of a deletion someone later
	-- wants to look up. Installation-level events leave household_id NULL.
	"actor_user_id" text,
	"household_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"details" jsonb,
	"created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "audit_events_household_created_idx" ON "audit_events" ("household_id", "created_at" DESC);

-- Singleton row (id = 1, enforced by the CHECK) holding first-run setup
-- state and the retention cron's last-success stamp.
CREATE TABLE "app_installation" (
	"id" integer PRIMARY KEY CHECK ("id" = 1),
	"status" text NOT NULL CHECK ("status" IN ('pending', 'in_progress', 'complete')),
	"owner_user_id" text,
	"owner_email" text,
	"completed_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	-- NULL means the retention cron has never completed; readiness reports a
	-- stale value rather than letting a failing cron go unnoticed for weeks.
	"last_retention_run_at" timestamptz
);

-- Seeded here so the very first setup-state read finds 'pending' instead of
-- no row at all. Boot re-runs the same insert with ON CONFLICT DO NOTHING as
-- a belt-and-braces guard (EnsureInstallation).
INSERT INTO "app_installation" ("id", "status")
VALUES (1, 'pending')
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "household_invitations" (
	"id" text PRIMARY KEY,
	"household_id" text NOT NULL REFERENCES "households" ("id") ON DELETE CASCADE,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL CHECK ("role" IN ('owner', 'member')),
	-- Only the digest is stored; the raw token lives in the invite link and
	-- nowhere else.
	"token_hash" text NOT NULL,
	"status" text NOT NULL CHECK ("status" IN ('pending', 'accepted', 'cancelled', 'expired')),
	"invited_by_user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
	-- SET NULL, not CASCADE: deleting the account that accepted an invite
	-- must not delete the record that the invite was accepted.
	"accepted_by_user_id" text REFERENCES "users" ("id") ON DELETE SET NULL,
	"expires_at" timestamptz NOT NULL,
	"accepted_at" timestamptz,
	"cancelled_at" timestamptz,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	"updated_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "household_invitations_token_hash_unique" UNIQUE ("token_hash")
);
CREATE INDEX "household_invitations_household_idx" ON "household_invitations" ("household_id");
CREATE INDEX "household_invitations_email_idx" ON "household_invitations" ("email");
CREATE INDEX "household_invitations_status_idx" ON "household_invitations" ("status");
CREATE INDEX "household_invitations_expires_at_idx" ON "household_invitations" ("expires_at");

CREATE TABLE "household_invitation_provider_access" (
	"id" text PRIMARY KEY,
	"invitation_id" text NOT NULL REFERENCES "household_invitations" ("id") ON DELETE CASCADE,
	"provider_id" text NOT NULL REFERENCES "providers" ("id") ON DELETE CASCADE,
	"created_at" timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT "household_invitation_provider_access_unique" UNIQUE ("invitation_id", "provider_id")
);

-- The app's own fixed-window limiter for secret-bearing endpoints, keyed by
-- an IP digest. Distinct from Limen's "rate_limits" above; the key is the
-- primary key because every access is a lookup by it.
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL DEFAULT 0,
	"expires_at" timestamptz NOT NULL
);
CREATE INDEX "rate_limit_expires_idx" ON "rate_limit" ("expires_at");

-- +goose Down

DROP TABLE IF EXISTS "rate_limit";
DROP TABLE IF EXISTS "household_invitation_provider_access";
DROP TABLE IF EXISTS "household_invitations";
DROP TABLE IF EXISTS "app_installation";
DROP TABLE IF EXISTS "audit_events";
DROP TABLE IF EXISTS "quarantine_messages";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "sender_rules";
DROP TABLE IF EXISTS "household_member_provider_access";
DROP TABLE IF EXISTS "providers";
DROP TABLE IF EXISTS "household_memberships";
DROP TABLE IF EXISTS "households";

DROP TABLE IF EXISTS "two_factors";
DROP TABLE IF EXISTS "rate_limits";
DROP TABLE IF EXISTS "verifications";
DROP TABLE IF EXISTS "accounts";
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "users";
