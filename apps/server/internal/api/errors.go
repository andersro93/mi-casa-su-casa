package api

// Ports src/server/http/errors.ts: the last-resort answer for a handler that
// returned an error rather than a response object.
//
// One failure gets a real answer rather than a 500: a unique-constraint
// violation. Several routes race a check-then-insert (two owners adding the
// same sender rule at once) and several more do not bother to check at all,
// because the index is the authority either way. Answering those with 409 and
// a message naming what collided is REF §A1 item 11, and it is what keeps a
// duplicate sender rule from reaching the SPA as a bare "Internal error".

// uniqueTargetColumns maps a Postgres constraint name to the column the
// TypeScript's message named for the same collision.
//
// The indirection exists because the two databases report a violation
// differently and the MESSAGE must not change. SQLite said
//
//	UNIQUE constraint failed: sender_rules.household_id, sender_rules.match_type, sender_rules.match_value
//
// and src/server/http/errors.ts took the FIRST column out of that list
// (uniqueViolationTarget's regex stops at the first space, describeUniqueTarget
// keeps the part after the dot) and spelled it with spaces — "household id".
// Postgres names the CONSTRAINT instead ("sender_rules_household_match_unique")
// and says nothing about columns, so the first column of each constraint is
// recorded here, once, next to the constraint that has it.
//
// Add a row whenever a migration adds a unique constraint; a constraint with no
// row here falls back to the same "the same values" wording the TypeScript used
// when it could not parse a target.
var uniqueTargetColumns = map[string]string{
	// App tables.
	"households_slug_unique":                       "slug",
	"household_memberships_household_user_unique":  "household id",
	"providers_household_key_unique":               "household id",
	"household_member_provider_access_unique":      "household membership id",
	"sender_rules_household_match_unique":          "household id",
	"messages_household_message_unique":            "household id",
	"quarantine_messages_household_message_unique": "household id",
	"household_invitations_token_hash_unique":      "token hash",
	"household_invitation_provider_access_unique":  "invitation id",

	// Limen-owned tables. Nothing in this package writes them directly, but a
	// sign-up racing another sign-up for the same address surfaces here.
	"users_email_unique":               "email",
	"users_public_id_unique":           "public id",
	"sessions_token_unique":            "token",
	"accounts_provider_account_unique": "provider",
	"rate_limits_key_unique":           "key",
	"two_factors_user_unique":          "user id",
}

// uniqueViolationMessage is the 409 body for a violated constraint.
func uniqueViolationMessage(constraint string) string {
	if column, ok := uniqueTargetColumns[constraint]; ok {
		return "A record with the same " + column + " already exists"
	}
	return "A record with the same values already exists"
}
