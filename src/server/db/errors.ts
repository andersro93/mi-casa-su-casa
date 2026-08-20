/**
 * Drizzle wraps D1 errors (DrizzleQueryError → cause → D1_ERROR → cause …).
 * Walk the chain to the innermost Error.
 */
export function unwrapDatabaseError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  let current: Error = error;
  const seen = new Set<Error>();

  while (current.cause instanceof Error && !seen.has(current)) {
    seen.add(current);
    current = current.cause;
  }

  return current;
}

function messagesInChain(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string") {
      messages.push(message);
    }
    current = (current as { cause?: unknown }).cause;
  }

  return messages;
}

/** True when any error in the chain is a SQLite UNIQUE constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return messagesInChain(error).some((message) =>
    /UNIQUE constraint failed/i.test(message),
  );
}

/** Columns named in the first UNIQUE violation message, e.g. "households.slug". */
export function uniqueViolationTarget(error: unknown): string | null {
  for (const message of messagesInChain(error)) {
    const match = message.match(/UNIQUE constraint failed: ([^\s(:]+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}
