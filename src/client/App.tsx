import {
  Alert,
  Box,
  CircularProgress,
  Snackbar,
  Typography,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import { type FormEvent, useEffect, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { InboxView } from "./components/InboxView";
import { InvitePage } from "./components/InvitePage";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import { MembersView } from "./components/MembersView";
import { ProvidersRulesView } from "./components/ProvidersRulesView";
import { QuarantineView } from "./components/QuarantineView";
import { SettingsView } from "./components/SettingsView";
import { SetupPage } from "./components/SetupPage";
import type {
  AccountProfile,
  AccountSession,
  AccountSettingsFormState,
  InboxMessage,
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
  SenderRule,
  SenderRuleFormState,
  SetupStatus,
} from "./types";
import { fetchJson, getProviderAccessToggleRequest } from "./utils";

type ViewType = "inbox" | "quarantine" | "members" | "providers" | "settings";

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

const INITIAL_MEMBER_FORM_STATE: MemberFormState = {
  email: "",
  name: "",
  password: "",
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

  const activeView: ViewType = location.pathname.startsWith("/settings")
    ? "settings"
    : location.pathname.startsWith("/quarantine")
      ? "quarantine"
      : location.pathname.startsWith("/members")
        ? "members"
        : location.pathname.startsWith("/providers")
          ? "providers"
          : "inbox";
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

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  const isAuthenticated = Boolean(session?.user?.email);
  const isOwner = session?.user?.role === "admin";

  const handleSnackbarClose = () => {
    setStatusMessage(null);
    setViewError(null);
  };

  function InviteRoute() {
    const { token } = useParams<{ token: string }>();

    if (!token) {
      return <Navigate to="/login" replace />;
    }

    return (
      <InvitePage
        token={token}
        onAcceptSuccess={() => {
          navigate("/inbox", { replace: true });
          void refetch();
        }}
      />
    );
  }

  useEffect(() => {
    if (!isAuthenticated || activeView !== "settings") {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      setIsLoadingSettings(true);

      try {
        const response = await fetchJson<{
          profile: AccountProfile;
          sessions: AccountSession[];
        }>("/api/settings");

        if (cancelled) return;

        setProfile(response.profile);
        setSettingsSessions(response.sessions);
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
  }, [isAuthenticated, activeView]);

  async function refreshSettings() {
    if (!isAuthenticated) return;
    const response = await fetchJson<{
      profile: AccountProfile;
      sessions: AccountSession[];
    }>("/api/settings");
    setProfile(response.profile);
    setSettingsSessions(response.sessions);
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

  async function handleEnable2FA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSavingSettings(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const { error } = await authClient.twoFactor.enable({
        password: settingsFormState.twoFactorPassword,
      });

      if (error) {
        throw new Error(error.message || "Failed to enable 2FA");
      }

      setSettingsFormState((current) => ({
        ...current,
        twoFactorPassword: "",
      }));
      setStatusMessage("Two-factor authentication enabled.");
      await refreshSettings();
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to enable 2FA",
      );
    } finally {
      setIsSavingSettings(false);
    }
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
      navigate("/inbox", { replace: true });
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
          navigate("/inbox", { replace: true });
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
    if (!isAuthenticated) {
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
          "/api/inbox/providers",
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
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !selectedProviderKey) {
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
          `/api/inbox/providers/${selectedProviderKey}`,
        );

        if (cancelled) return;

        setMessages(response.messages);
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
  }, [isAuthenticated, selectedProviderKey]);

  useEffect(() => {
    if (!isAuthenticated || !isOwner || activeView !== "quarantine") {
      return;
    }

    let cancelled = false;

    const loadQuarantine = async () => {
      setIsLoadingQuarantine(true);

      try {
        const response = await fetchJson<{ messages: QuarantineMessage[] }>(
          "/api/inbox/quarantine",
        );

        if (cancelled) return;

        setQuarantineMessages(response.messages);
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
  }, [isAuthenticated, isOwner, activeView]);

  useEffect(() => {
    if (!isAuthenticated || !isOwner || activeView !== "providers") {
      return;
    }

    let cancelled = false;

    const loadProviderConfigurations = async () => {
      setIsSavingProviderConfiguration(false);

      try {
        const response = await fetchJson<ProviderConfigurationResponse>(
          "/api/admin/providers",
        );

        if (cancelled) return;

        setProviderConfigurations(response.providers);
        setSenderRules(response.rules);

        const nextProviderId =
          selectedProviderId &&
          response.providers.some(
            (provider) => provider.id === selectedProviderId,
          )
            ? selectedProviderId
            : (response.providers[0]?.id ?? null);

        setSelectedProviderId(nextProviderId);

        const selectedProvider = response.providers.find(
          (provider) => provider.id === nextProviderId,
        );

        setProviderFormState(
          selectedProvider
            ? {
                providerKey: selectedProvider.provider_key,
                displayName: selectedProvider.display_name,
              }
            : INITIAL_PROVIDER_FORM_STATE,
        );

        const nextRuleId =
          selectedRuleId &&
          response.rules.some((rule) => rule.id === selectedRuleId)
            ? selectedRuleId
            : (response.rules.find(
                (rule) => rule.provider_id === nextProviderId,
              )?.id ?? null);

        setSelectedRuleId(nextRuleId);

        const selectedRule = response.rules.find(
          (rule) => rule.id === nextRuleId,
        );

        setRuleFormState(
          selectedRule
            ? {
                providerId: selectedRule.provider_id,
                matchType: selectedRule.match_type,
                matchValue: selectedRule.match_value,
              }
            : {
                ...INITIAL_RULE_FORM_STATE,
                providerId: nextProviderId ?? "",
              },
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
    activeView,
    selectedProviderId,
    selectedRuleId,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !isOwner || activeView !== "members") {
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
          }>("/api/admin/members"),
          fetchJson<{ invitations: InvitationSummary[] }>(
            "/api/admin/invitations",
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
  }, [isAuthenticated, isOwner, activeView]);

  async function refreshProviders() {
    if (!isAuthenticated) return;
    const response = await fetchJson<{ providers: ProviderSummary[] }>(
      "/api/inbox/providers",
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

  async function refreshQuarantine() {
    if (!isAuthenticated || !isOwner) return;
    const response = await fetchJson<{ messages: QuarantineMessage[] }>(
      "/api/inbox/quarantine",
    );
    setQuarantineMessages(response.messages);
    setSelectedQuarantineId((current) => {
      if (current && response.messages.some((m) => m.id === current)) {
        return current;
      }
      return response.messages[0]?.id ?? null;
    });
  }

  async function refreshMembers() {
    if (!isAuthenticated || !isOwner) return;
    const response = await fetchJson<{
      members: MemberSummary[];
      providers: ProviderOption[];
    }>("/api/admin/members");
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
    if (!isAuthenticated || !isOwner) return;
    const response = await fetchJson<{ invitations: InvitationSummary[] }>(
      "/api/admin/invitations",
    );
    setInvitations(response.invitations);
  }

  async function refreshProviderConfigurations() {
    if (!isAuthenticated || !isOwner) return;

    const response = await fetchJson<ProviderConfigurationResponse>(
      "/api/admin/providers",
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
        `/api/inbox/messages/${selectedMessageId}/status`,
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
      await fetchJson(`/api/inbox/quarantine/${selectedQuarantineId}/review`, {
        method: "POST",
        body: JSON.stringify(
          action === "release"
            ? { action, providerKey: releaseProviderKey }
            : { action },
        ),
      });

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
      await fetchJson<{ member: unknown }>("/api/admin/members", {
        method: "POST",
        body: JSON.stringify(memberFormState),
      });

      setMemberFormState(INITIAL_MEMBER_FORM_STATE);
      setStatusMessage("Household member created.");
      await refreshMembers();
      return true;
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to create household member",
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
      await fetchJson<{ invitation: InvitationSummary }>(
        "/api/admin/invitations",
        {
          method: "POST",
          body: JSON.stringify(invitationFormState),
        },
      );

      setInvitationFormState(INITIAL_INVITATION_FORM_STATE);
      setStatusMessage("Invitation email sent.");
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
      await fetchJson<{ invitation: InvitationSummary }>(
        `/api/admin/invitations/${invitationId}/resend`,
        {
          method: "POST",
        },
      );

      setStatusMessage("Invitation resent.");
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
      await fetchJson(`/api/admin/invitations/${invitationId}`, {
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

  async function handleMemberRoleChange(
    userId: string,
    role: MemberSummary["role"],
  ) {
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ ok: boolean }>(`/api/admin/members/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });

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
        `/api/admin/members/${userId}/provider-access`,
        {
          method,
          body: JSON.stringify({ providerKey }),
        },
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
        "/api/admin/providers",
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
        `/api/admin/providers/${selectedProviderId}`,
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
        `/api/admin/providers/${selectedProviderId}`,
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
      await fetchJson<{ rule: SenderRule }>("/api/admin/provider-rules", {
        method: "POST",
        body: JSON.stringify(ruleFormState),
      });

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
        `/api/admin/provider-rules/${selectedRuleId}`,
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
        `/api/admin/provider-rules/${selectedRuleId}`,
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

  if (isSessionPending || isCheckingSetup) {
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
        <Route path="/invite/:token" element={<InviteRoute />} />
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

  return (
    <Layout session={session} isOwner={isOwner} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route
          path="/inbox"
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
              onAddPasskey={handleAddPasskey}
              onRevokeSession={handleRevokeSession}
              onRevokeOtherSessions={handleRevokeOtherSessions}
              isSaving={isSavingSettings}
            />
          }
        />
        <Route
          path="/quarantine"
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
              />
            ) : (
              <Navigate to="/inbox" replace />
            )
          }
        />
        <Route
          path="/members"
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
                onProviderAccessToggle={handleProviderAccessToggle}
              />
            ) : (
              <Navigate to="/inbox" replace />
            )
          }
        />
        <Route
          path="/providers"
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
                  setProviderFormState((current) => ({ ...current, ...update }))
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
              <Navigate to="/inbox" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/inbox" replace />} />
      </Routes>

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
