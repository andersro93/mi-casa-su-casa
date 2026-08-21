/**
 * Better Auth stores timestamps as epoch milliseconds (integer) while the
 * Drizzle mappers may already hand back Date objects and app tables use ISO
 * text. Normalise all of them to ISO-8601 strings for API responses.
 */
export function normalizeTimestamp(
  value: Date | number | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  const numeric = Number(value);
  if (value.trim() !== "" && Number.isFinite(numeric)) {
    return new Date(numeric).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}
