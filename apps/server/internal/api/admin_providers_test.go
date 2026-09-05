package api_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/andersro93/mi-casa-su-casa/server/internal/testrig"
)

// Ports the route-level half of test/integration/provider-rules.test.ts and
// provider-summaries.test.ts, plus the duplicate-rule case of
// error-handling.test.ts: the owner's provider and sender-rule routes against
// a real database and the whole handler chain.

// adminPath builds an /api/admin/{slug}/… URL.
func adminPath(slug, suffix string) string { return "/api/admin/" + slug + suffix }

// createProvider posts one provider and returns its id, failing the test if
// the route refused.
func createProvider(t *testing.T, app *testrig.AppRig, cookie, slug, key, name string) string {
	t.Helper()

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/providers"),
		map[string]any{"providerKey": key, "displayName": name},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("createProvider(%q): %d %s", key, rec.Code, rec.Body.String())
	}
	provider, _ := app.JSON(t, rec)["provider"].(map[string]any)
	id, _ := provider["id"].(string)
	if id == "" {
		t.Fatalf("createProvider(%q): no id in %s", key, rec.Body.String())
	}
	return id
}

// createRule posts one sender rule and returns the recorder, so callers can
// assert on both the happy and the refused paths.
func createRule(t *testing.T, app *testrig.AppRig, cookie, slug, providerID, matchType, matchValue string) *http.Response {
	t.Helper()
	return app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
		map[string]any{"providerId": providerID, "matchType": matchType, "matchValue": matchValue},
		testrig.WithCookie(cookie)).Result()
}

func TestListProviderConfigurationsReturnsProvidersWithRuleCountsAndRules(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	createProvider(t, app, cookie, slug, "spotify", "Spotify")
	if got := createRule(t, app, cookie, slug, netflix, "domain", "netflix.com"); got.StatusCode != http.StatusCreated {
		t.Fatalf("rule: %d", got.StatusCode)
	}

	rec := app.Do(t, http.MethodGet, adminPath(slug, "/providers"), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	body := app.JSON(t, rec)

	providers, _ := body["providers"].([]any)
	if len(providers) != 2 {
		t.Fatalf("providers = %v", body["providers"])
	}
	// Ordered by display_name, and each row carries its rule count.
	first, _ := providers[0].(map[string]any)
	second, _ := providers[1].(map[string]any)
	if first["provider_key"] != "netflix" || second["provider_key"] != "spotify" {
		t.Errorf("order = %v, %v", first["provider_key"], second["provider_key"])
	}
	if first["rule_count"] != float64(1) || second["rule_count"] != float64(0) {
		t.Errorf("rule counts = %v, %v", first["rule_count"], second["rule_count"])
	}
	// snake_case keys, deliberately: it is what the SPA reads.
	for _, key := range []string{"id", "household_id", "provider_key", "display_name", "created_at"} {
		if value, ok := first[key].(string); !ok || value == "" {
			t.Errorf("provider[%q] = %v", key, first[key])
		}
	}

	rules, _ := body["rules"].([]any)
	if len(rules) != 1 {
		t.Fatalf("rules = %v", body["rules"])
	}
	rule, _ := rules[0].(map[string]any)
	if rule["match_type"] != "domain" || rule["match_value"] != "netflix.com" || rule["provider_id"] != netflix {
		t.Errorf("rule = %v", rule)
	}
}

func TestCreateProviderRefusesADuplicateKey(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	createProvider(t, app, cookie, slug, "netflix", "Netflix")

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/providers"),
		map[string]any{"providerKey": "netflix", "displayName": "Netflix Again"},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["error"]; got != "Provider key already exists" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "providers", "TRUE"); got != 1 {
		t.Errorf("providers = %d, want 1", got)
	}
}

