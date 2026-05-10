import PostalMime from "postal-mime";

import type { ParsedIncomingEmail } from "../db/types";

export async function parseIncomingEmail(
  message: ForwardableEmailMessage,
): Promise<ParsedIncomingEmail> {
  const parser = new PostalMime({ attachmentEncoding: "arraybuffer" });
  const parsed = await parser.parse(
    await new Response(message.raw).arrayBuffer(),
  );

  return {
    envelopeFrom: message.from,
    envelopeTo: message.to,
    fromHeader:
      parsed.headers.find((header) => header.key.toLowerCase() === "from")
        ?.value ?? null,
    subject: parsed.subject ?? null,
    messageId:
      parsed.headers.find((header) => header.key.toLowerCase() === "message-id")
        ?.value ?? null,
    dateHeader:
      parsed.headers.find((header) => header.key.toLowerCase() === "date")
        ?.value ?? null,
    textBody:
      parsed.text?.trim() || parsed.html?.replace(/<[^>]+>/g, " ").trim() || "",
    rawSize: message.rawSize,
  };
}
