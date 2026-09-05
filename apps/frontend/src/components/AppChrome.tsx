/**
 * The authenticated chrome: sidebar, app bar and household switcher, with the
 * current view in the outlet. It wraps the household routes *and* the two
 * account-level ones (`/settings`, `/new-household`), which is where the
 * pre-router `App.tsx` rendered them too.
 *
 * The household list comes from the shared query rather than local state, so
 * a rename, a new household or a departure shows up the moment the query is
 * invalidated — and the guards that redirect on the same data can never
 * disagree with what the sidebar shows.
 */
import { Box, CircularProgress } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { useAppMessages } from "../lib/messages";
import {
  clearAuthQueries,
  signOutAndReset,
  useHouseholds,
  useSessionData,
} from "../lib/session";
import type { HouseholdSummary } from "../types";
import { getActiveView, Layout } from "./Layout";

/** Shown while a view's chunk loads. */
export function ViewFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

/**
 * Switching household keeps you on the same kind of page where that makes
 * sense — but an owner-only view falls back to the inbox when the household
 * you switch into only knows you as a member.
 */
function householdDestination(household: HouseholdSummary, view: string) {
  const params = { slug: household.slug } as const;
  const isOwner = household.role === "owner";

  if (view === "settings") return { to: "/$slug/settings", params } as const;
  if (view === "quarantine" && isOwner) {
    return { to: "/$slug/quarantine", params } as const;
  }
  if (view === "members" && isOwner) {
    return { to: "/$slug/members", params } as const;
  }
  if (view === "providers" && isOwner) {
    return { to: "/$slug/providers", params } as const;
  }
  return { to: "/$slug/inbox", params } as const;
}

export function AppChrome() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { dismiss, notifyError } = useAppMessages();
  const session = useSessionData();
  const { households, error } = useHouseholds();

  useEffect(() => {
    if (error) {
      notifyError(error);
    }
  }, [error, notifyError]);

  // `/settings` and `/new-household` carry no slug, so the chrome falls back
  // to the first household — the switcher and sidebar still need a context.
  const firstSegment = location.pathname.split("/").filter(Boolean)[0];
  const household =
    households.find((entry) => entry.slug === firstSegment) ??
    households[0] ??
    null;

  // Nobody has a household yet: `/new-household` fills the screen on its own,
  // exactly as the create-household page did before the router.
  if (!household) {
    return <Outlet />;
  }

  const handleSelectHousehold = (next: HouseholdSummary) => {
    if (next.slug === household.slug) {
      return;
    }
    void navigate(householdDestination(next, getActiveView(location.pathname)));
  };

  const handleLogout = async () => {
    // Nothing raised while signed in should follow the visitor to /login.
    dismiss();
    // Seeds the signed-out answer instead of invalidating, so the households
    // query this component is still observing never refetches into a 401 on
    // the way out (see lib/session.ts). The redirect is then synchronous.
    await signOutAndReset(queryClient);
    await navigate({ to: "/login", replace: true });
    clearAuthQueries(queryClient);
  };

  return (
    <Layout
      session={session}
      isOwner={household.role === "owner"}
      householdSlug={household.slug}
      householdName={household.displayName}
      householdRole={household.role}
      households={households}
      onSelectHousehold={handleSelectHousehold}
      onCreateHousehold={() => void navigate({ to: "/new-household" })}
      onLogout={() => void handleLogout()}
    >
      <Suspense fallback={<ViewFallback />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}
