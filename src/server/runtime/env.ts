export type EnvProblem = { key: string; message: string };

export type EnvValidation =
  | { ok: true; problems: [] }
  | { ok: false; problems: EnvProblem[] };

const MIN_AUTH_SECRET_LENGTH = 32;

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function isDevelopmentLike(environment: unknown): boolean {
  return environment === "development" || environment === "test";
}

/**
 * Checks that every variable and binding the Worker needs at runtime is
 * present and well-formed. Workers do not set NODE_ENV, so libraries such as
 * Better Auth will silently fall back to insecure defaults (e.g. a public
 * session secret) unless we fail fast ourselves.
 */
export function validateEnv(env: Partial<Env> | Env): EnvValidation {
  const problems: EnvProblem[] = [];

  if (isBlank(env.AUTH_SECRET)) {
    problems.push({ key: "AUTH_SECRET", message: "is required" });
  } else if ((env.AUTH_SECRET as string).length < MIN_AUTH_SECRET_LENGTH) {
    problems.push({
      key: "AUTH_SECRET",
      message: `must be at least ${MIN_AUTH_SECRET_LENGTH} characters (openssl rand -hex 32)`,
    });
  }

  if (isBlank(env.APP_URL)) {
    problems.push({
      key: "APP_URL",
      message: "is required (full URL of this deployment)",
    });
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(env.APP_URL as string);
    } catch {
      problems.push({ key: "APP_URL", message: "must be an absolute URL" });
    }

    if (
      parsed &&
      parsed.protocol !== "https:" &&
      !isDevelopmentLike(env.ENVIRONMENT)
    ) {
      problems.push({
        key: "APP_URL",
        message: "must use https outside development",
      });
    }
  }

  if (isBlank(env.OUTBOUND_EMAIL_FROM)) {
    problems.push({
      key: "OUTBOUND_EMAIL_FROM",
      message: "is required (sender address for invitation and reset emails)",
    });
  }

  if (!env.DB) {
    problems.push({ key: "DB", message: "D1 binding is missing" });
  }

  if (!env.EMAIL) {
    problems.push({ key: "EMAIL", message: "send_email binding is missing" });
  }

  return problems.length === 0
    ? { ok: true, problems: [] }
    : { ok: false, problems };
}

export class EnvValidationError extends Error {
  readonly problems: EnvProblem[];

  constructor(problems: EnvProblem[]) {
    super(
      `Worker is misconfigured: ${problems
        .map((problem) => `${problem.key} ${problem.message}`)
        .join("; ")}`,
    );
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/** Throws an EnvValidationError when the environment is incomplete. */
export function assertValidEnv(env: Env): void {
  const result = validateEnv(env);
  if (!result.ok) {
    throw new EnvValidationError(result.problems);
  }
}
