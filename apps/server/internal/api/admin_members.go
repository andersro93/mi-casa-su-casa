package api

import (
	"context"
	"strings"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	applog "github.com/andersro93/mi-casa-su-casa/server/internal/log"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/admin/members.ts, plus the members list that lived
// in src/server/routes/admin/invitations.ts (REF §A2, "Admin"): who is in the
// household, what they may read, and how they leave.
//
// Three refusals here are invariants rather than validation, and each one is
// worded to say what to do instead:
//
//   - Removing YOURSELF is a 400 pointing at "Leave household". Giving up your
//     own access and taking somebody else's are different acts with different
//     consequences, and they should not share a button.
//   - Changing your OWN role is a 403 pointing at the other owners. An owner
//     who could demote themselves could leave a household nobody administers.
//   - Removing the LAST owner is a 409, for the same reason from the other
//     side. LeaveHousehold enforces the identical rule (households.go).

// ListMembers answers the members screen: everybody in the household with the
// providers each may read, and the household's providers so the screen can
// offer the rest.
func (s server) ListMembers(ctx context.Context, _ gen.ListMembersRequestObject) (gen.ListMembersResponseObject, error) {
	_, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.ListMembers403JSONResponse(errorBody("Forbidden")), nil
	}

	members, err := s.Repo.ListMembers(ctx, household.ID)
	if err != nil {
		return nil, err
	}
	access, err := s.Repo.ListMemberProviderAccess(ctx, household.ID)
	if err != nil {
		return nil, err
	}
	providers, err := s.Repo.ListProviders(ctx, household.ID)
	if err != nil {
		return nil, err
	}

	// One row per (member, provider) comes back from the join, including a row
	// with null provider columns for a member with no access at all — which is
	// why the nulls are skipped rather than turned into an empty entry.
	accessByUser := make(map[string][]gen.MemberProviderAccess, len(members))
	for _, row := range access {
		if row.ProviderKey == nil || row.ProviderDisplayName == nil {
			continue
		}
		accessByUser[row.ID] = append(accessByUser[row.ID], gen.MemberProviderAccess{
			ProviderKey: *row.ProviderKey,
			DisplayName: *row.ProviderDisplayName,
		})
	}

	rows := make([]gen.HouseholdMember, 0, len(members))
	for _, member := range members {
		granted := accessByUser[member.ID]
		if granted == nil {
			granted = []gen.MemberProviderAccess{}
		}
		rows = append(rows, gen.HouseholdMember{
			Id:            member.ID,
			HouseholdRole: gen.HouseholdMemberHouseholdRole(member.HouseholdRole),
			Email:         member.Email,
			Name:          member.Name,
			// `role` carried Better Auth's global role in the TypeScript and
			// the SPA reads both keys; this server has no global roles, so the
			// household role goes in each.
			Role:           gen.HouseholdMemberRole(member.HouseholdRole),
			CreatedAt:      member.CreatedAt,
			UpdatedAt:      member.UpdatedAt,
			ProviderAccess: granted,
		})
	}

	return gen.ListMembers200JSONResponse{
		Members:   rows,
		Providers: providerBodies(providers),
	}, nil
}

// RemoveMember takes somebody else out of the household.
func (s server) RemoveMember(ctx context.Context, request gen.RemoveMemberRequestObject) (gen.RemoveMemberResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.RemoveMember403JSONResponse(errorBody("Forbidden")), nil
	}

	if viewer.UserID == request.UserId {
		return gen.RemoveMember400JSONResponse(errorBody("Use 'Leave household' to remove yourself.")), nil
	}

	membership, err := s.Repo.GetMembership(ctx, request.UserId, household.ID)
	if err != nil {
		return nil, err
	}
	if membership == nil {
		return gen.RemoveMember404JSONResponse(errorBody("Member not found")), nil
	}

	if membership.Role == repo.RoleOwner {
		owners, err := s.Repo.CountOwners(ctx, household.ID)
		if err != nil {
			return nil, err
		}
		if owners <= 1 {
			return gen.RemoveMember409JSONResponse(errorBody("A household must keep at least one owner.")), nil
		}
	}

	// Provider access rows hang off the membership and cascade with it, so one
	// statement takes the mailbox access away too.
	if err := s.Repo.RemoveMember(ctx, household.ID, request.UserId); err != nil {
		return nil, err
	}

	applog.Event(applog.LevelInfo, "member_removed", map[string]any{
		"householdId": household.ID,
		"userId":      request.UserId,
		"byUserId":    viewer.UserID,
	})
	s.audit(ctx, viewer, household, "member.removed", "user", &request.UserId, nil)

	return gen.RemoveMember200JSONResponse(okBody()), nil
}

// UpdateMemberRole promotes or demotes somebody else.
//
// The self-check runs BEFORE the body is read, as the TypeScript's did: an
// owner asking to change their own role gets the same answer whether or not
// they also sent a valid role, because the refusal is about who, not what.
func (s server) UpdateMemberRole(ctx context.Context, request gen.UpdateMemberRoleRequestObject) (gen.UpdateMemberRoleResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.UpdateMemberRole403JSONResponse(errorBody("Forbidden")), nil
	}

	if viewer.UserID == request.UserId {
		return gen.UpdateMemberRole403JSONResponse(errorBody("Cannot change your own role. Ask another admin.")), nil
	}

	role, problems := normalizeRole(&request.Body.Role)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateMemberRole400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	membership, err := s.Repo.GetMembership(ctx, request.UserId, household.ID)
	if err != nil {
		return nil, err
	}
	if membership == nil {
		return gen.UpdateMemberRole404JSONResponse(errorBody("Member not found")), nil
	}

	if err := s.Repo.SetMemberRole(ctx, household.ID, request.UserId, role); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "member.role_changed", "user", &request.UserId,
		map[string]any{"role": role})

	return gen.UpdateMemberRole200JSONResponse(okBody()), nil
}

