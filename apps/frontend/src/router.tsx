/**
 * The app's route tree, in TanStack Router's code-based mode (no file-based
 * generation). Everything the old `App.tsx` decided while rendering — is
 * setup done, is anyone signed in, does this slug name a household you belong
 * to, are you allowed in this view — is decided in `beforeLoad` now, by the
 * guards in `lib/guards.ts`, before a screen mounts.
 *
 * Routes are declared here; the wiring components below only translate route
 * params and shared queries into the props the screens already took.
 */
import { Box, CircularProgress, Typography } from "@mui/material";
import {
  type QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useState } from "react";
import { AppChrome } from "./components/AppChrome";
import { CreateHouseholdPage } from "./components/CreateHouseholdPage";
import { ForgotPasswordPage } from "./components/ForgotPasswordPage";
import { HouseholdSettingsPage } from "./components/household/HouseholdSettingsPage";
import { InvitePage } from "./components/InvitePage";
import { InboxPage } from "./components/inbox/InboxPage";
import { LoginPage } from "./components/LoginPage";
import { MembersPage } from "./components/members/MembersPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { NeedsReviewPage } from "./components/review/NeedsReviewPage";
import { SetupPage } from "./components/SetupPage";
import { ServicesPage } from "./components/services/ServicesPage";
import { AccountSettingsPage } from "./components/settings/AccountSettingsPage";
import { TwoFactorPage } from "./components/TwoFactorPage";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { AppearanceProvider } from "./lib/appearance";
import {
  type RouterContext,
  redirectToStart,
  requireAnonymous,
  requireHousehold,
  requireOwner,
  requireSession,
  requireSetupDone,
  requireSetupPending,
} from "./lib/guards";
import { AppMessageProvider, useAppMessages } from "./lib/messages";
import {
  invalidateAuthQueries,
  invalidateHouseholds,
  PENDING_INVITE_KEY,
  useHousehold,
  useSetupStatus,
} from "./lib/session";
import { createQueryClient } from "./queries/client";
import { useCurrentUserId } from "./queries/settings";

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const { queryClient } = rootRoute.useRouteContext();

  // The query client lives in the router context because the guards need it
  // outside React; this hands the very same instance to the React tree.
  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceProvider>
        <AppMessageProvider>
          <Outlet />
        </AppMessageProvider>
      </AppearanceProvider>
    </QueryClientProvider>
  );
}

/** The app's one full-screen wait, shown while the guards resolve. */
function LoadingScreen() {
  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <CircularProgress size={60} sx={{ mb: 4 }} />
      <Typography variant="h5" sx={{ fontWeight: "bold" }}>
        Loading your shared inbox…
      </Typography>
      <Typography color="text.secondary">
        Checking the current session and preparing the latest messages.
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------- public

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  beforeLoad: requireAnonymous,
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect } = loginRoute.useSearch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { status, error } = useSetupStatus();

  const handleLoginSuccess = async () => {
    await invalidateAuthQueries(queryClient);

    if (redirect) {
      // `href` navigates to an already-built path. The typed `to` form cannot
      // express "whichever route this string names", which is exactly what a
      // preserved ?redirect= is; the runtime option handles it.
      await navigate({ href: redirect, replace: true } as Parameters<
        typeof navigate
      >[0]);
      return;
    }

    await navigate({ to: "/", replace: true });
  };

  return (
    <LoginPage
      setupStatus={status}
      setupError={error}
      onLoginSuccess={() => void handleLoginSuccess()}
    />
  );
}

const twoFactorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/two-factor",
  beforeLoad: requireAnonymous,
  component: TwoFactorRoute,
});

function TwoFactorRoute() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleVerified = async () => {
    await invalidateAuthQueries(queryClient);
    await navigate({ to: "/", replace: true });
  };

  return <TwoFactorPage onVerified={() => void handleVerified()} />;
}

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  beforeLoad: requireAnonymous,
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  validateSearch: (
    search: Record<string, unknown>,
  ): { token?: string; error?: string } => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: requireAnonymous,
  component: ResetPasswordPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  // Public: accepting an invitation is how some people get an account at all.
  beforeLoad: requireSetupDone,
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = inviteRoute.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleAccepted = async (slug: string) => {
    try {
      sessionStorage.removeItem(PENDING_INVITE_KEY);
    } catch {
      // Private-mode browsers: nothing to clear.
    }
    await invalidateAuthQueries(queryClient);
    await navigate({ to: "/$slug/inbox", params: { slug }, replace: true });
  };

  return (
    <InvitePage
      token={token}
      onAcceptSuccess={(slug) => void handleAccepted(slug)}
    />
  );
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: requireSetupPending,
  component: SetupRoute,
});

function SetupRoute() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useAppMessages();
  const { status, error: statusError } = useSetupStatus();
  const [setupError, setSetupError] = useState<string | null>(null);

  const handleComplete = async () => {
    notify("Owner account created. You are now signed in.");
    await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    await invalidateAuthQueries(queryClient);
    await navigate({ to: "/", replace: true });
  };

  return (
    <SetupPage
      emailDomain={status?.emailDomain ?? null}
      setupError={setupError ?? statusError}
      onSetupError={setSetupError}
      onSetupComplete={() => void handleComplete()}
    />
  );
}

// ---------------------------------------------------------------- authed

/**
 * Pathless layout route: everything a signed-in visitor sees renders inside
 * the app chrome, account settings and the create-household screen included —
 * which is where the pre-router app put them.
 */
const chromeRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "chrome",
  beforeLoad: requireSession,
  component: AppChrome,
});

const newHouseholdRoute = createRoute({
  getParentRoute: () => chromeRoute,
  path: "/new-household",
  component: NewHouseholdRoute,
});

function NewHouseholdRoute() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useAppMessages();
  const { status } = useSetupStatus();

  const handleCreated = async (slug: string, displayName: string) => {
    notify(`Household "${displayName}" created.`);
    await invalidateHouseholds(queryClient);
    await navigate({ to: "/$slug/inbox", params: { slug }, replace: true });
  };

  return (
    <CreateHouseholdPage
      emailDomain={status?.emailDomain ?? null}
      onCreated={(household) =>
        void handleCreated(household.slug, household.displayName)
      }
    />
  );
}

const accountSettingsRoute = createRoute({
  getParentRoute: () => chromeRoute,
  path: "/settings",
  component: AccountSettingsRoute,
});

function AccountSettingsRoute() {
  const install = useInstallPrompt();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { notify } = useAppMessages();

  const handleLeft = async (displayName: string) => {
    notify(`You left ${displayName}.`);
    await invalidateAuthQueries(queryClient);
    await navigate({ to: "/", replace: true });
  };

  return (
    <AccountSettingsPage
      install={install}
      onHouseholdLeft={(household) => void handleLeft(household.displayName)}
    />
  );
}

// ------------------------------------------------------ household routes

/**
 * The household in the URL. No component of its own — the chrome above it
 * already draws the shell; this route exists for the guard and the param.
 */
const householdRoute = createRoute({
  getParentRoute: () => chromeRoute,
  path: "/$slug",
  beforeLoad: (args) => requireHousehold(args, args.params.slug),
});

/** Shared by every household view: the slug plus its household record. */
function useHouseholdView() {
  const { slug } = householdRoute.useParams();
  const household = useHousehold(slug);
  return { slug, household };
}

const inboxRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "inbox",
  component: InboxRoute,
});

const inboxProviderRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "inbox/$providerKey",
  component: InboxRoute,
});

function InboxRoute() {
  const { slug, household } = useHouseholdView();
  // `strict: false`: both /$slug/inbox and /$slug/inbox/$providerKey render
  // this screen, and only the second has the param.
  const { providerKey } = useParams({ strict: false });
  if (!household) return null;

  return (
    <InboxPage
      slug={slug}
      householdName={household.displayName}
      isOwner={household.role === "owner"}
      providerKey={providerKey}
    />
  );
}

const quarantineRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "quarantine",
  beforeLoad: (args) => requireOwner(args, args.params.slug),
  component: QuarantineRoute,
});

function QuarantineRoute() {
  const { slug, household } = useHouseholdView();
  if (!household) return null;

  return <NeedsReviewPage slug={slug} householdName={household.displayName} />;
}

const membersRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "members",
  beforeLoad: (args) => requireOwner(args, args.params.slug),
  component: MembersRoute,
});

function MembersRoute() {
  const { slug, household } = useHouseholdView();
  // Not from the session: Limen's payload describes the account as its own
  // tables see it, and the id `member.id` is compared against is this app's.
  // GET /api/settings is where the server states it.
  const currentUserId = useCurrentUserId();
  if (!household) return null;

  return (
    <MembersPage
      slug={slug}
      householdName={household.displayName}
      currentUserId={currentUserId}
    />
  );
}

const providersRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "providers",
  beforeLoad: (args) => requireOwner(args, args.params.slug),
  component: ProvidersRoute,
});

function ProvidersRoute() {
  const { slug, household } = useHouseholdView();
  if (!household) return null;

  return <ServicesPage slug={slug} householdName={household.displayName} />;
}

const householdSettingsRoute = createRoute({
  getParentRoute: () => householdRoute,
  path: "settings",
  beforeLoad: (args) => requireOwner(args, args.params.slug),
  component: HouseholdSettingsRoute,
});

function HouseholdSettingsRoute() {
  const { slug, household } = useHouseholdView();
  const queryClient = useQueryClient();
  if (!household) return null;

  return (
    <HouseholdSettingsPage
      slug={slug}
      // The sidebar and the switcher read the households query, so a rename
      // only has to invalidate it — no local copy to keep in step.
      onRenamed={() => void invalidateHouseholds(queryClient)}
    />
  );
}

// ------------------------------------------------------------ redirects

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: redirectToStart,
});

/** Anything else: a stale bookmark, a typo, a link from an old release. */
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$",
  beforeLoad: redirectToStart,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  twoFactorRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  inviteRoute,
  setupRoute,
  chromeRoute.addChildren([
    newHouseholdRoute,
    accountSettingsRoute,
    householdRoute.addChildren([
      inboxRoute,
      inboxProviderRoute,
      quarantineRoute,
      membersRoute,
      providersRoute,
      householdSettingsRoute,
    ]),
  ]),
  catchAllRoute,
]);

export interface CreateAppRouterOptions {
  queryClient?: QueryClient;
  history?: RouterHistory;
}

/**
 * A factory rather than a single module-level router so tests can drive the
 * same tree over a memory history with their own query client.
 */
export function createAppRouter({
  queryClient = createQueryClient(),
  history,
}: CreateAppRouterOptions = {}) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    // The guards resolve synchronously when their data is cached, so this
    // only shows on a genuine wait — the old app's behaviour, where the
    // full-screen loader appeared the moment a session check started.
    defaultPendingComponent: LoadingScreen,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
    scrollRestoration: true,
  });
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
