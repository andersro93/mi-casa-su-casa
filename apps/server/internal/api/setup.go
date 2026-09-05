package api

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/api/middleware"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	dbgen "github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
	"github.com/andersro93/mi-casa-su-casa/server/internal/security"
)

// Ports src/server/routes/setup.ts (REF §A2, "Setup — public"), including its
// two recovery paths and the installation state machine underneath them
// (src/server/db/repositories/installation-state.ts).
//
// The whole flow exists to answer one question safely: who owns this
// installation? It is the only route that creates an account without an
// invitation, so it is guarded four ways at once — a constant-time SETUP_SECRET
// comparison, an OWNER_EMAIL match, a single-claim state machine that two
// concurrent requests cannot both win, and a rate limit (5 per 15 minutes)
// because the body carries a secret worth guessing.

// setupClaimTTL is how long a claimed-but-unfinished setup blocks the next
// attempt. An attempt that crashed between claiming and completing would
// otherwise wedge the installation in `in_progress` forever, with no way in
// but a manual UPDATE; ten minutes is far longer than the flow takes and short
// enough that an operator retrying after a crash does not have to wait.
const setupClaimTTL = 10 * time.Minute

// GetSetupStatus reports whether the first-run screen should open.
//
// It says nothing about WHO the owner is. The endpoint is public — it is what
// the SPA calls before anybody has signed in — and the installation's owner
// address is not something to publish. The inbox domain is included because it
// is not secret (every household address ends with it) and it lets the setup
// screen preview "name@domain" while a household is being named.
func (s server) GetSetupStatus(ctx context.Context, _ gen.GetSetupStatusRequestObject) (gen.GetSetupStatusResponseObject, error) {
	installation, err := s.Q.GetInstallation(ctx)
	if err != nil {
		return nil, err
	}

	status := gen.SetupStatusStatus(installation.Status)
	body := gen.SetupStatus{
		Status: status,
		// Always true: internal/config requires OWNER_EMAIL and SETUP_SECRET
		// at boot, so a running process is configured by construction. The
		// field stays because the SPA reads it.
		IsConfigured: true,
		NeedsSetup:   status != gen.SetupStatusStatusComplete,
		SetupLocked:  status == gen.SetupStatusStatusComplete,
	}
	if domainName := strings.TrimSpace(s.EmailDomain); domainName != "" {
		body.EmailDomain = &domainName
	}
	return gen.GetSetupStatus200JSONResponse(body), nil
}

