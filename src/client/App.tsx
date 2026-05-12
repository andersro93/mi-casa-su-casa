import {
  Alert,
  Box,
  CircularProgress,
  Snackbar,
  Typography,
} from "@mui/material";
import { authClient } from "@server/auth/client";
import { type FormEvent, useEffect, useState } from "react";
import { InboxView } from "./components/InboxView";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import { MembersView } from "./components/MembersView";
import { ProvidersRulesView } from "./components/ProvidersRulesView";
import { QuarantineView } from "./components/QuarantineView";
import { SetupPage } from "./components/SetupPage";
import type {
  InboxMessage,
  MemberFormState,
  MemberSummary,
  ProviderConfiguration,
  ProviderConfigurationResponse,
  ProviderFormState,
  ProviderMessagesResponse,
  ProviderOption,
  SenderRule,
  SenderRuleFormState,
  ProviderSummary,
  QuarantineMessage,
  SetupStatus,
} from "./types";
import { fetchJson } from "./utils";

type ViewType = "inbox" | "quarantine" | "members" | "providers";

const INITIAL_MEMBER_FORM_STATE: MemberFormState = {
  email: "",
  name: "",
  password: "",
  role: "member",
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
  const [isSetupPath, setIsSetupPath] = useState(
    typeof window !== "undefined" && window.location.pathname === "/setup",
  );

  const [activeView, setActiveView] = useState<ViewType>("inbox");
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [selectedProviderKey, setSelectedProviderKey] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<InboxMessage[]>([]);
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

  async function refreshSetupStatus() {
    if (typeof window === "undefined") {
      return;
    }

    const status = await fetchJson<SetupStatus>("/api/setup/status");
    setSetupStatus(status);

    if (status.needsSetup && window.location.pathname !== "/setup") {
      window.history.replaceState({}, "", "/setup");
      setIsSetupPath(true);
      return;
    }

    if (!status.needsSetup && window.location.pathname === "/setup") {
      window.history.replaceState({}, "", "/");
      setIsSetupPath(false);
      return;
    }

    setIsSetupPath(window.location.pathname === "/setup");
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

        if (status.needsSetup && window.location.pathname !== "/setup") {
          window.history.replaceState({}, "", "/setup");
          setIsSetupPath(true);
        } else if (
          !status.needsSetup &&
          window.location.pathname === "/setup"
        ) {
          window.history.replaceState({}, "", "/");
          setIsSetupPath(false);
        } else {
          setIsSetupPath(window.location.pathname === "/setup");
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
  }, []);

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
      setProviderConfigurations([]);
      setSenderRules([]);
      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setRuleFormState(INITIAL_RULE_FORM_STATE);
      setActiveView("inbox");
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
          response.providers.some((provider) => provider.id === selectedProviderId)
            ? selectedProviderId
            : response.providers[0]?.id ?? null;

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
            : response.rules.find((rule) => rule.provider_id === nextProviderId)?.id ??
              null;

        setSelectedRuleId(nextRuleId);

        const selectedRule = response.rules.find((rule) => rule.id === nextRuleId);

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
  }, [isAuthenticated, isOwner, activeView, selectedProviderId, selectedRuleId]);

  useEffect(() => {
    if (!isAuthenticated || !isOwner || activeView !== "members") {
      return;
    }

    let cancelled = false;

    const loadMembers = async () => {
      setIsLoadingMembers(true);

      try {
        const response = await fetchJson<{
          members: MemberSummary[];
          providers: ProviderOption[];
        }>("/api/admin/members");

        if (cancelled) return;

        setMembers(response.members);
        setProviderOptions(response.providers);
        setSelectedMemberId((current) => {
          if (current && response.members.some((m) => m.id === current)) {
            return current;
          }
          return response.members[0]?.id ?? null;
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

  async function refreshProviderConfigurations() {
    if (!isAuthenticated || !isOwner) return;

    const response = await fetchJson<ProviderConfigurationResponse>(
      "/api/admin/providers",
    );

    setProviderConfigurations(response.providers);
    setSenderRules(response.rules);

    setSelectedProviderId((current) => {
      if (current && response.providers.some((provider) => provider.id === current)) {
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

  async function handleQuarantineReview(action: "dismiss" | "release") {
    if (!selectedQuarantineId) return;

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
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to review quarantine",
      );
    } finally {
      setIsReviewingQuarantine(false);
    }
  }

  async function handleCreateMember(event: FormEvent<HTMLFormElement>) {
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
    } catch (error) {
      setViewError(
        error instanceof Error
          ? error.message
          : "Unable to create household member",
      );
    } finally {
      setIsSavingMember(false);
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
    hasAccess: boolean,
  ) {
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson<{ ok: boolean }>(
        `/api/admin/members/${userId}/provider-access`,
        {
          method: hasAccess ? "DELETE" : "POST",
          body: JSON.stringify({ providerKey }),
        },
      );

      setStatusMessage(
        hasAccess ? "Provider access revoked." : "Provider access granted.",
      );
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

  async function handleCreateProvider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ provider: ProviderConfiguration }>("/api/admin/providers", {
        method: "POST",
        body: JSON.stringify(providerFormState),
      });

      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setStatusMessage("Provider created.");
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to create provider",
      );
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleUpdateProvider() {
    if (!selectedProviderId) return;

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
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update provider",
      );
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleDeleteProvider() {
    if (!selectedProviderId) return;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ ok: boolean }>(`/api/admin/providers/${selectedProviderId}`,
        {
          method: "DELETE",
        },
      );

      setProviderFormState(INITIAL_PROVIDER_FORM_STATE);
      setRuleFormState(INITIAL_RULE_FORM_STATE);
      setStatusMessage("Provider deleted.");
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to delete provider",
      );
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleCreateRule(event: FormEvent<HTMLFormElement>) {
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
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to create sender rule",
      );
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleUpdateRule() {
    if (!selectedRuleId) return;

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
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to update sender rule",
      );
    } finally {
      setIsSavingProviderConfiguration(false);
    }
  }

  async function handleDeleteRule() {
    if (!selectedRuleId) return;

    setStatusMessage(null);
    setViewError(null);
    setIsSavingProviderConfiguration(true);

    try {
      await fetchJson<{ ok: boolean }>(`/api/admin/provider-rules/${selectedRuleId}`, {
        method: "DELETE",
      });

      setRuleFormState((current) => ({
        ...INITIAL_RULE_FORM_STATE,
        providerId: current.providerId,
      }));
      setStatusMessage("Sender rule deleted.");
      await Promise.all([refreshProviderConfigurations(), refreshProviders(), refreshMembers()]);
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to delete sender rule",
      );
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

  if (!isAuthenticated && setupStatus?.needsSetup && isSetupPath) {
    return (
      <SetupPage
        setupError={setupError}
        onSetupError={setSetupError}
        onSetupComplete={async () => {
          setStatusMessage("Owner account created. You are now signed in.");
          await Promise.all([refetch(), refreshSetupStatus()]);
        }}
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginPage
        setupStatus={setupStatus}
        setupError={setupError}
        onLoginSuccess={() => refetch()}
      />
    );
  }

  return (
    <Layout
      session={session}
      isOwner={isOwner}
      onLogout={handleLogout}
      activeView={activeView}
      onNavigate={setActiveView}
    >
      {activeView === "inbox" && (
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
      )}

      {activeView === "quarantine" && isOwner && (
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
      )}

      {activeView === "members" && isOwner && (
        <MembersView
          members={members}
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
          onRoleChange={handleMemberRoleChange}
          onProviderAccessToggle={handleProviderAccessToggle}
        />
      )}

      {activeView === "providers" && isOwner && (
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
            const provider = providerConfigurations.find((item) => item.id === providerId);

            setProviderFormState(
              provider
                ? {
                    providerKey: provider.provider_key,
                    displayName: provider.display_name,
                  }
                : INITIAL_PROVIDER_FORM_STATE,
            );

            const firstRule = senderRules.find((rule) => rule.provider_id === providerId) ?? null;
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
      )}

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
