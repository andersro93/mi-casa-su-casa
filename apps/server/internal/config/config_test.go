package config

import (
	"os"
	"strings"
	"testing"
)

// minimal returns the smallest env map that Load accepts, mirroring the
// design spec's required-variable table (docs/superpowers/specs/
// 2026-09-04-go-backend-migration-design.md, "config" section).
func minimal() map[string]string {
	return map[string]string{
		"DATABASE_URL":                "postgres://micasa:pw@localhost:5432/micasa",
		"APP_URL":                     "https://micasa.example.com",
		"AUTH_SECRET":                 strings.Repeat("a", 32),
		"SETUP_SECRET":                "correct-horse-battery-staple",
		"OWNER_EMAIL":                 "owner@example.com",
		"EMAIL_DOMAIN":                "inbox.example.com",
		"MAILGUN_WEBHOOK_SIGNING_KEY": "mailgun-signing-key",
		"SMTP_URL":                    "smtp://user:pass@smtp.example.com:587",
		"OUTBOUND_EMAIL_FROM":         "noreply@example.com",
	}
}

// clone copies base and applies overrides; a "" value deletes the key so
// tests can simulate an unset variable.
func clone(base map[string]string, overrides map[string]string) map[string]string {
	out := make(map[string]string, len(base)+len(overrides))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overrides {
		if v == "" {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

func TestLoad_AcceptsMinimalConfiguration(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.DatabaseURL != "postgres://micasa:pw@localhost:5432/micasa" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
}

func TestLoad_RequiredVariableMissingIsReportedByName(t *testing.T) {
	for _, field := range []string{
		"DATABASE_URL",
		"APP_URL",
		"AUTH_SECRET",
		"SETUP_SECRET",
		"OWNER_EMAIL",
		"EMAIL_DOMAIN",
		"MAILGUN_WEBHOOK_SIGNING_KEY",
		"SMTP_URL",
		"OUTBOUND_EMAIL_FROM",
	} {
		t.Run(field, func(t *testing.T) {
			_, err := Load(clone(minimal(), map[string]string{field: ""}))
			if err == nil {
				t.Fatalf("expected error for missing %s, got nil", field)
			}
			if !strings.Contains(err.Error(), field) {
				t.Errorf("error %q does not mention %s", err.Error(), field)
			}
		})
	}
}

func TestLoad_ReportsAllProblemsAtOnce(t *testing.T) {
	// One restart per mistake makes first-run setup miserable, so a bad
	// config must name every fault in a single error.
	_, err := Load(clone(minimal(), map[string]string{
		"DATABASE_URL": "",
		"APP_URL":      "not-a-url",
		"AUTH_SECRET":  "short",
	}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	msg := err.Error()
	for _, want := range []string{"DATABASE_URL", "APP_URL", "AUTH_SECRET"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error %q does not mention %s", msg, want)
		}
	}
}

func TestLoad_RejectsShortAuthSecret(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"AUTH_SECRET": strings.Repeat("a", 31)}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "must be at least 32 characters (openssl rand -hex 32)") {
		t.Errorf("error %q does not carry the expected message", err.Error())
	}
}

func TestLoad_AcceptsExactly32ByteAuthSecret(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"AUTH_SECRET": strings.Repeat("a", 32)}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestLoad_AppURLMustBeAbsolute(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"APP_URL": "not-a-url"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "APP_URL") {
		t.Errorf("error %q does not mention APP_URL", err.Error())
	}
}

func TestLoad_AppURLRejectsRelativePath(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"APP_URL": "/just-a-path"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "APP_URL") {
		t.Errorf("error %q does not mention APP_URL", err.Error())
	}
}

func TestLoad_AppURLRejectsHTTPOutsideDevelopment(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"APP_URL": "http://micasa.example.com"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "must use https outside development") {
		t.Errorf("error %q does not carry the expected message", err.Error())
	}
}

func TestLoad_AppURLAllowsHTTPInDevelopment(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{
		"APP_URL":     "http://localhost:3000",
		"ENVIRONMENT": "development",
	}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.AppURL != "http://localhost:3000" {
		t.Errorf("AppURL = %q", cfg.AppURL)
	}
}

func TestLoad_AppURLAllowsHTTPInTest(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{
		"APP_URL":     "http://localhost:3000",
		"ENVIRONMENT": "test",
	}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestLoad_OwnerEmailMustLookLikeAnEmail(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"OWNER_EMAIL": "not-an-email"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "OWNER_EMAIL") {
		t.Errorf("error %q does not mention OWNER_EMAIL", err.Error())
	}
}

func TestLoad_OwnerEmailIsLowerCased(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{"OWNER_EMAIL": "Owner@Example.COM"}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.OwnerEmail != "owner@example.com" {
		t.Errorf("OwnerEmail = %q, want owner@example.com", cfg.OwnerEmail)
	}
}