func TestCreateProviderValidatesTheKeyAndName(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	for _, tc := range []struct {
		name, providerKey, displayName, field, message string
	}{
		{"empty key", "  ", "Netflix", "providerKey", "providerKey is required"},
		{"bad characters", "net flix", "Netflix", "providerKey",
			"providerKey may only contain lowercase letters, numbers and hyphens"},
		{"leading hyphen", "-netflix", "Netflix", "providerKey",
			"providerKey may only contain lowercase letters, numbers and hyphens"},
		{"long key", strings.Repeat("a", 41), "Netflix", "providerKey",
			"providerKey must be at most 40 characters"},
		{"empty name", "netflix", "   ", "displayName", "displayName is required"},
		{"long name", "netflix", strings.Repeat("n", 81), "displayName",
			"displayName must be at most 80 characters"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := app.Do(t, http.MethodPost, adminPath(slug, "/providers"),
				map[string]any{"providerKey": tc.providerKey, "displayName": tc.displayName},
				testrig.WithCookie(cookie))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
			}
			fields, _ := app.JSON(t, rec)["fields"].(map[string]any)
			if got := fields[tc.field]; got != tc.message {
				t.Errorf("fields[%q] = %v, want %q", tc.field, got, tc.message)
			}
		})
	}

	if got := app.Count(t, "providers", "TRUE"); got != 0 {
		t.Errorf("providers = %d, want 0", got)
	}
}

// The key is lower-cased and trimmed before it is stored, so what was checked
// is what ends up in the URL the inbox addresses the provider by.
func TestCreateProviderNormalizesTheKey(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/providers"),
		map[string]any{"providerKey": "  NetFlix  ", "displayName": "  Netflix  "},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	provider, _ := app.JSON(t, rec)["provider"].(map[string]any)
	if provider["provider_key"] != "netflix" || provider["display_name"] != "Netflix" {
		t.Errorf("provider = %v", provider)
	}
}

func TestUpdateProvider(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	spotify := createProvider(t, app, cookie, slug, "spotify", "Spotify")

	// Renaming while keeping the key must not report the provider against
	// itself.
	renamed := app.Do(t, http.MethodPatch, adminPath(slug, "/providers/"+netflix),
		map[string]any{"providerKey": "netflix", "displayName": "Netflix HD"},
		testrig.WithCookie(cookie))
	if renamed.Code != http.StatusOK {
		t.Fatalf("rename: %d %s", renamed.Code, renamed.Body.String())
	}
	provider, _ := app.JSON(t, renamed)["provider"].(map[string]any)
	if provider["display_name"] != "Netflix HD" || provider["provider_key"] != "netflix" {
		t.Errorf("provider = %v", provider)
	}

	// Taking another provider's key is a conflict.
	conflict := app.Do(t, http.MethodPatch, adminPath(slug, "/providers/"+netflix),
		map[string]any{"providerKey": "spotify", "displayName": "Netflix HD"},
		testrig.WithCookie(cookie))
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict: %d %s", conflict.Code, conflict.Body.String())
	}
	if got := app.JSON(t, conflict)["error"]; got != "Provider key already exists" {
		t.Errorf("error = %q", got)
	}

	missing := app.Do(t, http.MethodPatch, adminPath(slug, "/providers/nope"),
		map[string]any{"providerKey": "other", "displayName": "Other"},
		testrig.WithCookie(cookie))
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing: %d %s", missing.Code, missing.Body.String())
	}
	if got := app.JSON(t, missing)["error"]; got != "Provider not found" {
		t.Errorf("error = %q", got)
	}
	if spotify == "" {
		t.Error("spotify was not created")
	}
}

