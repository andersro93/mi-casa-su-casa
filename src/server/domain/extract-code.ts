const KEYWORD_PATTERNS = [
  /verification code\s*(?:is|:)?\s*([A-Z0-9-]{4,12})/i,
  /security code\s*(?:is|:)?\s*([A-Z0-9-]{4,12})/i,
  /one[- ]time code\s*(?:is|:)?\s*([A-Z0-9-]{4,12})/i,
  /passcode\s*(?:is|:)?\s*([A-Z0-9-]{4,12})/i,
  /code\s*(?:is|:)?\s*([0-9]{4,8})/i,
];

const FALLBACK_PATTERN = /\b([0-9]{4,8})\b/;

export function extractVerificationCode(text: string): string | null {
  for (const pattern of KEYWORD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const fallback = text.match(FALLBACK_PATTERN);
  return fallback?.[1] ?? null;
}
