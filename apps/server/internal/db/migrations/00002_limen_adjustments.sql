-- +goose Up

-- ===========================================================================
-- Limen schema corrections (Task 10)
--
-- 00001 created the auth tables from REF §B4's prose column list. Wiring the
-- real library (limen v0.2.1) against them turned up one column whose name
-- REF got wrong, and Limen does not auto-migrate, so the table has to move to
-- the library rather than the other way round.
--
-- "verifications"."identifier" -> "subject": Limen's VerificationSchema calls
-- this logical field `subject` (limen/constants.go,
-- VerificationSchemaSubjectField) and its adapter builds every WHERE from the
-- column of that name. The password-reset flow is the only thing that writes
-- the table — CreateVerification stores "password_reset:<email>" there and
-- ResetPassword reads it back — so with the old name every reset would fail
-- on an undefined column. Renaming here rather than mapping the field with
-- limen.WithVerificationFieldSubject("identifier") keeps one name for the
-- column across the schema, the library and any future dump.
--
-- NOT changed, deliberately: "rate_limits". Limen's RateLimitSchema wants
-- "last_request_at" (unix millis) where 00001 has "expires_at", but the table
-- is unreachable in this deployment either way — its database-backed store
-- reads the count column with a `.(int32)` type assertion
-- (limen/rate_limit.go, RateLimitSchema.FromStorage) while pgx's database/sql
-- driver hands an int4 back as int64, so StoreTypeDatabase would panic on the
-- first request. internal/auth therefore keeps Limen's default in-memory
-- store (REF §B1 configures no store either) and this table stays unused
-- until the library is fixed; correcting its columns now would only make it
-- look usable.
-- ===========================================================================

ALTER TABLE "verifications" RENAME COLUMN "identifier" TO "subject";
ALTER INDEX "verifications_identifier_idx" RENAME TO "verifications_subject_idx";

-- +goose Down

ALTER INDEX "verifications_subject_idx" RENAME TO "verifications_identifier_idx";
ALTER TABLE "verifications" RENAME COLUMN "subject" TO "identifier";
