/**
 * Extracts a one-time verification code from an email body.
 *
 * Strategy:
 * 1. Look for a code keyword ("verification code", "passcode", "OTP",
 *    "code", …) and scan a short window after it for the first plausible
 *    token: digits (optionally grouped with a space or hyphen) or an
 *    uppercase alphanumeric token that contains at least one digit.
 * 2. Without a keyword, fall back to a conservative scan: return the code
 *    only when the body contains exactly one 6-digit token. Anything else
 *    yields null rather than a confident wrong code.
 */

const KEYWORD_PATTERN =
  /\b(?:(?:verification|verify|security|one[- ]?time|login|log-?in|sign[- ]?in|access|confirmation|auth(?:entication|orization)?|2fa|two[- ]factor)\s+(?:code|pin|passcode|password|otp)|passcode|otp|pin\s+code|code|kode|c[oó]digo|codice)\b/gi;

/** How far after a keyword we look for the token. */
const WINDOW_CHARS = 80;

const TOKEN_SCAN = /[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]|[A-Za-z0-9]/g;

function isYearLike(digits: string) {
  return /^(19|20)\d{2}$/.test(digits);
}

function precededByRejectedSymbol(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 2), index);
  return /[#$€£+%]$/.test(before) || /&#$/.test(before);
}

function normalizeDigits(token: string) {
  return token.replace(/[ -]/g, "");
}

/** Returns a plausible code at the start of `chunk`, or null. */
function codeFromChunk(chunk: string): string | null {
  const grouped = chunk.match(/^(\d{3,4})[ -](\d{3,4})$/);
  if (grouped) {
    return `${grouped[1]}${grouped[2]}`;
  }

  if (/^\d+$/.test(chunk)) {
    if (chunk.length < 4 || chunk.length > 8) return null;
    if (isYearLike(chunk)) return null;
    return chunk;
  }

  if (
    /^[A-Z0-9]{5,10}$/.test(chunk) &&
    /\d/.test(chunk) &&
    /[A-Z]/.test(chunk)
  ) {
    return chunk;
  }

  return null;
}

function scanWindow(
  window: string,
  fullText: string,
  offset: number,
): string | null {
  const re = new RegExp(TOKEN_SCAN.source, "g");
  let match: RegExpExecArray | null = re.exec(window);
  while (match) {
    const start = offset + match.index;
    if (!precededByRejectedSymbol(fullText, start)) {
      // A token run can be a sentence fragment ("is valid for 10 minutes");
      // try each word-ish piece inside it in order.
      const pieces = match[0].split(
        /(?<=\d)[ -](?=\D)|(?<=\D)[ -](?=\d)|(?<=\D)[ -](?=\D)/,
      );
      for (const piece of pieces) {
        const trimmed = piece.trim();
        if (!trimmed) continue;
        // Re-split grouped digit pairs like "123 456" or "123-456" kept intact.
        const code = codeFromChunk(trimmed);
        if (code) return code;
        // Fallback: split into single tokens.
        for (const single of trimmed.split(/[ -]/)) {
          const singleCode = codeFromChunk(single);
          if (singleCode) return singleCode;
        }
      }
    }
    match = re.exec(window);
  }
  return null;
}

export function extractVerificationCode(text: string): string | null {
  const keywordRe = new RegExp(KEYWORD_PATTERN.source, "gi");
  let keyword: RegExpExecArray | null = keywordRe.exec(text);
  while (keyword) {
    const start = keyword.index + keyword[0].length;
    const window = text.slice(start, start + WINDOW_CHARS);
    const code = scanWindow(window, text, start);
    if (code) {
      return code;
    }
    keyword = keywordRe.exec(text);
  }

  return fallbackCode(text);
}

/**
 * Without a keyword we only trust the most common OTP shape — a single,
 * unambiguous 6-digit token (optionally grouped 3-3). Zip codes, phone
 * fragments, order numbers and years are deliberately not guessed.
 */
function fallbackCode(text: string): string | null {
  const sixDigit = new Set<string>();

  for (const match of text.matchAll(/\b(\d{3}[ -]\d{3}|\d{6})\b/g)) {
    if (precededByRejectedSymbol(text, match.index ?? 0)) continue;
    const digits = normalizeDigits(match[1] ?? "");
    if (isYearLike(digits)) continue;
    sixDigit.add(digits);
  }

  return sixDigit.size === 1 ? ([...sixDigit][0] ?? null) : null;
}