// Deleting a provider takes its rules with it — the messages filed under it
// carry verification codes, so nothing may outlive the mailbox.
func TestDeleteProviderCascadesItsRules(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	if got := createRule(t, app, cookie, slug, netflix, "domain", "netflix.com"); got.StatusCode != http.StatusCreated {
		t.Fatalf("rule: %d", got.StatusCode)
	}

	rec := app.Do(t, http.MethodDelete, adminPath(slug, "/providers/"+netflix), nil, testrig.WithCookie(cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := app.JSON(t, rec)["ok"]; got != true {
		t.Errorf("body = %s", rec.Body.String())
	}
	if got := app.Count(t, "providers", "TRUE"); got != 0 {
		t.Errorf("providers = %d, want 0", got)
	}
	if got := app.Count(t, "sender_rules", "TRUE"); got != 0 {
		t.Errorf("sender rules = %d, want 0", got)
	}

	again := app.Do(t, http.MethodDelete, adminPath(slug, "/providers/"+netflix), nil, testrig.WithCookie(cookie))
	if again.Code != http.StatusNotFound {
		t.Fatalf("second delete: %d %s", again.Code, again.Body.String())
	}
}

func TestCreateSenderRuleNormalizesAndValidatesMatchValues(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")

	// A domain rule drops the `@` an owner naturally types and is lower-cased.
	rec := app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
		map[string]any{"providerId": netflix, "matchType": "domain", "matchValue": " @NetFlix.com "},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	rule, _ := app.JSON(t, rec)["rule"].(map[string]any)
	if rule["match_value"] != "netflix.com" || rule["match_type"] != "domain" {
		t.Errorf("rule = %v", rule)
	}

	for _, tc := range []struct{ name, matchType, matchValue, message string }{
		{"domain that is an address", "domain", "info@netflix.com", "matchValue must be a domain like netflix.com"},
		{"domain that is a word", "domain", "netflix", "matchValue must be a domain like netflix.com"},
		{"exact that is a domain", "exact", "netflix.com", "matchValue must be a full email address"},
		{"exact that is nonsense", "exact", "not an address", "matchValue must be a full email address"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			refused := app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
				map[string]any{"providerId": netflix, "matchType": tc.matchType, "matchValue": tc.matchValue},
				testrig.WithCookie(cookie))
			if refused.Code != http.StatusBadRequest {
				t.Fatalf("status = %d %s", refused.Code, refused.Body.String())
			}
			fields, _ := app.JSON(t, refused)["fields"].(map[string]any)
			if got := fields["matchValue"]; got != tc.message {
				t.Errorf("fields[matchValue] = %v, want %q", got, tc.message)
			}
		})
	}

	// The match type itself is checked in Go rather than as an OpenAPI enum,
	// so the message is REF §A4's wording.
	badType := app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
		map[string]any{"providerId": netflix, "matchType": "regex", "matchValue": "netflix.com"},
		testrig.WithCookie(cookie))
	if badType.Code != http.StatusBadRequest {
		t.Fatalf("bad matchType: %d %s", badType.Code, badType.Body.String())
	}
	fields, _ := app.JSON(t, badType)["fields"].(map[string]any)
	if got := fields["matchType"]; got != "matchType must be exact or domain" {
		t.Errorf("fields[matchType] = %v", got)
	}
}

// The duplicate-rule case of error-handling.test.ts: a JSON 409 naming the
// column, from the global unique-violation mapping — never a bare 500.
func TestDuplicateSenderRuleIsAJSONConflict(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")

	if first := createRule(t, app, cookie, slug, netflix, "domain", "netflix.com"); first.StatusCode != http.StatusCreated {
		t.Fatalf("first rule: %d", first.StatusCode)
	}

	rec := app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
		map[string]any{"providerId": netflix, "matchType": "domain", "matchValue": "netflix.com"},
		testrig.WithCookie(cookie))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.Contains(got, "application/json") {
		t.Errorf("content-type = %q", got)
	}
	if got := app.JSON(t, rec)["error"]; got != "A record with the same household id already exists" {
		t.Errorf("error = %q", got)
	}
	if got := app.Count(t, "sender_rules", "TRUE"); got != 1 {
		t.Errorf("sender rules = %d, want 1", got)
	}
}

