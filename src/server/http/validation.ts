import type { Context } from "hono";
import type { z } from "zod";

export type ParsedBody<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/**
 * Parses and validates a JSON request body against a zod schema. Returns a
 * ready-made 400 JSON response listing the first problem per field so the
 * client can show something actionable.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<ParsedBody<z.infer<S>>> {
  let raw: unknown;
  try {
    const text = await c.req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: c.json({ error: "Invalid JSON body" }, 400) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!(key in fields)) fields[key] = issue.message;
    }
    const summary = Object.entries(fields)
      .map(([key, message]) =>
        key === "_" || message.startsWith(key) ? message : `${key}: ${message}`,
      )
      .join("; ");
    return {
      ok: false,
      response: c.json({ error: summary || "Invalid request", fields }, 400),
    };
  }

  return { ok: true, data: result.data };
}
