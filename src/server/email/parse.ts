import PostalMime from "postal-mime";

import type { ParsedIncomingEmail } from "../db/types";

/** Bodies beyond this are cut; verification codes live in the first few KB. */
export const MAX_TEXT_BODY_CHARS = 64 * 1024;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Messages without a Message-ID get a deterministic synthetic one so a
 * redelivery of the same message is still de-duplicated.
 */
async function syntheticMessageId(parts: {
  from: string;
  to: string;
  date: string | null;
  subject: string | null;
  body: string;
}) {
  const hash = await sha256Hex(
    [
      parts.from,
      parts.to,
      parts.date ?? "",
      parts.subject ?? "",
      parts.body,
    ].join("\u0000"),
  );
  return `<synthetic-${hash.slice(0, 32)}@mi-casa-su-casa>`;
}

function extractHouseholdSlug(address: string): string | null {
  const normalized = address.trim().toLowerCase();
  const localPart = normalized.split("@")[0]?.trim();

  if (!localPart) {
    return null;
  }

  return /^[a-z0-9-]+$/.test(localPart) ? localPart : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function parseIncomingEmail(
  message: ForwardableEmailMessage,
): Promise<ParsedIncomingEmail> {
  const parser = new PostalMime({ attachmentEncoding: "arraybuffer" });
  const parsed = await parser.parse(
    await new Response(message.raw).arrayBuffer(),
  );
  const fullTextBody =
    parsed.text?.trim() ||
    (parsed.html ? stripHtml(parsed.html) : "") ||
    "[empty email body]";
  const textBodyTruncated = fullTextBody.length > MAX_TEXT_BODY_CHARS;
  const textBody = textBodyTruncated
    ? `${fullTextBody.slice(0, MAX_TEXT_BODY_CHARS)}\n[truncated]`
    : fullTextBody;

  const header = (name: string) =>
    parsed.headers.find((entry) => entry.key.toLowerCase() === name)?.value ??
    null;
  const subject = parsed.subject ?? null;
  const dateHeader = header("date");
  const messageId =
    header("message-id") ??
    (await syntheticMessageId({
      from: message.from,
      to: message.to,
      date: dateHeader,
      subject,
      body: textBody,
    }));

  return {
    envelopeFrom: message.from,
    envelopeTo: message.to,
    householdSlug: extractHouseholdSlug(message.to),
    fromHeader: header("from"),
    subject,
    messageId,
    dateHeader,
    textBody,
    textBodyTruncated,
    rawSize: message.rawSize,
  };
}