// CompleteSetup claims the installation: it creates the owner account, their
// first household, and locks setup behind them.
//
// The order of the checks below is the TypeScript's, and each step of it is
// load-bearing:
//
//   - "already complete" is answered FIRST, before the secret is even looked
//     at, so a completed installation gives the same answer to a right secret
//     and a wrong one and cannot be used as an oracle for either.
//   - the secret is compared in constant time (security.SecretsEqual).
//   - the claim (BeginInstallationSetup) is a single atomic UPDATE, so two
//     concurrent first-run requests cannot both proceed.
//   - everything after the claim compensates on failure: the account this
//     attempt created is deleted and the claim released, so a retry starts
//     from a clean slate rather than from "user already exists".
func (s server) CompleteSetup(ctx context.Context, request gen.CompleteSetupRequestObject) (gen.CompleteSetupResponseObject, error) {
	installation, err := s.Q.GetInstallation(ctx)
	if err != nil {
		return nil, err
	}
	if installation.Status == installationComplete {
		return gen.CompleteSetup409JSONResponse(errorBody("Setup has already been completed")), nil
	}

	// The TypeScript answered 503 here when OWNER_EMAIL or SETUP_SECRET were
	// unset. There is no Go equivalent: internal/config refuses to build a
	// configuration without both, so the process would not be serving.

	body := request.Body
	email := normalizeEmail(body.Email)
	name := strings.TrimSpace(body.Name)
	householdName := strings.TrimSpace(body.HouseholdName)
	slug := domain.NormalizeHouseholdSlug(body.HouseholdSlug)

	if problems := validateSetupBody(email, name, body.Password, householdName, slug, body.SetupSecret); len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CompleteSetup400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	if !security.SecretsEqual(body.SetupSecret, s.SetupSecret) {
		return gen.CompleteSetup403JSONResponse(errorBody("Invalid setup secret")), nil
	}
	if email != normalizeEmail(s.OwnerEmail) {
		return gen.CompleteSetup403JSONResponse(errorBody("Setup email must match OWNER_EMAIL")), nil
	}

	claimed, err := s.Q.BeginInstallationSetup(ctx, timestamp(s.Now().Add(-setupClaimTTL)))
	if err != nil {
		return nil, err
	}
	if claimed == 0 {
		return gen.CompleteSetup409JSONResponse(errorBody("Setup is already in progress or has been completed")), nil
	}

	// Recovery: an earlier attempt may have created the owner account without
	// the installation ever being marked complete.
	if recovered, err := s.recoverExistingOwner(ctx, email); err != nil {
		return nil, err
	} else if recovered != nil {
		return recovered, nil
	}

	userID, err := s.Auth.CreateUser(ctx, name, email, body.Password)
	if err != nil {
		// Nothing to compensate for yet — no account exists — but the claim
		// must still be released or the next attempt is refused for ten
		// minutes.
		s.rollbackSetup(ctx, "", err)
		if errors.Is(err, auth.ErrPasswordLength) {
			summary, fields := envelopeFor([]problem{{field: "password", message: passwordLengthMessage(body.Password)}})
			return gen.CompleteSetup400JSONResponse(errorFieldsBody(summary, fields)), nil
		}
		return gen.CompleteSetup500JSONResponse(errorBody("Unable to complete setup")), nil
	}

	household, err := s.Repo.CreateHousehold(ctx, slug, householdName, userID)
	if err != nil {
		s.rollbackSetup(ctx, userID, err)
		if repo.IsUniqueViolation(err) {
			return gen.CompleteSetup409JSONResponse(errorBody("A household with that slug already exists")), nil
		}
		return gen.CompleteSetup500JSONResponse(errorBody("Unable to complete setup")), nil
	}

	if err := s.Q.CompleteInstallationSetup(ctx, dbgen.CompleteInstallationSetupParams{
		OwnerUserID: &userID,
		OwnerEmail:  &email,
	}); err != nil {
		s.rollbackSetup(ctx, userID, err)
		return gen.CompleteSetup500JSONResponse(errorBody("Unable to complete setup")), nil
	}

	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &userID,
		HouseholdID: &household.ID,
		Action:      "installation.setup_completed",
		TargetType:  "installation",
		TargetID:    ptr("1"),
		Details:     map[string]any{"householdSlug": slug},
	})

	// The owner is signed in as part of the same response (REF §A2: "with the
	// session cookie set"), so the SPA lands on a working installation rather
	// than on a sign-in form asking for the password just typed.
	//
	// A session that could not be minted is NOT a failed setup: the
	// installation is complete and correct, and the owner can simply sign in.
	// Rolling it back over a cookie would be far worse than one extra sign-in.
	if w, r, ok := middleware.HTTPFromContext(ctx); ok {
		if err := s.Auth.SignIn(ctx, w, r, userID); err != nil {
			applog.Event(applog.LevelError, "setup_failed", map[string]any{
				"userId": userID,
				"during": "sign in",
				"error":  err.Error(),
			})
		}
	}

	return gen.CompleteSetup201JSONResponse{
		Member:    gen.Member{Id: userID, Email: email, Name: name, Role: gen.MemberRoleOwner},
		Household: householdBody(&household),
	}, nil
}

// recoverExistingOwner handles the two states an interrupted earlier attempt
// can have left behind. It returns a non-nil response when the caller should
// stop, nil when setup may proceed.
//
// Both branches run AFTER the claim, so they cannot race a concurrent attempt
// doing the same thing.
func (s server) recoverExistingOwner(ctx context.Context, email string) (gen.CompleteSetupResponseObject, error) {
	existing, err := s.Repo.FindUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	households, err := s.Repo.ListHouseholdsForUser(ctx, existing.ID)
	if err != nil {
		return nil, err
	}
	for _, household := range households {
		if household.Role != repo.RoleOwner {
			continue
		}
		// Sign-up and household creation both succeeded last time; only the
		// final bookkeeping was lost. Finish it and say so — the owner has an
		// account and a household already, and creating a second set would be
		// the wrong repair.
		if err := s.Q.CompleteInstallationSetup(ctx, dbgen.CompleteInstallationSetupParams{
			OwnerUserID: &existing.ID,
			OwnerEmail:  &email,
		}); err != nil {
			return nil, err
		}
		applog.Event(applog.LevelWarn, "setup_recovered_existing_owner", map[string]any{"userId": existing.ID})
		return gen.CompleteSetup409JSONResponse(errorBody("Setup has already been completed for this owner. Sign in with your owner account.")), nil
	}

	// An orphan from a failed attempt: an account with no household at all.
	// Removing it is what lets the retry create one under the same address
	// instead of failing with "user already exists".
	applog.Event(applog.LevelWarn, "setup_orphan_user_removed", map[string]any{"userId": existing.ID})
	if err := s.Repo.DeleteUser(ctx, existing.ID); err != nil {
		return nil, err
	}
	return nil, nil
}

