import {
  Alert,
  Box,
  CircularProgress,
  Snackbar,
  Typography,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import {
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { CreateHouseholdPage } from "./components/CreateHouseholdPage";
import { ForgotPasswordPage } from "./components/ForgotPasswordPage";
import { InboxPage } from "./components/inbox/InboxPage";
import { MembersPage } from "./components/members/MembersPage";
import { NeedsReviewPage } from "./components/review/NeedsReviewPage";
import { ServicesPage } from "./components/services/ServicesPage";
import { AccountSettingsPage } from "./components/settings/AccountSettingsPage";

// Owner-only and rarely-visited views are code-split so the inbox loads fast.
const HouseholdSettingsView = lazy(() =>
  import("./components/HouseholdSettingsView").then((m) => ({
    default: m.HouseholdSettingsView,
  })),
);

function ViewFallback() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

import { InvitePage } from "./components/InvitePage";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import { ResetPasswordPage } from "./components/ResetPasswordPage";
import { SetupPage } from "./components/SetupPage";
import { TwoFactorPage } from "./components/TwoFactorPage";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import type {
  HouseholdSettings,
  HouseholdSettingsFormState,
  HouseholdSettingsResponse,
  HouseholdSummary,
  SetupStatus,
} from "./types";
import { buildHouseholdApiPath, buildHouseholdPath, fetchJson } from "./utils";

type ViewType = "inbox" | "quarantine" | "members" | "providers" | "settings";

function getActiveView(pathname: string): ViewType {
  // Match on path segments (/:slug/:view), not substrings, so a household slug
  // that happens to contain a view name does not change the active view.
  const segments = pathname.split("/").filter(Boolean);
  const view = segments.length === 1 ? segments[0] : segments[1];

  if (view === "settings") return "settings";
  if (view === "quarantine") return "quarantine";
  if (view === "members") return "members";
  if (view === "providers") return "providers";
  return "inbox";
}

const INITIAL_HOUSEHOLD_SETTINGS_FORM_STATE: HouseholdSettingsFormState = {
  displayName: "",
};

const PENDING_INVITE_KEY = "pendingInviteToken";

// Declared at module level so it is not remounted on every App render.
function InviteRoute({ onAccepted }: { onAccepted: (slug: string) => void }) {
  const { token } = useParams<{ token: string }>();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return <InvitePage token={token} onAcceptSuccess={onAccepted} />;
}

export function App() {
  const {
    data: session,
    isPending: isSessionPending,
    refetch,
  } = authClient.useSession();

  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [isCheckingSetup, setIsCheckingSetup] = useState(
    typeof window !== "undefined",
  );
  const navigate = useNavigate();
  const location = useLocation();
  const install = useInstallPrompt();
  const routeSegments = location.pathname.split("/").filter(Boolean);
  const routeSlug =
    routeSegments[0] &&
    ![
      "login",
      "setup",
      "invite",
      "settings",
      "forgot-password",
      "reset-password",
      "two-factor",
      "new-household",
    ].includes(routeSegments[0])
      ? routeSegments[0]
      : null;

  const isInvitePath =
    routeSegments[0] === "invite" || routeSegments[0] === "new-household";
  const activeView = getActiveView(location.pathname);
  const [households, setHouseholds] = useState<HouseholdSummary[]>([]);
  const [isLoadingHouseholds, setIsLoadingHouseholds] = useState(false);

  const [householdSettings, setHouseholdSettings] =
    useState<HouseholdSettings | null>(null);
  const [householdSettingsFormState, setHouseholdSettingsFormState] =
    useState<HouseholdSettingsFormState>(INITIAL_HOUSEHOLD_SETTINGS_FORM_STATE);
  const [isLoadingHouseholdSettings, setIsLoadingHouseholdSettings] =
    useState(false);
  const [isSavingHouseholdSettings, setIsSavingHouseholdSettings] =
    useState(false);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  const isAuthenticated = Boolean(session?.user?.email);
  const currentHousehold = routeSlug
    ? (households.find((household) => household.slug === routeSlug) ?? null)
    : null;
  const defaultHousehold = households[0] ?? null;
  const isOwner = currentHousehold?.role === "owner";
  const layoutHousehold = currentHousehold ?? defaultHousehold;
  const layoutIsOwner = layoutHousehold?.role === "owner";
  const getHouseholdDestination = useCallback(
    (household: HouseholdSummary) => {
      switch (activeView) {
        case "settings":
          return buildHouseholdPath(household.slug, "/settings");
        case "quarantine":
          return buildHouseholdPath(
            household.slug,
            household.role === "owner" ? "/quarantine" : "/inbox",
          );
        case "members":
          return buildHouseholdPath(
            household.slug,
            household.role === "owner" ? "/members" : "/inbox",
          );
        case "providers":
          return buildHouseholdPath(
            household.slug,
            household.role === "owner" ? "/providers" : "/inbox",
          );
        default:
          return buildHouseholdPath(household.slug, "/inbox");
      }
    },
    [activeView],
  );
  const householdApiPath = useCallback(
    (path: string) => {
      if (!currentHousehold) {
        throw new Error("No household selected");
      }

      return buildHouseholdApiPath(currentHousehold.slug, path);
    },
    [currentHousehold],
  );

  const handleSnackbarClose = () => {
    setStatusMessage(null);
    setViewError(null);
  };

  const handleInviteAccepted = (householdSlug: string) => {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    navigate(buildHouseholdPath(householdSlug, "/inbox"), { replace: true });
    void refetch();
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setHouseholds([]);
      return;
    }

    let cancelled = false;

    const loadHouseholds = async () => {
      setIsLoadingHouseholds(true);

      try {
        const response = await fetchJson<{ households: HouseholdSummary[] }>(
          "/api/settings/households",
        );

        if (cancelled) return;

        setHouseholds(response.households);
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error
              ? error.message
              : "Unable to load households",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHouseholds(false);
        }
      }
    };

    void loadHouseholds();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || isLoadingHouseholds || households.length === 0) {
      return;
    }

    if (activeView === "settings" || isInvitePath) {
      return;
    }

    const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (pendingInvite) {
      navigate(`/invite/${pendingInvite}`, { replace: true });
      return;
    }

    if (!routeSlug || !currentHousehold) {
      navigate(
        buildHouseholdPath(
          defaultHousehold?.slug ?? households[0].slug,
          "/inbox",
        ),
        {
          replace: true,
        },
      );
    }
  }, [
    currentHousehold,
    defaultHousehold,
    households,
    isAuthenticated,
    isInvitePath,
    isLoadingHouseholds,
    navigate,
    routeSlug,
    activeView,
  ]);

  useEffect(() => {
    const isHouseholdSettingsRoute = Boolean(
      currentHousehold &&
        location.pathname ===
          buildHouseholdPath(currentHousehold.slug, "/settings"),
    );

    if (
      !isAuthenticated ||
      !currentHousehold ||
      !isOwner ||
      !isHouseholdSettingsRoute
    ) {
      setHouseholdSettings(null);
      setHouseholdSettingsFormState(INITIAL_HOUSEHOLD_SETTINGS_FORM_STATE);
      return;
    }

    let cancelled = false;

    const loadHouseholdSettings = async () => {
      setIsLoadingHouseholdSettings(true);

      try {
        const response = await fetchJson<HouseholdSettingsResponse>(
          householdApiPath("/admin/settings"),
        );

        if (cancelled) {
          return;
        }

        setHouseholdSettings(response.household);
        setHouseholdSettingsFormState({
          displayName: response.household.displayName,
        });
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error
              ? error.message
              : "Unable to load household settings",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingHouseholdSettings(false);
        }
      }
    };

    void loadHouseholdSettings();

    return () => {
      cancelled = true;
    };
  }, [
    currentHousehold,
    householdApiPath,
    isAuthenticated,
    isOwner,
    location.pathname,
  ]);

  async function refreshHouseholdSettings() {
    if (!isAuthenticated || !currentHousehold || !isOwner) {
      return;
    }

    const response = await fetchJson<HouseholdSettingsResponse>(
      householdApiPath("/admin/settings"),
    );

    setHouseholdSettings(response.household);
    setHouseholdSettingsFormState({
      displayName: response.household.displayName,
    });
    setHouseholds((current) =>
      current.map((household) =>
        household.id === currentHousehold.id
          ? { ...household, displayName: response.household.displayName }
          : household,
      ),
    );
  }

  async function handleUpdateHouseholdSettings(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setIsSavingHouseholdSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<HouseholdSettingsResponse>(
        householdApiPath("/admin/settings"),
        {
          method: "PATCH",
          body: JSON.stringify({
            displayName: householdSettingsFormState.displayName,
          }),
        },
      );
      setStatusMessage("Household name updated.");
      await refreshHouseholdSettings();
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to update household settings",
      );
    } finally {
      setIsSavingHouseholdSettings(false);
    }
  }

  async function refreshSetupStatus() {
    if (typeof window === "undefined") {
      return;
    }

    const status = await fetchJson<SetupStatus>("/api/setup/status");
    setSetupStatus(status);

    if (status.needsSetup && location.pathname !== "/setup") {
      navigate("/setup", { replace: true });
      return;
    }

    if (!status.needsSetup && location.pathname === "/setup") {
      navigate("/", { replace: true });
      return;
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const loadSetupStatus = async () => {
      try {
        const status = await fetchJson<SetupStatus>("/api/setup/status");

        if (cancelled) return;

        setSetupStatus(status);

        if (status.needsSetup && location.pathname !== "/setup") {
          navigate("/setup", { replace: true });
        } else if (!status.needsSetup && location.pathname === "/setup") {
          navigate("/", { replace: true });
        }
      } catch (error) {
        if (!cancelled) {
          setSetupError(
            error instanceof Error
              ? error.message
              : "Unable to check setup status",
          );
        }
      } finally {
        if (!cancelled) {
          setIsCheckingSetup(false);
        }
      }
    };

    void loadSetupStatus();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (!isAuthenticated || !currentHousehold) {
    }
  }, [currentHousehold, isAuthenticated]);

  async function handleLogout() {
    setStatusMessage(null);
    setViewError(null);
    await authClient.signOut({});
    await refetch();
  }

  function handleSelectHousehold(household: HouseholdSummary) {
    if (household.slug === currentHousehold?.slug) {
      return;
    }

    navigate(getHouseholdDestination(household));
  }

  function handleCreateHousehold() {
    setViewError(null);
    navigate("/new-household");
  }

  if (
    isSessionPending ||
    isCheckingSetup ||
    (isAuthenticated && isLoadingHouseholds)
  ) {
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

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route
          path="/invite/:token"
          element={<InviteRoute onAccepted={handleInviteAccepted} />}
        />
        <Route
          path="/setup"
          element={
            setupStatus?.needsSetup ? (
              <SetupPage
                emailDomain={setupStatus?.emailDomain ?? null}
                setupError={setupError}
                onSetupError={setSetupError}
                onSetupComplete={async () => {
                  setStatusMessage(
                    "Owner account created. You are now signed in.",
                  );
                  await Promise.all([refetch(), refreshSetupStatus()]);
                }}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route
          path="/login"
          element={
            <LoginPage
              setupStatus={setupStatus}
              setupError={setupError}
              onLoginSuccess={() => refetch()}
            />
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/two-factor"
          element={
            <TwoFactorPage
              onVerified={() => {
                void refetch();
                navigate("/", { replace: true });
              }}
            />
          }
        />
        <Route
          path="*"
          element={
            <Navigate
              to={setupStatus?.needsSetup ? "/setup" : "/login"}
              replace
            />
          }
        />
      </Routes>
    );
  }

  if (households.length === 0) {
    return (
      <CreateHouseholdPage
        emailDomain={setupStatus?.emailDomain ?? null}
        onCreated={(household) => {
          setHouseholds([household]);
          navigate(buildHouseholdPath(household.slug, "/inbox"), {
            replace: true,
          });
        }}
      />
    );
  }

  if (!layoutHousehold) {
    return null;
  }

  return (
    <Layout
      session={session}
      isOwner={layoutIsOwner}
      householdSlug={layoutHousehold.slug}
      householdName={layoutHousehold.displayName}
      householdRole={layoutHousehold.role}
      households={households}
      onSelectHousehold={handleSelectHousehold}
      onCreateHousehold={handleCreateHousehold}
      onLogout={handleLogout}
    >
      <Suspense fallback={<ViewFallback />}>
        <Routes>
          <Route
            path="/invite/:token"
            element={<InviteRoute onAccepted={handleInviteAccepted} />}
          />
          <Route
            path="/new-household"
            element={
              <CreateHouseholdPage
                emailDomain={setupStatus?.emailDomain ?? null}
                onCreated={(household) => {
                  setHouseholds((current) => [...current, household]);
                  setStatusMessage(
                    `Household "${household.displayName}" created.`,
                  );
                  navigate(buildHouseholdPath(household.slug, "/inbox"), {
                    replace: true,
                  });
                }}
              />
            }
          />
          <Route
            path="/"
            element={
              <Navigate
                to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                replace
              />
            }
          />
          <Route
            path="/:slug/inbox"
            element={
              <InboxPage
                slug={layoutHousehold.slug}
                householdName={layoutHousehold.displayName}
                isOwner={layoutIsOwner}
              />
            }
          />
          <Route
            path="/:slug/inbox/:providerKey"
            element={
              <InboxPage
                slug={layoutHousehold.slug}
                householdName={layoutHousehold.displayName}
                isOwner={layoutIsOwner}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <AccountSettingsPage
                install={install}
                onHouseholdLeft={(household) => {
                  setHouseholds((current) =>
                    current.filter((h) => h.slug !== household.slug),
                  );
                  setStatusMessage(`You left ${household.displayName}.`);
                  void refetch();
                  navigate("/", { replace: true });
                }}
              />
            }
          />
          <Route
            path="/:slug/settings"
            element={
              isOwner ? (
                <HouseholdSettingsView
                  household={householdSettings}
                  isLoading={isLoadingHouseholdSettings}
                  error={viewError}
                  formState={householdSettingsFormState}
                  onFormChange={(update) =>
                    setHouseholdSettingsFormState((current) => ({
                      ...current,
                      ...update,
                    }))
                  }
                  onSave={handleUpdateHouseholdSettings}
                  isSaving={isSavingHouseholdSettings}
                />
              ) : (
                <Navigate
                  to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                  replace
                />
              )
            }
          />
          <Route
            path="/:slug/quarantine"
            element={
              isOwner ? (
                <NeedsReviewPage
                  slug={layoutHousehold.slug}
                  householdName={layoutHousehold.displayName}
                />
              ) : (
                <Navigate
                  to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                  replace
                />
              )
            }
          />
          <Route
            path="/:slug/members"
            element={
              isOwner ? (
                <MembersPage
                  slug={layoutHousehold.slug}
                  householdName={layoutHousehold.displayName}
                  currentUserId={session?.user?.id ?? null}
                />
              ) : (
                <Navigate
                  to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                  replace
                />
              )
            }
          />
          <Route
            path="/:slug/providers"
            element={
              isOwner ? (
                <ServicesPage
                  slug={layoutHousehold.slug}
                  householdName={layoutHousehold.displayName}
                />
              ) : (
                <Navigate
                  to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                  replace
                />
              )
            }
          />
          <Route
            path="*"
            element={
              <Navigate
                to={buildHouseholdPath(layoutHousehold.slug, "/inbox")}
                replace
              />
            }
          />
        </Routes>
      </Suspense>

      <Snackbar
        open={Boolean(statusMessage || viewError)}
        autoHideDuration={6000}
        onClose={handleSnackbarClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleSnackbarClose}
          severity={viewError ? "error" : "success"}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {viewError || statusMessage}
        </Alert>
      </Snackbar>
    </Layout>
  );
}
