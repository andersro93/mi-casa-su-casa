import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { isUniqueViolation, uniqueViolationTarget } from "../db/errors";
import { logEvent, requestFields } from "../runtime/log";

/**
 * Last-resort error handler for the API: every failure becomes a JSON
 * `{ error }` body (the client expects that shape), UNIQUE violations map to
 * 409 instead of 500, and unexpected errors are logged with request context.
 */
export function handleApiError(error: unknown, c: Context): Response {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message || "Request failed" }, error.status);
  }

  if (isUniqueViolation(error)) {
    const target = uniqueViolationTarget(error);
    return c.json(
      {
        error: target
          ? `A record with the same ${describeUniqueTarget(target)} already exists`
          : "A record with the same values already exists",
      },
      409,
    );
  }

  logEvent("error", "unhandled_error", {
    ...requestFields(c),
    error: error instanceof Error ? error.message : String(error),
  });

  return c.json({ error: "Internal error" }, 500);
}

function describeUniqueTarget(target: string): string {
  // "households.slug" → "slug"; "sender_rules.household_id, …" → first column
  const column = target.split(".").at(-1) ?? target;
  return column.replace(/_/g, " ");
}
