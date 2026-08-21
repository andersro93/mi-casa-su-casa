import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Typography,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import QRCode from "qrcode";
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
import { InboxView } from "./components/InboxView";

// Owner-only and rarely-visited views are code-split so the inbox loads fast.
const HouseholdSettingsView = lazy(() =>
  import("./components/HouseholdSettingsView").then((m) => ({
    default: m.HouseholdSettingsView,
  })),
);
const MembersView = lazy(() =>
  import("./components/MembersView").then((m) => ({ default: m.MembersView })),
);
const ProvidersRulesView = lazy(() =>
  import("./components/ProvidersRulesView").then((m) => ({
    default: m.ProvidersRulesView,
  })),
);
const QuarantineView = lazy(() =>
  import("./components/QuarantineView").then((m) => ({
    default: m.QuarantineView,
  })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((m) => ({
    default: m.SettingsView,
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
import type {
  AccountProfile,
  AccountSession,
  AccountSettingsFormState,
  AccountSettingsResponse,
  HouseholdSettings,
  HouseholdSettingsFormState,
  HouseholdSettingsResponse,
  HouseholdSummary,
  InboxMessage,
  InvitationDeliveryResponse,
  InvitationFormState,
  InvitationSummary,
  MemberFormState,
  MemberSummary,
  ProviderConfiguration,
  ProviderConfigurationResponse,
  ProviderFormState,
  ProviderMessagesResponse,
  ProviderOption,
  ProviderSummary,
  QuarantineMessage,
  QuarantineMessagesResponse,
  SenderRule,
  SenderRuleFormState,
  SetupStatus,
  TwoFactorSetup,
} from "./types";
import {
  buildHouseholdApiPath,
  buildHouseholdPath,
  fetchJson,
  getProviderAccessToggleRequest,
} from "./utils";

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

const INITIAL_SETTINGS_FORM_STATE: AccountSettingsFormState = {
  name: "",
  image: "",
  currentPassword: "",
  newPassword: "",
  forgotPasswordEmail: "",
  twoFactorPassword: "",
  twoFactorCode: "",
  twoFactorBackupCode: "",
  passkeyName: "",
};

const INITIAL_HOUSEHOLD_SETTINGS_FORM_STATE: HouseholdSettingsFormState = {
  displayName: "",
};

const INITIAL_MEMBER_FORM_STATE: MemberFormState = {
  email: "",
  name: "",
  role: "member",
};

const INITIAL_INVITATION_FORM_STATE: InvitationFormState = {
  email: "",
  name: "",
  role: "member",
  providerIds: [],
};

const INITIAL_PROVIDER_FORM_STATE: ProviderFormState = {
  providerKey: "",
  displayName: "",
};

const INITIAL_RULE_FORM_STATE: SenderRuleFormState = {
  providerId: "",
  matchType: "domain",
  matchValue: "",
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
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<InboxMessage[]>([]);

  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [settingsSessions, setSettingsSessions] = useState<AccountSession[]>(
    [],
  );
  const [settingsFormState, setSettingsFormState] =
    useState<AccountSettingsFormState>(INITIAL_SETTINGS_FORM_STATE);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [householdSettings, setHouseholdSettings] =
    useState<HouseholdSettings | null>(null);
  const [householdSettingsFormState, setHouseholdSettingsFormState] =
    useState<HouseholdSettingsFormState>(INITIAL_HOUSEHOLD_SETTINGS_FORM_STATE);
  const [isLoadingHouseholdSettings, setIsLoadingHouseholdSettings] =
    useState(false);
  const [isSavingHouseholdSettings, setIsSavingHouseholdSettings] =
    useState(false);

  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );

  const [quarantineMessages, setQuarantineMessages] = useState<
    QuarantineMessage[]
  >([]);
  const [selectedQuarantineId, setSelectedQuarantineId] = useState<
    string | null
  >(null);
  const [releaseProviderKey, setReleaseProviderKey] = useState<string>("");

  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberFormState, setMemberFormState] = useState<MemberFormState>(
    INITIAL_MEMBER_FORM_STATE,
  );
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [invitationFormState, setInvitationFormState] =
    useState<InvitationFormState>(INITIAL_INVITATION_FORM_STATE);
  const [providerConfigurations, setProviderConfigurations] = useState<
    ProviderConfiguration[]
  >([]);
  const [senderRules, setSenderRules] = useState<SenderRule[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [providerFormState, setProviderFormState] = useState<ProviderFormState>(
    INITIAL_PROVIDER_FORM_STATE,
  );
  const [ruleFormState, setRuleFormState] = useState<SenderRuleFormState>(
    INITIAL_RULE_FORM_STATE,
  );

  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [isLoadingQuarantine, setIsLoadingQuarantine] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [isSavingMessage, setIsSavingMessage] = useState(false);
  const [isReviewingQuarantine, setIsReviewingQuarantine] = useState(false);
  const [isSavingMember, setIsSavingMember] = useState(false);
  const [isSavingInvitation, setIsSavingInvitation] = useState(false);
  const [isSavingProviderConfiguration, setIsSavingProviderConfiguration] =
    useState(false);

  const [messagesNextBefore, setMessagesNextBefore] = useState<string | null>(
    null,
  );
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [quarantineNextBefore, setQuarantineNextBefore] = useState<
    string | null
  >(null);
  const [isLoadingOlderQuarantine, setIsLoadingOlderQuarantine] =
    useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [pendingInviteLink, setPendingInviteLink] = useState<string | null>(
    null,
  );

  function reportInvitationDelivery(
    result: InvitationDeliveryResponse,
    sentMessage: string,
  ) {
    if (result.emailSent) {
      setPendingInviteLink(null);
      setStatusMessage(sentMessage);
      return;
    }

    setPendingInviteLink(result.inviteUrl);
    setViewError(
      "The invitation was created, but the email could not be sent. Copy the invite link and share it directly.",
    );
  }

  async function copyPendingInviteLink() {
    if (!pendingInviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pendingInviteLink);
      setViewError(null);
      setStatusMessage("Invite link copied.");
    } catch {
      window.prompt("Copy the invite link:", pendingInviteLink);
    }
  }

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
    if (!isAuthenticated || activeView !== "settings") {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      setIsLoadingSettings(true);

      try {
        const response =
          await fetchJson<AccountSettingsResponse>("/api/settings");

        if (cancelled) return;

        setProfile(response.profile);
        setSettingsSessions(response.sessions);
        setHouseholds(response.profile.households);
        setSettingsFormState((current) => ({
          ...current,
          name: response.profile.name,
          image: response.profile.image || "",
        }));
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error ? error.message : "Unable to load settings",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [activeView, isAuthenticated]);

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

  async function refreshSettings() {
    if (!isAuthenticated) return;
    const response = await fetchJson<AccountSettingsResponse>("/api/settings");
    setProfile(response.profile);
    setSettingsSessions(response.sessions);
    setHouseholds(response.profile.households);
  }

  async function handleUpdateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ profile: AccountProfile }>("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: settingsFormState.name,
          image: settingsFormState.image,
        }),
      });
      setStatusMessage("Profile updated.");
      await refreshSettings();
      await refetch();
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update profile",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.changePassword({
        newPassword: settingsFormState.newPassword,
        currentPassword: settingsFormState.currentPassword,
        revokeOtherSessions: false,
      });

      if (error) {
        throw new Error(error.message || "Failed to change password");
      }

      setSettingsFormState((current) => ({
        ...current,
        currentPassword: "",
        newPassword: "",
      }));
      setStatusMessage("Password changed.");
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to change password",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleRequestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.requestPasswordReset({
        email: settingsFormState.forgotPasswordEmail,
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        throw new Error(error.message || "Failed to send password reset email");
      }

      setSettingsFormState((current) => ({
        ...current,
        forgotPasswordEmail: "",
      }));
      setStatusMessage("Password reset email sent.");
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to send password reset email",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(
    null,
  );

  async function handleEnable2FA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { data, error } = await authClient.twoFactor.enable({
        password: settingsFormState.twoFactorPassword,
      });

      if (error || !data || !("totpURI" in data)) {
        throw new Error(error?.message || "Failed to start 2FA setup");
      }

      // Enabling only creates the secret; it becomes active once a code from
      // the authenticator app is verified.
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCode.toDataURL(data.totpURI, { margin: 1 });
      } catch {
        qrDataUrl = null;
      }
      const secret = new URL(data.totpURI).searchParams.get("secret") ?? null;

      setTwoFactorSetup({
        totpURI: data.totpURI,
        qrDataUrl,
        secret,
        backupCodes: data.backupCodes,
      });
      setSettingsFormState((current) => ({
        ...current,
        twoFactorPassword: "",
        twoFactorCode: "",
      }));
      setStatusMessage(
        "Scan the QR code and enter a code to finish enabling two-factor authentication.",
      );
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to enable 2FA",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleVerify2FA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: settingsFormState.twoFactorCode.trim(),
      });

      if (error) {
        throw new Error(
          error.message || "That code was not accepted. Try the next one.",
        );
      }

      setTwoFactorSetup(null);
      setSettingsFormState((current) => ({ ...current, twoFactorCode: "" }));
      setStatusMessage("Two-factor authentication enabled.");
      await refreshSettings();
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to verify the code",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  function handleCancel2FASetup() {
    setTwoFactorSetup(null);
    setSettingsFormState((current) => ({ ...current, twoFactorCode: "" }));
    setStatusMessage(null);
  }

  async function handleDisable2FA(): Promise<boolean> {
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.twoFactor.disable({
        password: settingsFormState.twoFactorPassword,
      });

      if (error) {
        throw new Error(error.message || "Failed to disable 2FA");
      }
      setStatusMessage("Two-factor authentication disabled.");
      await refreshSettings();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to disable 2FA",
      );
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleAddPasskey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.passkey.addPasskey({
        name: settingsFormState.passkeyName,
      });

      if (error) {
        throw new Error(error.message || "Failed to add passkey");
      }

      setSettingsFormState((current) => ({ ...current, passkeyName: "" }));
      setStatusMessage("Passkey added.");
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to add passkey",
      );
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleRevokeSession(sessionId: string): Promise<boolean> {
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson(`/api/settings/sessions/${sessionId}`, {
        method: "DELETE",
      });
      setStatusMessage("Session revoked.");
      await refreshSettings();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to revoke session",
      );
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleRevokeOtherSessions(): Promise<boolean> {
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson(`/api/settings/sessions/others`, { method: "DELETE" });
      setStatusMessage("Other sessions revoked.");
      await refreshSettings();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to revoke sessions",
      );
      return false;
    } finally {
      setIsSavingSettings(false);
    }
  }

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
      setProviders([]);
      setMessages([]);
      setQuarantineMessages([]);
      setMembers([]);
      setProviderOptions([]);
      setSelectedProviderKey(null);
      setSelectedMessageId(null);
      setSelectedQuarantineId(null);
      setSelectedMemberId(null);
      setSelectedProviderId(null);
      setSelectedRuleId(null);
      setReleaseProviderKey("");
      setMemberFormState(INITIAL_MEMBER_FORM_STATE);
      setInvitations([]);
      setInvitationFormState(INITIAL_INVITATION_FORM_STATE);
      setProviderConfigurations([]);
      setSenderRules([]);
      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setRuleFormState(INITIAL_RULE_FORM_STATE);
      return;
    }

    let cancelled = false;

    const loadProviders = async () => {
      setIsLoadingInbox(true);
      setViewError(null);

      try {
        const response = await fetchJson<{ providers: ProviderSummary[] }>(
          householdApiPath("/inbox/providers"),
        );

        if (cancelled) return;

        setProviders(response.providers);
        setReleaseProviderKey((current) => {
          if (
            current &&
            response.providers.some((p) => p.provider_key === current)
          ) {
            return current;
          }
          return response.providers[0]?.provider_key ?? "";
        });
        setSelectedProviderKey((current) => {
          if (
            current &&
            response.providers.some((p) => p.provider_key === current)
          ) {
            return current;
          }
          return response.providers[0]?.provider_key ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error ? error.message : "Unable to load providers",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInbox(false);
        }
      }
    };

    void loadProviders();

    return () => {
      cancelled = true;
    };
  }, [currentHousehold, householdApiPath, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !currentHousehold || !selectedProviderKey) {
      setMessages([]);
      setSelectedMessageId(null);
      return;
    }

    let cancelled = false;

    const loadMessages = async () => {
      setIsLoadingInbox(true);
      setViewError(null);

      try {
        const response = await fetchJson<ProviderMessagesResponse>(
          householdApiPath(`/inbox/providers/${selectedProviderKey}?limit=50`),
        );

        if (cancelled) return;

        setMessages(response.messages);
        setMessagesNextBefore(response.page?.nextBefore ?? null);
        setSelectedMessageId((current) => {
          if (current && response.messages.some((m) => m.id === current)) {
            return current;
          }
          return response.messages[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error ? error.message : "Unable to load messages",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingInbox(false);
        }
      }
    };

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [
    currentHousehold,
    householdApiPath,
    isAuthenticated,
    selectedProviderKey,
  ]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !isOwner ||
      !currentHousehold ||
      activeView !== "quarantine"
    ) {
      return;
    }

    let cancelled = false;

    const loadQuarantine = async () => {
      setIsLoadingQuarantine(true);

      try {
        const response = await fetchJson<QuarantineMessagesResponse>(
          householdApiPath("/inbox/quarantine?limit=50"),
        );

        if (cancelled) return;

        setQuarantineMessages(response.messages);
        setQuarantineNextBefore(response.page?.nextBefore ?? null);
        setSelectedQuarantineId((current) => {
          if (current && response.messages.some((m) => m.id === current)) {
            return current;
          }
          return response.messages[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error
              ? error.message
              : "Unable to load quarantine",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingQuarantine(false);
        }
      }
    };

    void loadQuarantine();

    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    currentHousehold,
    householdApiPath,
    isAuthenticated,
    isOwner,
  ]);

  // Load provider configuration when the view/household changes — not on
  // every selection change, so an in-progress edit is never overwritten by a
  // background refetch.
  useEffect(() => {
    if (
      !isAuthenticated ||
      !isOwner ||
      !currentHousehold ||
      activeView !== "providers"
    ) {
      return;
    }

    let cancelled = false;

    const loadProviderConfigurations = async () => {
      setIsSavingProviderConfiguration(false);

      try {
        const response = await fetchJson<ProviderConfigurationResponse>(
          householdApiPath("/admin/providers"),
        );

        if (cancelled) return;

        setProviderConfigurations(response.providers);
        setSenderRules(response.rules);
        // Keep the current selection when it still exists; otherwise pick
        // the first provider and its first rule.
        setSelectedProviderId((current) =>
          current && response.providers.some((p) => p.id === current)
            ? current
            : (response.providers[0]?.id ?? null),
        );
        setSelectedRuleId((current) =>
          current && response.rules.some((r) => r.id === current)
            ? current
            : null,
        );
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error
              ? error.message
              : "Unable to load provider configuration",
          );
        }
      }
    };

    void loadProviderConfigurations();

    return () => {
      cancelled = true;
    };
  }, [
    isAuthenticated,
    isOwner,
    currentHousehold,
    activeView,
    householdApiPath,
  ]);

  // Derive the edit forms from the selected provider/rule. Runs when the
  // selection (or the loaded data behind it) changes — never on its own.
  useEffect(() => {
    const selectedProvider = providerConfigurations.find(
      (provider) => provider.id === selectedProviderId,
    );
    setProviderFormState(
      selectedProvider
        ? {
            providerKey: selectedProvider.provider_key,
            displayName: selectedProvider.display_name,
          }
        : INITIAL_PROVIDER_FORM_STATE,
    );

    const selectedRule = senderRules.find((rule) => rule.id === selectedRuleId);
    setRuleFormState(
      selectedRule
        ? {
            providerId: selectedRule.provider_id,
            matchType: selectedRule.match_type,
            matchValue: selectedRule.match_value,
          }
        : {
            ...INITIAL_RULE_FORM_STATE,
            providerId: selectedProviderId ?? "",
          },
    );
  }, [providerConfigurations, senderRules, selectedProviderId, selectedRuleId]);

  useEffect(() => {
    if (
      !isAuthenticated ||
      !isOwner ||
      !currentHousehold ||
      activeView !== "members"
    ) {
      return;
    }

    let cancelled = false;

    const loadMembers = async () => {
      setIsLoadingMembers(true);

      try {
        const [membersResponse, invitationsResponse] = await Promise.all([
          fetchJson<{
            members: MemberSummary[];
            providers: ProviderOption[];
          }>(householdApiPath("/admin/members")),
          fetchJson<{ invitations: InvitationSummary[] }>(
            householdApiPath("/admin/invitations"),
          ),
        ]);

        if (cancelled) return;

        setMembers(membersResponse.members);
        setProviderOptions(membersResponse.providers);
        setInvitations(invitationsResponse.invitations);
        setSelectedMemberId((current) => {
          if (
            current &&
            membersResponse.members.some((member) => member.id === current)
          ) {
            return current;
          }
          return membersResponse.members[0]?.id ?? null;
        });
      } catch (error) {
        if (!cancelled) {
          setViewError(
            error instanceof Error ? error.message : "Unable to load members",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMembers(false);
        }
      }
    };

    void loadMembers();

    return () => {
      cancelled = true;
    };
  }, [
    activeView,
    currentHousehold,
    householdApiPath,
    isAuthenticated,
    isOwner,
  ]);

  async function refreshProviders() {
    if (!isAuthenticated || !currentHousehold) return;
    const response = await fetchJson<{ providers: ProviderSummary[] }>(
      householdApiPath("/inbox/providers"),
    );
    setProviders(response.providers);
    setReleaseProviderKey((current) => {
      if (
        current &&
        response.providers.some((p) => p.provider_key === current)
      ) {
        return current;
      }
      return response.providers[0]?.provider_key ?? "";
    });
  }

  async function loadOlderMessages() {
    if (!messagesNextBefore || !selectedProviderKey || isLoadingOlderMessages) {
      return;
    }
    setIsLoadingOlderMessages(true);
    try {
      const response = await fetchJson<ProviderMessagesResponse>(
        householdApiPath(
          `/inbox/providers/${selectedProviderKey}?limit=50&before=${encodeURIComponent(messagesNextBefore)}`,
        ),
      );
      setMessages((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [
          ...current,
          ...response.messages.filter((m) => !seen.has(m.id)),
        ];
      });
      setMessagesNextBefore(response.page?.nextBefore ?? null);
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to load older messages",
      );
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }

  async function loadOlderQuarantine() {
    if (!quarantineNextBefore || isLoadingOlderQuarantine) {
      return;
    }
    setIsLoadingOlderQuarantine(true);
    try {
      const response = await fetchJson<QuarantineMessagesResponse>(
        householdApiPath(
          `/inbox/quarantine?limit=50&before=${encodeURIComponent(quarantineNextBefore)}`,
        ),
      );
      setQuarantineMessages((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [
          ...current,
          ...response.messages.filter((m) => !seen.has(m.id)),
        ];
      });
      setQuarantineNextBefore(response.page?.nextBefore ?? null);
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to load older quarantined messages",
      );
    } finally {
      setIsLoadingOlderQuarantine(false);
    }
  }

  async function refreshQuarantine() {
    if (!isAuthenticated || !isOwner || !currentHousehold) return;
    const response = await fetchJson<QuarantineMessagesResponse>(
      householdApiPath("/inbox/quarantine?limit=50"),
    );
    setQuarantineMessages(response.messages);
    setQuarantineNextBefore(response.page?.nextBefore ?? null);
    setSelectedQuarantineId((current) => {
      if (current && response.messages.some((m) => m.id === current)) {
        return current;
      }
      return response.messages[0]?.id ?? null;
    });
  }

  async function refreshMembers() {
    if (!isAuthenticated || !isOwner || !currentHousehold) return;
    const response = await fetchJson<{
      members: MemberSummary[];
      providers: ProviderOption[];
    }>(householdApiPath("/admin/members"));
    setMembers(response.members);
    setProviderOptions(response.providers);
    setSelectedMemberId((current) => {
      if (current && response.members.some((m) => m.id === current)) {
        return current;
      }
      return response.members[0]?.id ?? null;
    });
  }

  async function refreshInvitations() {
    if (!isAuthenticated || !isOwner || !currentHousehold) return;
    const response = await fetchJson<{ invitations: InvitationSummary[] }>(
      householdApiPath("/admin/invitations"),
    );
    setInvitations(response.invitations);
  }

  async function refreshProviderConfigurations() {
    if (!isAuthenticated || !isOwner || !currentHousehold) return;

    const response = await fetchJson<ProviderConfigurationResponse>(
      householdApiPath("/admin/providers"),
    );

    setProviderConfigurations(response.providers);
    setSenderRules(response.rules);

    setSelectedProviderId((current) => {
      if (
        current &&
        response.providers.some((provider) => provider.id === current)
      ) {
        return current;
      }

      return response.providers[0]?.id ?? null;
    });

    setSelectedRuleId((current) => {
      if (current && response.rules.some((rule) => rule.id === current)) {
        return current;
      }

      return null;
    });
  }

  async function handleLogout() {
    setStatusMessage(null);
    setViewError(null);
    await authClient.signOut({});
    await refetch();
  }

  async function handleStatusChange(nextStatus: InboxMessage["status"]) {
    if (!selectedMessageId) return;

    setIsSavingMessage(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const response = await fetchJson<{ message: InboxMessage }>(
        householdApiPath(`/inbox/messages/${selectedMessageId}/status`),
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      );

      setMessages((current) =>
        current.map((m) =>
          m.id === response.message.id ? response.message : m,
        ),
      );
      setStatusMessage(`Marked message as ${nextStatus}.`);
      await refreshProviders();
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to update the message status",
      );
    } finally {
      setIsSavingMessage(false);
    }
  }

  async function handleQuarantineReview(
    action: "dismiss" | "release",
  ): Promise<boolean> {
    if (!selectedQuarantineId) return false;

    setIsReviewingQuarantine(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson(
        householdApiPath(`/inbox/quarantine/${selectedQuarantineId}/review`),
        {
          method: "POST",
          body: JSON.stringify(
            action === "release"
              ? { action, providerKey: releaseProviderKey }
              : { action },
          ),
        },
      );

      setStatusMessage(
        action === "release"
          ? "Quarantined message released to the selected provider."
          : "Quarantined message dismissed.",
      );

      await Promise.all([refreshQuarantine(), refreshProviders()]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to review quarantine",
      );
      return false;
    } finally {
      setIsReviewingQuarantine(false);
    }
  }

  async function handleCreateMember(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    setIsSavingMember(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const result = await fetchJson<InvitationDeliveryResponse>(
        householdApiPath("/admin/members"),
        {
          method: "POST",
          body: JSON.stringify(memberFormState),
        },
      );

      setMemberFormState(INITIAL_MEMBER_FORM_STATE);
      reportInvitationDelivery(result, "Invitation email sent.");
      await refreshInvitations();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to create household invitation",
      );
      return false;
    } finally {
      setIsSavingMember(false);
    }
  }

  async function handleCreateInvitation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    setIsSavingInvitation(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const result = await fetchJson<InvitationDeliveryResponse>(
        householdApiPath("/admin/invitations"),
        {
          method: "POST",
          body: JSON.stringify(invitationFormState),
        },
      );

      setInvitationFormState(INITIAL_INVITATION_FORM_STATE);
      reportInvitationDelivery(result, "Invitation email sent.");
      await refreshInvitations();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to create invitation",
      );
      return false;
    } finally {
      setIsSavingInvitation(false);
    }
  }

  async function handleResendInvitation(invitationId: string) {
    setIsSavingInvitation(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const result = await fetchJson<InvitationDeliveryResponse>(
        householdApiPath(`/admin/invitations/${invitationId}/resend`),
        {
          method: "POST",
        },
      );

      reportInvitationDelivery(result, "Invitation resent.");
      await refreshInvitations();
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to resend invitation",
      );
    } finally {
      setIsSavingInvitation(false);
    }
  }

  async function handleCancelInvitation(
    invitationId: string,
  ): Promise<boolean> {
    setIsSavingInvitation(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson(householdApiPath(`/admin/invitations/${invitationId}`), {
        method: "DELETE",
      });

      setStatusMessage("Invitation cancelled.");
      await refreshInvitations();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to cancel invitation",
      );
      return false;
    } finally {
      setIsSavingInvitation(false);
    }
  }

  async function handleRemoveMember(userId: string): Promise<boolean> {
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ ok: boolean }>(
        householdApiPath(`/admin/members/${userId}`),
        { method: "DELETE" },
      );
      setStatusMessage("Member removed from the household.");
      await refreshMembers();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to remove member",
      );
      return false;
    }
  }

  async function handleLeaveHousehold(slug: string): Promise<boolean> {
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ ok: boolean }>(`/api/households/${slug}/leave`, {
        method: "POST",
      });
      setHouseholds((current) => current.filter((h) => h.slug !== slug));
      setStatusMessage("You left the household.");
      await Promise.all([refetch(), refreshSettings()]);
      navigate("/", { replace: true });
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to leave household",
      );
      return false;
    }
  }

  async function handleMemberRoleChange(
    userId: string,
    role: MemberSummary["role"],
  ) {
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ ok: boolean }>(
        householdApiPath(`/admin/members/${userId}/role`),
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
      );

      setStatusMessage(`Updated member role to ${role}.`);
      await refreshMembers();
      if (
        session?.user?.email === members.find((m) => m.id === userId)?.email
      ) {
        await refetch();
      }
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update member role",
      );
    }
  }

  async function handleProviderAccessToggle(
    userId: string,
    providerKey: string,
    shouldHaveAccess: boolean,
  ) {
    setStatusMessage(null);
    setViewError(null);

    try {
      const { method, statusMessage } =
        getProviderAccessToggleRequest(shouldHaveAccess);

      await fetchJson<{ ok: boolean }>(
        householdApiPath(
          method === "DELETE"
            ? `/admin/members/${userId}/provider-access/${encodeURIComponent(providerKey)}`
            : `/admin/members/${userId}/provider-access`,
        ),
        method === "DELETE"
          ? { method }
          : { method, body: JSON.stringify({ providerKey }) },
      );

      setStatusMessage(statusMessage);
      await refreshMembers();
      await refreshProviders();
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to update provider access",
      );
    }
  }

  async function handleCreateProvider(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ provider: ProviderConfiguration }>(
        householdApiPath("/admin/providers"),
        {
          method: "POST",
          body: JSON.stringify(providerFormState),
        },
      );

      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setStatusMessage("Provider created.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to create provider",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleUpdateProvider(): Promise<boolean> {
    if (!selectedProviderId) return false;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ provider: ProviderConfiguration }>(
        householdApiPath(`/admin/providers/${selectedProviderId}`),
        {
          method: "PATCH",
          body: JSON.stringify(providerFormState),
        },
      );

      setStatusMessage("Provider updated.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update provider",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleDeleteProvider(): Promise<boolean> {
    if (!selectedProviderId) return false;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ ok: boolean }>(
        householdApiPath(`/admin/providers/${selectedProviderId}`),
        {
          method: "DELETE",
        },
      );

      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setRuleFormState(INITIAL_RULE_FORM_STATE);
      setStatusMessage("Provider deleted.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to delete provider",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleCreateRule(
    event: FormEvent<HTMLFormElement>,
  ): Promise<boolean> {
    event.preventDefault();
    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ rule: SenderRule }>(
        householdApiPath("/admin/provider-rules"),
        {
          method: "POST",
          body: JSON.stringify(ruleFormState),
        },
      );

      setRuleFormState((current) => ({
        ...INITIAL_RULE_FORM_STATE,
        providerId: current.providerId,
      }));
      setStatusMessage("Sender rule created.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to create sender rule",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleUpdateRule(): Promise<boolean> {
    if (!selectedRuleId) return false;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ rule: SenderRule }>(
        householdApiPath(`/admin/provider-rules/${selectedRuleId}`),
        {
          method: "PATCH",
          body: JSON.stringify(ruleFormState),
        },
      );

      setStatusMessage("Sender rule updated.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update sender rule",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleDeleteRule(): Promise<boolean> {
    if (!selectedRuleId) return false;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ ok: boolean }>(
        householdApiPath(`/admin/provider-rules/${selectedRuleId}`),
        {
          method: "DELETE",
        },
      );

      setRuleFormState((current) => ({
        ...INITIAL_RULE_FORM_STATE,
        providerId: current.providerId,
      }));
      setStatusMessage("Sender rule deleted.");
      await Promise.all([
        refreshProviderConfigurations(),
        refreshProviders(),
        refreshMembers(),
      ]);
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to delete sender rule",
      );
      return false;
    } finally {
      setIsSavingProviderConfiguration(false);
    }
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
              <InboxView
                providers={providers}
                selectedProviderKey={selectedProviderKey}
                onSelectProvider={setSelectedProviderKey}
                messages={messages}
                selectedMessageId={selectedMessageId}
                onSelectMessage={setSelectedMessageId}
                isLoadingInbox={isLoadingInbox}
                isSavingMessage={isSavingMessage}
                onStatusChange={handleStatusChange}
                hasOlderMessages={messagesNextBefore !== null}
                isLoadingOlderMessages={isLoadingOlderMessages}
                onLoadOlderMessages={loadOlderMessages}
              />
            }
          />
          <Route
            path="/settings"
            element={
              <SettingsView
                profile={profile}
                sessions={settingsSessions}
                isLoading={isLoadingSettings}
                error={viewError}
                formState={settingsFormState}
                onFormChange={(update) =>
                  setSettingsFormState((current) => ({ ...current, ...update }))
                }
                onUpdateProfile={handleUpdateProfile}
                onChangePassword={handleChangePassword}
                onRequestPasswordReset={handleRequestPasswordReset}
                onEnable2FA={handleEnable2FA}
                onDisable2FA={handleDisable2FA}
                twoFactorSetup={twoFactorSetup}
                onVerify2FA={handleVerify2FA}
                onCancel2FASetup={handleCancel2FASetup}
                onLeaveHousehold={handleLeaveHousehold}
                onAddPasskey={handleAddPasskey}
                onRevokeSession={handleRevokeSession}
                onRevokeOtherSessions={handleRevokeOtherSessions}
                isSaving={isSavingSettings}
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
                <QuarantineView
                  quarantineMessages={quarantineMessages}
                  selectedQuarantineId={selectedQuarantineId}
                  onSelectMessage={setSelectedQuarantineId}
                  isLoadingQuarantine={isLoadingQuarantine}
                  providers={providers}
                  releaseProviderKey={releaseProviderKey}
                  onReleaseProviderKeyChange={setReleaseProviderKey}
                  isReviewingQuarantine={isReviewingQuarantine}
                  onQuarantineReview={handleQuarantineReview}
                  hasOlderMessages={quarantineNextBefore !== null}
                  isLoadingOlderMessages={isLoadingOlderQuarantine}
                  onLoadOlderMessages={loadOlderQuarantine}
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
                <MembersView
                  members={members}
                  invitations={invitations}
                  providerOptions={providerOptions}
                  selectedMemberId={selectedMemberId}
                  onSelectMember={setSelectedMemberId}
                  isLoadingMembers={isLoadingMembers}
                  memberFormState={memberFormState}
                  onMemberFormChange={(update) =>
                    setMemberFormState((current) => ({ ...current, ...update }))
                  }
                  onCreateMember={handleCreateMember}
                  isSavingMember={isSavingMember}
                  invitationFormState={invitationFormState}
                  onInvitationFormChange={(update) =>
                    setInvitationFormState((current) => ({
                      ...current,
                      ...update,
                    }))
                  }
                  onCreateInvitation={handleCreateInvitation}
                  onResendInvitation={handleResendInvitation}
                  onCancelInvitation={handleCancelInvitation}
                  isSavingInvitation={isSavingInvitation}
                  onRoleChange={handleMemberRoleChange}
                  onRemoveMember={handleRemoveMember}
                  onProviderAccessToggle={handleProviderAccessToggle}
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
                <ProvidersRulesView
                  providers={providerConfigurations}
                  rules={senderRules}
                  selectedProviderId={selectedProviderId}
                  selectedRuleId={selectedRuleId}
                  providerFormState={providerFormState}
                  ruleFormState={ruleFormState}
                  isSaving={isSavingProviderConfiguration}
                  onSelectProvider={(providerId) => {
                    setSelectedProviderId(providerId);
                    const provider = providerConfigurations.find(
                      (item) => item.id === providerId,
                    );

                    setProviderFormState(
                      provider
                        ? {
                            providerKey: provider.provider_key,
                            displayName: provider.display_name,
                          }
                        : INITIAL_PROVIDER_FORM_STATE,
                    );

                    const firstRule =
                      senderRules.find(
                        (rule) => rule.provider_id === providerId,
                      ) ?? null;
                    setSelectedRuleId(firstRule?.id ?? null);
                    setRuleFormState(
                      firstRule
                        ? {
                            providerId: firstRule.provider_id,
                            matchType: firstRule.match_type,
                            matchValue: firstRule.match_value,
                          }
                        : {
                            ...INITIAL_RULE_FORM_STATE,
                            providerId,
                          },
                    );
                  }}
                  onSelectRule={(ruleId) => {
                    setSelectedRuleId(ruleId);
                    const rule = senderRules.find((item) => item.id === ruleId);

                    if (!rule) {
                      return;
                    }

                    setRuleFormState({
                      providerId: rule.provider_id,
                      matchType: rule.match_type,
                      matchValue: rule.match_value,
                    });
                  }}
                  onProviderFormChange={(update) =>
                    setProviderFormState((current) => ({
                      ...current,
                      ...update,
                    }))
                  }
                  onRuleFormChange={(update) =>
                    setRuleFormState((current) => ({ ...current, ...update }))
                  }
                  onCreateProvider={handleCreateProvider}
                  onUpdateProvider={handleUpdateProvider}
                  onDeleteProvider={handleDeleteProvider}
                  onCreateRule={handleCreateRule}
                  onUpdateRule={handleUpdateRule}
                  onDeleteRule={handleDeleteRule}
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
          action={
            viewError && pendingInviteLink ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => void copyPendingInviteLink()}
              >
                Copy invite link
              </Button>
            ) : undefined
          }
        >
          {viewError || statusMessage}
        </Alert>
      </Snackbar>
    </Layout>
  );
}
