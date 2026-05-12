async function hashValue(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createInvitationToken() {
  const token = crypto.randomUUID();
  const tokenHash = await hashValue(token);

  return { token, tokenHash };
}

export async function hashInvitationToken(token: string) {
  return hashValue(token);
}
