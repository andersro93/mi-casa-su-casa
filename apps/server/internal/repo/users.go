package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/andersro93/mi-casa-su-casa/server/internal/db/gen"
)

// Ports src/server/db/repositories/users.ts and
// src/server/db/repositories/settings.ts. The rows belong to Limen (Task 10);
// this file reads them, maintains the three display columns that are ours,
// and revokes sessions.

// User is the minimum an account is identified by.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// UserProfile is the account settings screen's own view: the profile plus
// the households the user belongs to, so the screen needs one request.
type UserProfile struct {
	ID               string             `json:"id"`
	Email            string             `json:"email"`
	Name             string             `json:"name"`
	Image            *string            `json:"image"`
	TwoFactorEnabled bool               `json:"twoFactorEnabled"`
	Households       []HouseholdSummary `json:"households"`
}

// Session is one entry in the device list.
//
// IPAddress is the digest Limen stored, not a readable address: the settings
// screen shows it only so a viewer can tell two devices apart. LastAccess
// carries the TypeScript's `updatedAt` key, which is what that column meant
// there.
type Session struct {
	ID         string     `json:"id"`
	ExpiresAt  time.Time  `json:"expiresAt"`
	IPAddress  *string    `json:"ipAddress"`
	UserAgent  *string    `json:"userAgent"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastAccess *time.Time `json:"updatedAt"`
}

// FindUserByEmail normalises the address before looking it up, so the same
// account is found however it was typed.
func (r *Repo) FindUserByEmail(ctx context.Context, email string) (*User, error) {
	row, err := r.q.FindUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: find user by email: %w", err)
	}
	return &User{ID: row.ID, Email: row.Email, Name: row.Name}, nil
}

// FindUserByID returns nil when there is no such account.
func (r *Repo) FindUserByID(ctx context.Context, id string) (*User, error) {
	row, err := r.q.FindUserByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: find user by id: %w", err)
	}
	return &User{ID: row.ID, Email: row.Email, Name: row.Name}, nil
}

// DeleteUser removes an account; sessions, credentials and memberships
// cascade. It exists to compensate for an interrupted flow — a setup or
// invitation accept that created the account and then failed — not as an
// ordinary operation.
func (r *Repo) DeleteUser(ctx context.Context, userID string) error {
	if err := r.q.DeleteUser(ctx, userID); err != nil {
		return fmt.Errorf("repo: delete user: %w", err)
	}
	return nil
}

// GetUserProfile returns the profile with its households, or nil when there
// is no such account.
func (r *Repo) GetUserProfile(ctx context.Context, userID string) (*UserProfile, error) {
	row, err := r.q.GetUserProfile(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("repo: get user profile: %w", err)
	}
	households, err := r.ListHouseholdsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &UserProfile{
		ID:               row.ID,
		Email:            row.Email,
		Name:             row.Name,
		Image:            row.Image,
		TwoFactorEnabled: row.TwoFactorEnabled,
		Households:       households,
	}, nil
}

// UpdateUserProfile writes the display name and avatar, then returns the
// profile as it now stands. A nil image clears the avatar.
func (r *Repo) UpdateUserProfile(ctx context.Context, userID, name string, image *string) (*UserProfile, error) {
	if err := r.q.UpdateUserProfile(ctx, gen.UpdateUserProfileParams{
		Name:  name,
		Image: image,
		ID:    userID,
	}); err != nil {
		return nil, fmt.Errorf("repo: update user profile: %w", err)
	}
	return r.GetUserProfile(ctx, userID)
}

// ListUserSessions returns the user's devices, newest first.
//
// Limen stores the client details as an opaque JSON string in `metadata`; a
// row whose metadata is absent, unparseable, or simply carries neither key
// yields nil fields rather than empty strings, so the screen can say "unknown
// device" instead of rendering a blank line. Unparseable metadata is not an
// error: it is Limen's column, and a session is still a session the user may
// want to revoke.
func (r *Repo) ListUserSessions(ctx context.Context, userID string) ([]Session, error) {
	rows, err := r.q.ListUserSessions(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("repo: list user sessions: %w", err)
	}
	sessions := make([]Session, 0, len(rows))
	for _, row := range rows {
		ipAddress, userAgent := sessionMetadata(row.Metadata)
		sessions = append(sessions, Session{
			ID:         row.ID,
			ExpiresAt:  fromTS(row.ExpiresAt),
			IPAddress:  ipAddress,
			UserAgent:  userAgent,
			CreatedAt:  fromTS(row.CreatedAt),
			LastAccess: fromTSPtr(row.LastAccess),
		})
	}
	return sessions, nil
}

// DeleteSession revokes one session, and only if it belongs to this user;
// otherwise it deletes nothing and reports no error, which is what the route
// wants (a session you do not own is not a session you have).
func (r *Repo) DeleteSession(ctx context.Context, userID, sessionID string) error {
	if err := r.q.DeleteSession(ctx, gen.DeleteSessionParams{
		UserID: userID,
		ID:     sessionID,
	}); err != nil {
		return fmt.Errorf("repo: delete session: %w", err)
	}
	return nil
}

// DeleteOtherSessions is "sign out everywhere else": every session of this
// user but the one the request arrived on.
func (r *Repo) DeleteOtherSessions(ctx context.Context, userID, currentSessionID string) error {
	if err := r.q.DeleteOtherSessions(ctx, gen.DeleteOtherSessionsParams{
		UserID: userID,
		ID:     currentSessionID,
	}); err != nil {
		return fmt.Errorf("repo: delete other sessions: %w", err)
	}
	return nil
}

// sessionMetadata pulls ip_address and user_agent out of Limen's metadata
// JSON, returning nil for anything it cannot find.
func sessionMetadata(metadata *string) (ipAddress, userAgent *string) {
	if metadata == nil || *metadata == "" {
		return nil, nil
	}
	var fields struct {
		IPAddress *string `json:"ip_address"`
		UserAgent *string `json:"user_agent"`
	}
	if err := json.Unmarshal([]byte(*metadata), &fields); err != nil {
		return nil, nil
	}
	return fields.IPAddress, fields.UserAgent
}
