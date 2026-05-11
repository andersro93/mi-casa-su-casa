import type { SessionData } from "./types";

export async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    throw new Error(
      payload?.error ?? `Request failed with status ${response.status}`,
    );
  }

  return (await response.json()) as T;
}

export function formatTimestamp(value: string | null): string {
  if (!value) {
    return "No messages yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function getDisplayName(
  session: SessionData | null | undefined,
): string {
  const name = session?.user?.name?.trim();
  if (name) {
    return name;
  }

  return session?.user?.email ?? "family member";
}