func TestSenderRuleRoutesRefuseAProviderFromAnotherHousehold(t *testing.T) {
	app := testrig.App(t)
	ownerCookie, slug := app.CompleteSetup(t)
	_, otherCookie := signUp(t, app, "other@example.com", "Other")
	if rec := createHousehold(t, app, otherCookie, "otra"); rec.StatusCode != http.StatusCreated {
		t.Fatalf("second household: %d", rec.StatusCode)
	}
	theirs := createProvider(t, app, otherCookie, "otra", "netflix", "Netflix")

	// The provider exists — but not in this household, so it is a 404 and not
	// a rule that files this household's mail into theirs.
	rec := createRule(t, app, ownerCookie, slug, theirs, "domain", "netflix.com")
	if rec.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d", rec.StatusCode)
	}
	if got := app.Count(t, "sender_rules", "TRUE"); got != 0 {
		t.Errorf("sender rules = %d, want 0", got)
	}
}

func TestUpdateAndDeleteSenderRule(t *testing.T) {
	app := testrig.App(t)
	cookie, slug := app.CompleteSetup(t)
	netflix := createProvider(t, app, cookie, slug, "netflix", "Netflix")
	ses := createProvider(t, app, cookie, slug, "ses", "SES")

	created := app.Do(t, http.MethodPost, adminPath(slug, "/provider-rules"),
		map[string]any{"providerId": netflix, "matchType": "domain", "matchValue": "netflix.com"},
		testrig.WithCookie(cookie))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	rule, _ := app.JSON(t, created)["rule"].(map[string]any)
	ruleID, _ := rule["id"].(string)

	repointed := app.Do(t, http.MethodPatch, adminPath(slug, "/provider-rules/"+ruleID),
		map[string]any{"providerId": ses, "matchType": "domain", "matchValue": "em.netflix.com"},
		testrig.WithCookie(cookie))
	if repointed.Code != http.StatusOK {
		t.Fatalf("patch: %d %s", repointed.Code, repointed.Body.String())
	}
	updated, _ := app.JSON(t, repointed)["rule"].(map[string]any)
	if updated["provider_id"] != ses || updated["match_value"] != "em.netflix.com" {
		t.Errorf("rule = %v", updated)
	}

	// An unknown rule and an unknown provider are told apart.
	unknownRule := app.Do(t, http.MethodPatch, adminPath(slug, "/provider-rules/nope"),
		map[string]any{"providerId": ses, "matchType": "domain", "matchValue": "x.example.com"},
		testrig.WithCookie(cookie))
	if unknownRule.Code != http.StatusNotFound || app.JSON(t, unknownRule)["error"] != "Sender rule not found" {
		t.Errorf("unknown rule: %d %s", unknownRule.Code, unknownRule.Body.String())
	}
	unknownProvider := app.Do(t, http.MethodPatch, adminPath(slug, "/provider-rules/"+ruleID),
		map[string]any{"providerId": "nope", "matchType": "domain", "matchValue": "x.example.com"},
		testrig.WithCookie(cookie))
	if unknownProvider.Code != http.StatusNotFound || app.JSON(t, unknownProvider)["error"] != "Provider not found" {
		t.Errorf("unknown provider: %d %s", unknownProvider.Code, unknownProvider.Body.String())
	}

	deleted := app.Do(t, http.MethodDelete, adminPath(slug, "/provider-rules/"+ruleID), nil, testrig.WithCookie(cookie))
	if deleted.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", deleted.Code, deleted.Body.String())
	}
	if got := app.Count(t, "sender_rules", "TRUE"); got != 0 {
		t.Errorf("sender rules = %d, want 0", got)
	}
	again := app.Do(t, http.MethodDelete, adminPath(slug, "/provider-rules/"+ruleID), nil, testrig.WithCookie(cookie))
	if again.Code != http.StatusNotFound || app.JSON(t, again)["error"] != "Sender rule not found" {
		t.Errorf("second delete: %d %s", again.Code, again.Body.String())
	}
}
