/**
 * Constant-time comparison of two secrets. Both values are hashed first so
 * the comparison always runs over equal-length buffers and neither the
 * length nor the position of the first difference leaks through timing.
 */
export async function secretsEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i += 1) {
    diff |= (da[i] ?? 0) ^ (db[i] ?? 0);
  }
  return diff === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}
