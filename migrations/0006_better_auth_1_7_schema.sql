-- Better Auth 1.7 schema changes.
--
-- 1. Account identity is now scoped by `issuer` (unique on (issuer, accountId)).
--    Existing rows are credential accounts, whose issuer is `local:credential`
--    (see `createLocalAccountIssuer` in @better-auth/core).
-- 2. The two-factor plugin gained lockout bookkeeping fields.

ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT 'local:credential';

CREATE UNIQUE INDEX IF NOT EXISTS account_issuer_accountId_unique
  ON account(issuer, accountId);

ALTER TABLE two_factor ADD COLUMN failed_verification_count INTEGER;
ALTER TABLE two_factor ADD COLUMN locked_until INTEGER;