func TestLoad_EmailDomainMustMatchHostnameRegex(t *testing.T) {
	for _, bad := range []string{"not a domain", "-leading-hyphen.com", "no-tld", "trailing-dot.com."} {
		t.Run(bad, func(t *testing.T) {
			_, err := Load(clone(minimal(), map[string]string{"EMAIL_DOMAIN": bad}))
			if err == nil {
				t.Fatalf("expected error for EMAIL_DOMAIN=%q, got nil", bad)
			}
			if !strings.Contains(err.Error(), "EMAIL_DOMAIN") {
				t.Errorf("error %q does not mention EMAIL_DOMAIN", err.Error())
			}
		})
	}
}

func TestLoad_EmailDomainAcceptsAHostname(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{"EMAIL_DOMAIN": "netflix.com"}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.EmailDomain != "netflix.com" {
		t.Errorf("EmailDomain = %q", cfg.EmailDomain)
	}
}

func TestLoad_SMTPURLMustParseWithSMTPScheme(t *testing.T) {
	for _, bad := range []string{"not-a-url", "https://smtp.example.com:587", "smtp://"} {
		t.Run(bad, func(t *testing.T) {
			_, err := Load(clone(minimal(), map[string]string{"SMTP_URL": bad}))
			if err == nil {
				t.Fatalf("expected error for SMTP_URL=%q, got nil", bad)
			}
			if !strings.Contains(err.Error(), "SMTP_URL") {
				t.Errorf("error %q does not mention SMTP_URL", err.Error())
			}
		})
	}
}

func TestLoad_SMTPURLAcceptsSMTPS(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{"SMTP_URL": "smtps://user:pass@smtp.example.com:465"}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.SMTPURL != "smtps://user:pass@smtp.example.com:465" {
		t.Errorf("SMTPURL = %q", cfg.SMTPURL)
	}
}

func TestLoad_OutboundEmailFromMustBeAnEmail(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"OUTBOUND_EMAIL_FROM": "not-an-email"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "OUTBOUND_EMAIL_FROM") {
		t.Errorf("error %q does not mention OUTBOUND_EMAIL_FROM", err.Error())
	}
}

func TestLoad_PortDefaultsTo3000(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Port != 3000 {
		t.Errorf("Port = %d, want 3000", cfg.Port)
	}
}

func TestLoad_RejectsNonNumericPort(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"PORT": "abc"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "PORT") {
		t.Errorf("error %q does not mention PORT", err.Error())
	}
}

func TestLoad_RejectsZeroPort(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"PORT": "0"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "PORT") {
		t.Errorf("error %q does not mention PORT", err.Error())
	}
}

func TestLoad_TrustedProxyHopsDefaultsToZero(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.TrustedProxyHops != 0 {
		t.Errorf("TrustedProxyHops = %d, want 0", cfg.TrustedProxyHops)
	}
}

func TestLoad_RejectsNegativeProxyHops(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"TRUSTED_PROXY_HOPS": "-1"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "TRUSTED_PROXY_HOPS") {
		t.Errorf("error %q does not mention TRUSTED_PROXY_HOPS", err.Error())
	}
}

func TestLoad_AppNameDefaultsToMiCasaSuCasa(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.AppName != "Mi Casa Su Casa" {
		t.Errorf("AppName = %q, want Mi Casa Su Casa", cfg.AppName)
	}
}

func TestLoad_AppNameOverride(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{"APP_NAME": "Casa Refsdal"}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.AppName != "Casa Refsdal" {
		t.Errorf("AppName = %q", cfg.AppName)
	}
}

func TestLoad_EnvironmentDefaultsToProduction(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Environment != "production" {
		t.Errorf("Environment = %q, want production", cfg.Environment)
	}
}

func TestLoad_RejectsUnknownEnvironment(t *testing.T) {
	_, err := Load(clone(minimal(), map[string]string{"ENVIRONMENT": "staging"}))
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "ENVIRONMENT") {
		t.Errorf("error %q does not mention ENVIRONMENT", err.Error())
	}
}

func TestLoad_LogLevelDefaultsToInfo(t *testing.T) {
	cfg, err := Load(minimal())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
}

func TestLoad_LogLevelOverride(t *testing.T) {
	cfg, err := Load(clone(minimal(), map[string]string{"LOG_LEVEL": "debug"}))
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q", cfg.LogLevel)
	}
}

func TestIsDevelopmentLike(t *testing.T) {
	tests := []struct {
		environment string
		want        bool
	}{
		{"development", true},
		{"test", true},
		{"production", false},
	}
	for _, tt := range tests {
		t.Run(tt.environment, func(t *testing.T) {
			overrides := map[string]string{"ENVIRONMENT": tt.environment}
			if tt.environment != "production" {
				overrides["APP_URL"] = "http://localhost:3000"
			}
			cfg, err := Load(clone(minimal(), overrides))
			if err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
			if got := cfg.IsDevelopmentLike(); got != tt.want {
				t.Errorf("IsDevelopmentLike() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestFromOS_WrapsOSEnviron(t *testing.T) {
	for k, v := range minimal() {
		t.Setenv(k, v)
	}
	// Ensure no ambient PORT from the host leaks in.
	t.Setenv("PORT", "4242")

	cfg, err := FromOS()
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.DatabaseURL != os.Getenv("DATABASE_URL") {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.Port != 4242 {
		t.Errorf("Port = %d, want 4242", cfg.Port)
	}
}
