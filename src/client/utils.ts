import type { SessionData } from "./types";

export function buildHouseholdPath(slug: string, path: string = "") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${slug}${normalizedPath}`;
}

export function buildHouseholdApiPath(slug: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath.startsWith("/inbox/") || normalizedPath === "/inbox") {
    return `/api/inbox/${slug}${normalizedPath.slice("/inbox".length)}`;
  }

  if (normalizedPath.startsWith("/admin/") || normalizedPath === "/admin") {
    return `/api/admin/${slug}${normalizedPath.slice("/admin".length)}`;
  }

  return `/api${buildHouseholdPath(slug, normalizedPath)}`;
}

export function getProviderAccessToggleRequest(shouldHaveAccess: boolean): {
  method: "POST" | "DELETE";
  statusMessage: string;
} {
  return shouldHaveAccess
    ? {
        method: "POST",
        statusMessage: "Provider access granted.",
      }
    : {
        method: "DELETE",
        statusMessage: "Provider access revoked.",
      };
}

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

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(
      `Expected JSON response but received ${contentType || "unknown content type"}: ${text.slice(0, 120)}`,
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
