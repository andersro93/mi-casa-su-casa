package api

import (
	"context"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/andersro93/mi-casa-su-casa/server/internal/api/gen"
	"github.com/andersro93/mi-casa-su-casa/server/internal/repo"
)

// Ports src/server/routes/settings.ts and the repository underneath it,
// src/server/db/repositories/settings.ts (REF §A2, "Settings").
//
// Everything here is about the caller's OWN account — the profile, the
// households they belong to, and the devices they are signed in on. There is
// no user id in any path: the session is the subject, which is what makes
// "revoke that device" safe to expose at all.
//
// The device list is the delicate part. A session's token is a bearer secret:
// possession of it IS the sign-in, so it never appears in a response. The
// screen gets the row id instead, plus `isCurrent` so it can tell the viewer
// which line is the browser they are reading it in.

// GetAccountSettings answers the whole settings screen in one request.
func (s server) GetAccountSettings(ctx context.Context, _ gen.GetAccountSettingsRequestObject) (gen.GetAccountSettingsResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.GetAccountSettings401JSONResponse(errorBody("Unauthorized")), nil
	}

	profile, err := s.Repo.GetUserProfile(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return gen.GetAccountSettings404JSONResponse(errorBody("User not found")), nil
	}

	sessions, err := s.Repo.ListUserSessions(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}

	return gen.GetAccountSettings200JSONResponse{
		Profile:  profileBody(*profile),
		Sessions: sessionSummaries(sessions, viewer.SessionID),
	}, nil
}

// ListSettingsHouseholds is the same list GET /api/households/me answers with.
// It exists separately because the settings screen refetches it on its own
// after leaving a household, and the SPA has called this path since the
// Workers deployment.
func (s server) ListSettingsHouseholds(ctx context.Context, _ gen.ListSettingsHouseholdsRequestObject) (gen.ListSettingsHouseholdsResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.ListSettingsHouseholds401JSONResponse(errorBody("Unauthorized")), nil
	}

	households, err := s.Repo.ListHouseholdsForUser(ctx, viewer.UserID)
	if err != nil {
		return nil, err
	}
	return gen.ListSettingsHouseholds200JSONResponse{Households: householdSummaries(households)}, nil
}

// UpdateProfile writes the caller's display name and avatar.
func (s server) UpdateProfile(ctx context.Context, request gen.UpdateProfileRequestObject) (gen.UpdateProfileResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.UpdateProfile401JSONResponse(errorBody("Unauthorized")), nil
	}

	name := strings.TrimSpace(request.Body.Name)
	image, problems := normalizeProfileImage(request.Body.Image)
	problems = appendTextProblems(problems, "name", name, 80)
	if len(problems) > 0 {
		summary, fields := envelopeFor(problems)
		return gen.UpdateProfile400JSONResponse(errorFieldsBody(summary, fields)), nil
	}

	profile, err := s.Repo.UpdateUserProfile(ctx, viewer.UserID, name, image)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return gen.UpdateProfile404JSONResponse(errorBody("User not found")), nil
	}
	return gen.UpdateProfile200JSONResponse{Profile: profileBody(*profile)}, nil
}

// RevokeOtherSessions is "sign out everywhere else".
//
// It deletes the rows rather than flagging them: the session token is checked
// against that table on every request, so a deleted row is a cookie that no
// longer signs anybody in — which is the whole point of the button.
func (s server) RevokeOtherSessions(ctx context.Context, _ gen.RevokeOtherSessionsRequestObject) (gen.RevokeOtherSessionsResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.RevokeOtherSessions401JSONResponse(errorBody("Unauthorized")), nil
	}

	if err := s.Repo.DeleteOtherSessions(ctx, viewer.UserID, viewer.SessionID); err != nil {
		return nil, err
	}
	// No household: this is an account-level event, and filing it under one
	// household would put it in an audit log the other households cannot see.
	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &viewer.UserID,
		Action:      "session.revoked_others",
		TargetType:  "user",
		TargetID:    &viewer.UserID,
	})

	return gen.RevokeOtherSessions200JSONResponse(okBody()), nil
}

// RevokeSession revokes one device.
//
// A session id belonging to somebody else deletes nothing and still answers
// 200 (the delete is scoped to the caller's own user id): a 404 would turn
// this into an oracle for which session ids exist, and there is nothing the
// caller could do about the difference anyway.
func (s server) RevokeSession(ctx context.Context, request gen.RevokeSessionRequestObject) (gen.RevokeSessionResponseObject, error) {
	viewer := viewerFrom(ctx)
	if viewer == nil {
		return gen.RevokeSession401JSONResponse(errorBody("Unauthorized")), nil
	}

	if err := s.Repo.DeleteSession(ctx, viewer.UserID, request.SessionId); err != nil {
		return nil, err
	}
	s.Repo.RecordAudit(ctx, repo.AuditEventInput{
		ActorUserID: &viewer.UserID,
		Action:      "session.revoked",
		TargetType:  "session",
		TargetID:    &request.SessionId,
	})

	return gen.RevokeSession200JSONResponse(okBody()), nil
}

// profileBody maps the repository's profile onto the wire shape. `role` is
// always null: it carried Better Auth's global role in the TypeScript server,
// which has no Go counterpart, and stays in the payload because the SPA reads
// it.
func profileBody(profile repo.UserProfile) gen.Profile {
	return gen.Profile{
		Id:               profile.ID,
		Email:            profile.Email,
		Name:             profile.Name,
		Image:            profile.Image,
		Role:             nil,
		TwoFactorEnabled: profile.TwoFactorEnabled,
		Households:       householdSummaries(profile.Households),
	}
}

// sessionSummaries maps the device list, flagging the row the request itself
// arrived on. `impersonatedBy` is always null — this server has no
// impersonation — and `ipAddress` is the digest Limen stored rather than a
// readable address, so the screen can distinguish two devices without
// publishing where either one is.
func sessionSummaries(sessions []repo.Session, currentID string) []gen.SessionSummary {
	summaries := make([]gen.SessionSummary, 0, len(sessions))
	for _, session := range sessions {
		summaries = append(summaries, gen.SessionSummary{
			Id:             session.ID,
			IsCurrent:      session.ID == currentID,
			ExpiresAt:      session.ExpiresAt,
			IpAddress:      session.IPAddress,
			UserAgent:      session.UserAgent,
			CreatedAt:      session.CreatedAt,
			UpdatedAt:      session.LastAccess,
			ImpersonatedBy: nil,
		})
	}
	return summaries
}

// normalizeProfileImage is REF §A4's `image` rule: absent or empty clears the
// avatar, anything else must be an http(s) URL of at most 2048 characters.
//
// The scheme check is explicit rather than left to url.Parse, which happily
// accepts "not a url" as a relative reference and would let a javascript: URL
// through — this value ends up in an <img src>, so only http and https may
// reach it.
func normalizeProfileImage(raw *string) (*string, []problem) {
	if raw == nil {
		return nil, nil
	}
	image := strings.TrimSpace(*raw)
	if image == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(image) > 2048 {
		return nil, []problem{{field: "image", message: "image must be at most 2048 characters"}}
	}

	parsed, err := url.Parse(image)
	if err != nil || parsed.Host == "" ||
		(!strings.EqualFold(parsed.Scheme, "http") && !strings.EqualFold(parsed.Scheme, "https")) {
		return nil, []problem{{field: "image", message: "image must be an http(s) URL"}}
	}
	return &image, nil
}
