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
  const { headers: initHeaders, ...restInit } = init ?? {};
  const response = await fetch(input, {
    credentials: "include",
    ...restInit,
    headers: {
      "Content-Type": "application/json",
      ...(initHeaders as Record<string, string> | undefined),
    },
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

export function getUserInitials(
  session: SessionData | null | undefined,
): string {
  const name = session?.user?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
  }

  const email = session?.user?.email?.trim();
  if (!email) {
    return "FM";
  }

  const localPart = email.split("@")[0] ?? email;
  const tokens = localPart.split(/[^A-Za-z0-9]+/).filter(Boolean);

  if (tokens.length >= 2) {
    return `${tokens[0][0] ?? ""}${tokens.at(-1)?.[0] ?? ""}`.toUpperCase();
  }

  const fallback = localPart.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);

  return (fallback || "FM").toUpperCase();
}

const AVATAR_COLORS = [
  "#1976d2",
  "#388e3c",
  "#d32f2f",
  "#7b1fa2",
  "#f57c00",
  "#0097a7",
  "#5d4037",
  "#455a64",
];

export function stringToColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (
    AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
  );
}

/** MUI Avatar props (background colour + initials) derived from a name. */
export function stringAvatar(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  return {
    sx: { bgcolor: stringToColor(name) },
    children: initials || "?",
  };
}

/**
 * Human relative time for message ages: "just now", "5 min ago", "2 hr ago",
 * "yesterday 10:44", then a short date. Codes are only useful for minutes,
 * so the near end of the scale is the precise one.
 */
export function formatRelativeTime(
  value: string,
  now: number = Date.now(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffSeconds = Math.round((now - date.getTime()) / 1000);
  if (diffSeconds < 45) return "just now";
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const time = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(date);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday.getTime() - 86_400_000;
  if (date.getTime() >= startOfYesterday) return `yesterday ${time}`;
  const days = Math.round(
    (startOfToday.getTime() - date.getTime()) / 86_400_000,
  );
  if (days < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(date);
    return `${weekday} ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}