// rollbackSetup compensates a failed attempt: it removes the account this
// attempt created (when it got that far) and releases the claim, so the next
// attempt starts clean.
//
// Neither step is allowed to replace the original failure — the caller has
// already decided what to answer — so both are logged rather than returned.
// ResetInstallationSetup is safe to call unconditionally: it only moves
// `in_progress` back to `pending`, and only while owner_user_id is still null,
// so an installation that DID acquire an owner is never dragged back into
// first-run state.
func (s server) rollbackSetup(ctx context.Context, userID string, cause error) {
	applog.Event(applog.LevelError, "setup_failed", map[string]any{"error": cause.Error()})

	if userID != "" {
		if err := s.Repo.DeleteUser(ctx, userID); err != nil {
			applog.Event(applog.LevelError, "setup_cleanup_failed", map[string]any{
				"userId": userID,
				"error":  err.Error(),
			})
		}
	}

	if err := s.Q.ResetInstallationSetup(ctx); err != nil {
		applog.Event(applog.LevelError, "setup_cleanup_failed", map[string]any{
			"during": "reset installation",
			"error":  err.Error(),
		})
	}
}

// validateSetupBody is the hand-written half of REF §A4's `setup` schema: the
// rules the OpenAPI document cannot state, applied to the already-normalised
// values.
//
// The spec checks lengths on what was SENT; these run on what was KEPT, after
// trimming and lower-casing, which is the value that ends up in the database.
// The messages are the TypeScript's verbatim — the SPA renders them next to
// their inputs.
func validateSetupBody(email, name, password, householdName, slug, setupSecret string) []problem {
	var problems []problem

	// The shape check only runs when the address survived the length rule:
	// reporting "is required" and "must be a valid email address" for the same
	// empty input would put two messages on one control.
	if emailProblems := appendTextProblems(nil, "email", email, 254); len(emailProblems) > 0 {
		problems = append(problems, emailProblems...)
	} else if !emailPattern.MatchString(email) {
		problems = append(problems, problem{field: "email", message: "email must be a valid email address"})
	}
	problems = appendTextProblems(problems, "name", name, 80)
	problems = appendPasswordProblems(problems, password)
	problems = appendTextProblems(problems, "householdName", householdName, 80)
	if err := domain.ValidateHouseholdSlug(slug); err != nil {
		problems = append(problems, problem{field: "householdSlug", message: err.Error()})
	}
	if strings.TrimSpace(setupSecret) == "" {
		problems = append(problems, problem{field: "setupSecret", message: "setupSecret is required"})
	}

	return problems
}

// appendTextProblems applies the shared "trimmed, 1..max" rule REF §A4 spells
// once and reuses for every free-text field.
//
// Free text is counted in RUNES, unlike the password above: these are display
// names, where the bound exists so a name fits a column and a screen, and
// nothing downstream re-checks them against a byte count. The password's cap
// is a bound on what gets hashed, and has to agree with package auth to the
// byte.
func appendTextProblems(problems []problem, field, value string, max int) []problem {
	switch {
	case value == "":
		return append(problems, problem{field: field, message: field + " is required"})
	case utf8.RuneCountInString(value) > max:
		return append(problems, problem{
			field:   field,
			message: field + " must be at most " + itoa(max) + " characters",
		})
	}
	return problems
}

// appendPasswordProblems applies REF §A4's password rule.
func appendPasswordProblems(problems []problem, password string) []problem {
	if message := passwordProblem(password); message != "" {
		return append(problems, problem{field: "password", message: message})
	}
	return problems
}

// passwordProblem is REF §A4's message for a password that breaks the length
// rule, or "" when it does not.
//
// The value is deliberately NOT trimmed: a leading or trailing space is a
// character the person chose, and silently dropping it would make the password
// they typed differ from the one that was stored.
//
// The bounds are counted in BYTES, not runes, because that is how
// auth.validatePasswordLength counts them — and the two must agree exactly.
// Counting runes here would let a 65-character Cyrillic password (130 bytes)
// past this check and into CreateUser, which would refuse it with an error
// whose text is written for a log, not for a person. The cap exists to bound
// the Argon2id input, which is a byte count either way.
func passwordProblem(password string) string {
	switch {
	case password == "":
		return "password is required"
	case len(password) < auth.PasswordMinLength:
		return "password must be at least " + itoa(auth.PasswordMinLength) + " characters"
	case len(password) > auth.PasswordMaxLength:
		return "password must be at most " + itoa(auth.PasswordMaxLength) + " characters"
	}
	return ""
}

// passwordLengthMessage is what a client is told when CreateUser refuses a
// password on length despite the check above having passed — which can only
// happen if the two bounds drift apart. auth.ErrPasswordLength's own text
// ("auth: password must be between 12 and 128 characters") is written for a
// log and must never reach a caller, so it is translated here rather than
// passed through.
func passwordLengthMessage(password string) string {
	if message := passwordProblem(password); message != "" {
		return message
	}
	return "password must be at least " + itoa(auth.PasswordMinLength) + " characters"
}

// installationComplete is the terminal state of the app_installation state
// machine, spelled once here rather than at each comparison.
const installationComplete = "complete"

// timestamp is the pgtype spelling of a Go time, for the generated queries
// that take one.
func timestamp(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t.UTC(), Valid: true}
}