// GrantProviderAccess lets a member read one provider's messages.
//
// Access is per provider rather than per household because that is the whole
// point of the product: a housemate who needs the streaming codes does not
// thereby get to read the bank's.
func (s server) GrantProviderAccess(ctx context.Context, request gen.GrantProviderAccessRequestObject) (gen.GrantProviderAccessResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.GrantProviderAccess403JSONResponse(errorBody("Forbidden")), nil
	}

	providerKey, problems := normalizeProviderKey(request.Body.ProviderKey)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.GrantProviderAccess400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	provider, membership, err := s.providerAndMember(ctx, household.ID, providerKey, request.UserId)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.GrantProviderAccess404JSONResponse(errorBody("Provider not found")), nil
	}
	if membership == nil {
		return gen.GrantProviderAccess404JSONResponse(errorBody("Member not found")), nil
	}

	if err := s.Repo.GrantProviderAccess(ctx, household.ID, request.UserId, provider.ID); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "member.provider_access_granted", "user", &request.UserId,
		map[string]any{"providerKey": providerKey})

	return gen.GrantProviderAccess200JSONResponse(okBody()), nil
}

// RevokeProviderAccess takes a provider away from a member.
//
// The key comes from the path and only from the path. The TypeScript also
// accepted it in a JSON body on DELETE — a shape no client of this app sends
// and one that intermediaries are entitled to discard — so the Go route drops
// that half and lets the spec validate the parameter instead.
func (s server) RevokeProviderAccess(ctx context.Context, request gen.RevokeProviderAccessRequestObject) (gen.RevokeProviderAccessResponseObject, error) {
	viewer, household, ok := s.householdContext(ctx)
	if !ok {
		return gen.RevokeProviderAccess403JSONResponse(errorBody("Forbidden")), nil
	}

	providerKey, problems := normalizeProviderKey(request.ProviderKey)
	if len(problems) > 0 {
		return gen.RevokeProviderAccess400JSONResponse(errorBody("providerKey is invalid")), nil
	}

	provider, membership, err := s.providerAndMember(ctx, household.ID, providerKey, request.UserId)
	if err != nil {
		return nil, err
	}
	if provider == nil {
		return gen.RevokeProviderAccess404JSONResponse(errorBody("Provider not found")), nil
	}
	if membership == nil {
		return gen.RevokeProviderAccess404JSONResponse(errorBody("Member not found")), nil
	}

	if err := s.Repo.RevokeProviderAccess(ctx, household.ID, request.UserId, provider.ID); err != nil {
		return nil, err
	}
	s.audit(ctx, viewer, household, "member.provider_access_revoked", "user", &request.UserId,
		map[string]any{"providerKey": providerKey})

	return gen.RevokeProviderAccess200JSONResponse(okBody()), nil
}

// providerAndMember resolves the two things both access routes need, in the
// TypeScript's order: the provider first, then the membership. Both lookups
// are scoped to the household, so an id or key from elsewhere is a nil rather
// than a cross-tenant write.
func (s server) providerAndMember(ctx context.Context, householdID, providerKey, userID string) (*repo.Provider, *repo.Membership, error) {
	provider, err := s.Repo.GetProviderByKey(ctx, householdID, providerKey)
	if err != nil {
		return nil, nil, err
	}
	if provider == nil {
		return nil, nil, nil
	}
	membership, err := s.Repo.GetMembership(ctx, userID, householdID)
	if err != nil {
		return nil, nil, err
	}
	return provider, membership, nil
}

// normalizeProviderKey applies REF §A4's `providerAccess` schema: trimmed,
// lower-cased, 1..40. Deliberately no character-set check — the TypeScript's
// schema had none here either, so a key that could never have been created is
// simply not found.
func normalizeProviderKey(raw string) (string, []problem) {
	providerKey := strings.ToLower(strings.TrimSpace(raw))
	return providerKey, appendTextProblems(nil, "providerKey", providerKey, 40)
}

// normalizeRole applies REF §A4's `role` schema: owner or member, with `admin`
// accepted and mapped to owner (the TypeScript's zod enum did the same, for
// clients written against the Better Auth role names), and member as the
// default when the property is absent.
//
// The value is compared as sent, not trimmed or lower-cased: the TypeScript's
// enum did neither, and quietly accepting "Owner" here would be this server
// accepting a request its predecessor refused.
func normalizeRole(raw *string) (string, []problem) {
	if raw == nil {
		return repo.RoleMember, nil
	}
	switch *raw {
	case repo.RoleOwner, "admin":
		return repo.RoleOwner, nil
	case repo.RoleMember:
		return repo.RoleMember, nil
	default:
		return "", []problem{{field: "role", message: "role must be owner or member"}}
	}
}
