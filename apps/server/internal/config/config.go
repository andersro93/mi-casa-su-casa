// Package config loads and validates Mi Casa Su Casa's process
// configuration from environment variables. This replaces
// apps/server/src/env.ts (the Workers env-var contract): the same "parse
// once at startup, fail loudly with every problem at once" rule applies, so
// a malformed DATABASE_URL kills the container on boot — a crash-looping
// pod is loud and obvious — rather than surfacing as a 500 on the first
// request that happens to touch the database.
//
// See docs/superpowers/specs/2026-09-04-go-backend-migration-design.md,
// "config" section, for the authoritative variable table this file
// implements.
package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Config is the process's validated configuration. Every field is
// populated by Load; there is no lazy or partial state.
type Config struct {
	DatabaseURL       string
	AppURL            string
	AppName           string
	AuthSecret        string
	SetupSecret       string
	OwnerEmail        string
	EmailDomain       string
	MailgunSigningKey string
	SMTPURL           string
	OutboundFrom      string
	Environment       string
	LogLevel          string

	Port             int
	TrustedProxyHops int
}

// hostnamePattern matches a bare domain such as "netflix.com" or
// "mail.example.co.uk" — the shape EMAIL_DOMAIN must have. Go's regexp
// (RE2) has no lookahead, so the design spec's
// `^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`
// loses its length assertion here; isValidHostname below checks the
// 1..253 character bound separately before applying this pattern.
var hostnamePattern = regexp.MustCompile(`^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

// problemCollector accumulates every validation failure instead of
// short-circuiting on the first one — one restart per mistake makes
// first-run setup miserable.
type problemCollector struct {
	problems []string
}

func (p *problemCollector) add(field, message string) {
	p.problems = append(p.problems, fmt.Sprintf("%s: %s", field, message))
}

// requireNonEmpty reads env[field], reporting it missing if absent/empty.
// Returns the value and whether it was present.
func (p *problemCollector) requireNonEmpty(env map[string]string, field string) (string, bool) {
	v := env[field]
	if v == "" {
		p.add(field, fmt.Sprintf("%s is required", field))
		return "", false
	}
	return v, true
}

// isAbsoluteURL reports whether v parses as an absolute URL with a scheme
// and host.
func isAbsoluteURL(v string) bool {
	u, err := url.Parse(v)
	if err != nil {
		return false
	}
	return u.Scheme != "" && u.Host != ""
}

// isValidEmail reports whether v looks like a single email address.
func isValidEmail(v string) bool {
	addr, err := mail.ParseAddress(v)
	if err != nil {
		return false
	}
	// mail.ParseAddress accepts "Name <addr>" and bare comments; reject
	// anything that round-trips to more than the address itself so a
	// stray display name does not sneak through as a "from" address.
	return addr.Address == v
}

// isValidHostname reports whether v matches EMAIL_DOMAIN's expected shape:
// a lower-case, dot-separated hostname such as "netflix.com". Go's RE2
// engine has no lookahead, so the length bound the design spec's regex
// enforces via `(?=.{1,253}$)` is checked here instead of in the pattern.
func isValidHostname(v string) bool {
	if len(v) < 1 || len(v) > 253 {
		return false
	}
	return hostnamePattern.MatchString(v)
}

// isValidSMTPURL reports whether v parses with scheme smtp/smtps and a
// host — the shape internal/smtp will dial.
func isValidSMTPURL(v string) bool {
	u, err := url.Parse(v)
	if err != nil {
		return false
	}
	if u.Scheme != "smtp" && u.Scheme != "smtps" {
		return false
	}
	return u.Host != ""
}

// Load parses and validates configuration from a plain string map (the
// shape both a real environ and a test fixture share). It reports EVERY
// invalid or missing field in a single error, never just the first.
func Load(env map[string]string) (*Config, error) {
	p := &problemCollector{}
	cfg := &Config{}

	if v, ok := p.requireNonEmpty(env, "DATABASE_URL"); ok {
		cfg.DatabaseURL = v
	}

	// ENVIRONMENT is read up front: APP_URL's https requirement depends on
	// it, so it must be resolved (and defaulted) before APP_URL is checked.
	cfg.Environment = "production"
	if v, present := env["ENVIRONMENT"]; present && v != "" {
		switch v {
		case "development", "test", "production":
			cfg.Environment = v
		default:
			p.add("ENVIRONMENT", `must be one of "development", "test" or "production"`)
		}
	}
	developmentLike := cfg.Environment == "development" || cfg.Environment == "test"

	if v, ok := p.requireNonEmpty(env, "APP_URL"); ok {
		if !isAbsoluteURL(v) {
			p.add("APP_URL", "must be a valid absolute URL")
		} else if !developmentLike && !strings.HasPrefix(v, "https://") {
			p.add("APP_URL", "must use https outside development")
		} else {
			cfg.AppURL = v
		}
	}

	if v, ok := p.requireNonEmpty(env, "AUTH_SECRET"); ok {
		if len(v) < 32 {
			p.add("AUTH_SECRET", "must be at least 32 characters (openssl rand -hex 32)")
		} else {
			cfg.AuthSecret = v
		}
	}

	if v, ok := p.requireNonEmpty(env, "SETUP_SECRET"); ok {
		cfg.SetupSecret = v
	}

	if v, ok := p.requireNonEmpty(env, "OWNER_EMAIL"); ok {
		lower := strings.ToLower(v)
		if !isValidEmail(lower) {
			p.add("OWNER_EMAIL", "must be a valid email address")
		} else {
			cfg.OwnerEmail = lower
		}
	}

	if v, ok := p.requireNonEmpty(env, "EMAIL_DOMAIN"); ok {
		if !isValidHostname(v) {
			p.add("EMAIL_DOMAIN", "must be a domain like netflix.com")
		} else {
			cfg.EmailDomain = v
		}
	}

	if v, ok := p.requireNonEmpty(env, "MAILGUN_WEBHOOK_SIGNING_KEY"); ok {
		cfg.MailgunSigningKey = v
	}

	if v, ok := p.requireNonEmpty(env, "SMTP_URL"); ok {
		if !isValidSMTPURL(v) {
			p.add("SMTP_URL", "must be a valid smtp:// or smtps:// URL")
		} else {
			cfg.SMTPURL = v
		}
	}

	if v, ok := p.requireNonEmpty(env, "OUTBOUND_EMAIL_FROM"); ok {
		if !isValidEmail(v) {
			p.add("OUTBOUND_EMAIL_FROM", "must be a valid email address")
		} else {
			cfg.OutboundFrom = v
		}
	}

	cfg.AppName = "Mi Casa Su Casa"
	if v, present := env["APP_NAME"]; present && v != "" {
		cfg.AppName = v
	}

	cfg.LogLevel = "info"
	if v, present := env["LOG_LEVEL"]; present && v != "" {
		cfg.LogLevel = v
	}

	cfg.Port = 3000
	if v, present := env["PORT"]; present && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			p.add("PORT", "must be a valid integer")
		} else if n <= 0 {
			p.add("PORT", "must be positive")
		} else {
			cfg.Port = n
		}
	}

	cfg.TrustedProxyHops = 0
	if v, present := env["TRUSTED_PROXY_HOPS"]; present && v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			p.add("TRUSTED_PROXY_HOPS", "must be a valid integer")
		} else if n < 0 {
			p.add("TRUSTED_PROXY_HOPS", "must be at least 0")
		} else {
			cfg.TrustedProxyHops = n
		}
	}

	if len(p.problems) > 0 {
		return nil, fmt.Errorf("invalid configuration:\n  %s", strings.Join(p.problems, "\n  "))
	}
	return cfg, nil
}

// FromOS loads configuration from the process's real environment.
func FromOS() (*Config, error) {
	env := make(map[string]string, len(os.Environ()))
	for _, kv := range os.Environ() {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			continue
		}
		env[k] = v
	}
	return Load(env)
}

// IsDevelopmentLike reports whether ENVIRONMENT is "development" or
// "test" — the cases where APP_URL may use http:// and other
// production-only guards relax.
func (c *Config) IsDevelopmentLike() bool {
	return c.Environment == "development" || c.Environment == "test"
}
