package api

import (
	"context"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/auth"
	"github.com/andersro93/mi-casa-su-casa/server/internal/domain"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/households.ts (REF §A2, "Households"): the three
// routes a signed-in person uses to see, create and give up a household.
//
// Two of them are policy rather than plumbing:
//
//   - Creation is restricted. A household's slug is also its inbound email
//     local part, so "anyone signed in may create one" would let an invited
//     member squat addresses on somebody else's installation. The rule
//     (mayCreateHousehold) is the installation owner, or a person who belongs
//     to no household at all — the second half being the recovery path for
//     somebody whose only household was removed.
//   - Leaving is refused for the last owner, so a household is never left with
//     members nobody can administer.

// ListMyHouseholds is the household switcher's list.
func (s server) ListMyHouseholds(ctx context.Context, _ gen.ListMyHouseholdsRequestObject) (gen.ListMyHouseholdsResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.ListMyHouseholds401JSONResponse(errorBody("Unauthorized")), nil
	}

	households, err := s.Repo.ListHouseholdsForUser(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	return gen.ListMyHouseholds200JSONResponse{Households: householdSummaries(households)}, nil
}

// CreateHousehold creates a household with the caller as its owner.
//
// The order below is the TypeScript's: the body is validated before the
// permission check, so somebody who may not create a household is told that
// rather than being sent to fix a slug they were never going to be allowed to
// use — and the check that costs two queries runs on a request that at least
// makes sense.
func (s server) CreateHousehold(ctx context.Context, request gen.CreateHouseholdRequestObject) (gen.CreateHouseholdResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.CreateHousehold401JSONResponse(errorBody("Unauthorized")), nil
	}

	slug := domain.NormalizeHouseholdSlug(request.Body.Slug)
	displayName := strings.TrimSpace(request.Body.DisplayName)
	if problems := validateCreateHouseholdBody(slug, displayName); len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.CreateHousehold400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	allowed, err := s.mayCreateHousehold(ctx, viewer)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return gen.CreateHousehold403JSONResponse(errorBody(
			"Only the installation owner can create additional households. " +
				"Ask them to create it and invite you.")), nil
	}

	existing, err := s.Repo.GetHouseholdBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return gen.CreateHousehold409JSONResponse(errorBody("Household slug already exists")), nil
	}

	household, err := s.Repo.CreateHousehold(ctx, slug, displayName, viewer.UserID)
	if err != nil {
		// The lookup above is not a lock: two requests racing for the same
		// slug both pass it, and the unique index decides. Answering the loser
		// with the same 409 keeps the outcome the caller sees identical either
		// way.
		if repo.IsUniqueViolation(err) {
			return gen.CreateHousehold409JSONResponse(errorBody("Household slug already exists")), nil
		}
		return nil, err
	}

	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &viewer.UserID,
		HouseholdID: &household.ID,
		Action:      "household.created",
		TargetType:  "household",
		TargetID:    &household.ID,
		Details:     map[string]any{"slug": slug},
	})

	// The same keys a /api/households/me entry has, plus the timestamps, so
	// the client can drop the answer straight into its cache.
	return gen.CreateHousehold201JSONResponse{
		Household: gen.HouseholdWithRole{
			Id:          household.ID,
			Slug:        household.Slug,
			DisplayName: household.DisplayName,
			CreatedAt:   household.CreatedAt,
			UpdatedAt:   household.UpdatedAt,
			Role:        gen.HouseholdWithRoleRole(repo.RoleOwner),
		},
	}, nil
}

// LeaveHousehold gives up the caller's own membership.
//
// It is the counterpart of the admin route that removes somebody else, and it
// enforces the same invariant from the other side: a household always keeps at
// least one owner.
func (s server) LeaveHousehold(ctx context.Context, _ gen.LeaveHouseholdRequestObject) (gen.LeaveHouseholdResponseObject, error) {
	viewer := viewerFrom(ctx)
	household := householdFrom(ctx)
	if viewer == nil || household == nil {
		// Unreachable behind tierHousehold; refusing is the failure that
		// cannot leak anything if a future route forgets the guard.
		return gen.LeaveHousehold403JSONResponse(errorBody("Forbidden")), nil
	}

	if household.Role == repo.RoleOwner {
		owners, err := s.Repo.CountOwners(ctx, household.ID)
		if err != nil {
			return nil, err
		}
		if owners <= 1 {
			return gen.LeaveHousehold409JSONResponse(errorBody(
				"You are the only owner of this household. " +
					"Make another member an owner first.")), nil
		}
	}

	// The member's provider access rows hang off the membership and cascade
	// with it, so leaving takes the mailbox access away in the same statement.
	if err := s.Repo.RemoveMember(ctx, household.ID, viewer.UserID); err != nil {
		return nil, err
	}

	applog.Event(applog.LevelInfo, "member_left", map[string]any{
		"householdId": household.ID,
		"userId":      viewer.UserID,
	})
	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &viewer.UserID,
		HouseholdID: &household.ID,
		Action:      "member.left",
		TargetType:  "user",
		TargetID:    &viewer.UserID,
	})

	return gen.LeaveHousehold200JSONResponse(okBody()), nil
}

// mayCreateHousehold is REF §A2's creation policy: the installation owner
// always, and anybody else only while they belong to no household.
//
// The TypeScript had a third branch — an app-level `admin` role from Better
// Auth — which has no Go counterpart: Limen has no global roles, and this
// installation's roles are per household.
func (s server) mayCreateHousehold(ctx context.Context, viewer *auth.Session) (bool, error) {
	installation, err := s.Q.GetInstallation(ctx)
	if err != nil {
		return false, err
	}
	if installation.OwnerUserID != nil && *installation.OwnerUserID == viewer.UserID {
		return true, nil
	}

	households, err := s.Repo.ListHouseholdsForUser(ctx, viewer.UserID)
	if err != nil {
		return false, err
	}
	return len(households) == 0, nil
}

// validateCreateHouseholdBody is REF §A4's `createHousehold` schema applied to
// the normalised values, exactly as validateSetupBody is for setup: the
// OpenAPI document states the shape, and the rules that run on what is KEPT
// (trimmed, lower-cased) run here, with the TypeScript's messages.
func validateCreateHouseholdBody(slug, displayName string) []problem {
	var problems []problem
	if err := domain.ValidateHouseholdSlug(slug); err != nil {
		problems = append(problems, problem{field: "slug", message: err.Error()})
	}
	return appendTextProblems(problems, "displayName", displayName, 80)
}
