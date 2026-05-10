-- Add Better Auth admin plugin fields to user and session tables.
-- These columns are required by the admin plugin for ban management and impersonation.

ALTER TABLE user ADD COLUMN banned INTEGER DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires INTEGER;

ALTER TABLE session ADD COLUMN impersonatedBy TEXT;
