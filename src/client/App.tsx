import { authClient } from "@server/auth/client";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type SessionData = {
  user?: {
    email?: string | null;
    name?: string | null;
    role?: string | null;
  };
};

type ProviderSummary = {
  provider_key: string;
  display_name: string;
  message_count: number;
  new_count: number;
  latest_received_at: string | null;
};

type InboxMessage = {
  id: string;
  provider_key: string;
  provider_display_name: string;
  subject: string | null;
  from_header: string | null;
  text_body: string;
  extracted_code: string | null;
  status: "new" | "used" | "expired";
  received_at: string;
};

type QuarantineMessage = {
  id: string;
  provider_key: "quarantine";
  provider_display_name: "Quarantine";
  subject: string | null;
  from_header: string | null;
  envelope_from: string;
  text_body: string;
  extracted_code: string | null;
  status: "new";
  quarantine_reason: string;
  received_at: string;
};

type ProviderMessagesResponse = {
  provider: {
    providerKey: string;
    displayName: string;
  };
  messages: InboxMessage[];
};

type LoginState = {
  email: string;
  password: string;
};

const INITIAL_LOGIN_STATE: LoginState = {
  email: "",
  password: "",
};

async function fetchJson<T>(
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

function formatTimestamp(value: string | null): string {
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

function getDisplayName(session: SessionData | null | undefined): string {
  const name = session?.user?.name?.trim();
  if (name) {
    return name;
  }

  return session?.user?.email ?? "family member";
}

function getStatusTone(status: InboxMessage["status"]): string {
  switch (status) {
    case "used":
      return "status-chip status-chip--used";
    case "expired":
      return "status-chip status-chip--expired";
    default:
      return "status-chip status-chip--new";
  }
}

export function App() {
  const {
    data: session,
    error: sessionError,
    isPending: isSessionPending,
    refetch,
  } = authClient.useSession();
  const [loginState, setLoginState] = useState<LoginState>(INITIAL_LOGIN_STATE);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
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
  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [isLoadingQuarantine, setIsLoadingQuarantine] = useState(false);
  const [isSavingMessage, setIsSavingMessage] = useState(false);
  const [isReviewingQuarantine, setIsReviewingQuarantine] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [releaseProviderKey, setReleaseProviderKey] = useState<string>("");

  const isAuthenticated = Boolean(session?.user?.email);
  const isOwner = session?.user?.role === "admin";

  useEffect(() => {
    if (!isAuthenticated) {
      setProviders([]);
      setMessages([]);
      setQuarantineMessages([]);
      setSelectedProviderKey(null);
      setSelectedMessageId(null);
      setSelectedQuarantineId(null);
      setReleaseProviderKey("");
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

        if (cancelled) {
          return;
        }

        setProviders(response.providers);
        setReleaseProviderKey((current) => {
          if (
            current &&
            response.providers.some(
              (provider) => provider.provider_key === current,
            )
          ) {
            return current;
          }

          return response.providers[0]?.provider_key ?? "";
        });
        setSelectedProviderKey((current) => {
          if (
            current &&
            response.providers.some(
              (provider) => provider.provider_key === current,
            )
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

        if (cancelled) {
          return;
        }

        setMessages(response.messages);
        setSelectedMessageId((current) => {
          if (
            current &&
            response.messages.some((message) => message.id === current)
          ) {
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
    if (!isAuthenticated || !isOwner) {
      setQuarantineMessages([]);
      setSelectedQuarantineId(null);
      return;
    }

    let cancelled = false;

    const loadQuarantine = async () => {
      setIsLoadingQuarantine(true);

      try {
        const response = await fetchJson<{ messages: QuarantineMessage[] }>(
          "/api/inbox/quarantine",
        );

        if (cancelled) {
          return;
        }

        setQuarantineMessages(response.messages);
        setSelectedQuarantineId((current) => {
          if (
            current &&
            response.messages.some((message) => message.id === current)
          ) {
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
  }, [isAuthenticated, isOwner]);

  const selectedProvider = useMemo(
    () =>
      providers.find(
        (provider) => provider.provider_key === selectedProviderKey,
      ) ?? null,
    [providers, selectedProviderKey],
  );

  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId],
  );

  const selectedQuarantineMessage = useMemo(
    () =>
      quarantineMessages.find(
        (message) => message.id === selectedQuarantineId,
      ) ?? null,
    [quarantineMessages, selectedQuarantineId],
  );

  async function refreshProviders() {
    if (!isAuthenticated) {
      return;
    }

    const response = await fetchJson<{ providers: ProviderSummary[] }>(
      "/api/inbox/providers",
    );
    setProviders(response.providers);
    setReleaseProviderKey((current) => {
      if (
        current &&
        response.providers.some((provider) => provider.provider_key === current)
      ) {
        return current;
      }

      return response.providers[0]?.provider_key ?? "";
    });
  }

  async function refreshQuarantine() {
    if (!isAuthenticated || !isOwner) {
      return;
    }

    const response = await fetchJson<{ messages: QuarantineMessage[] }>(
      "/api/inbox/quarantine",
    );
    setQuarantineMessages(response.messages);
    setSelectedQuarantineId((current) => {
      if (
        current &&
        response.messages.some((message) => message.id === current)
      ) {
        return current;
      }

      return response.messages[0]?.id ?? null;
    });
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    const { error } = await authClient.signIn.email({
      email: loginState.email,
      password: loginState.password,
      rememberMe: true,
    });

    setIsLoggingIn(false);

    if (error) {
      setLoginError(error.message ?? "Unable to sign in with that account.");
      return;
    }

    setLoginState(INITIAL_LOGIN_STATE);
    await refetch();
  }

  async function handleLogout() {
    setStatusMessage(null);
    setViewError(null);
    await authClient.signOut({});
    await refetch();
  }

  async function handleStatusChange(nextStatus: InboxMessage["status"]) {
    if (!selectedMessage) {
      return;
    }

    setIsSavingMessage(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      const response = await fetchJson<{ message: InboxMessage }>(
        `/api/inbox/messages/${selectedMessage.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
      );

      setMessages((current) =>
        current.map((message) =>
          message.id === response.message.id ? response.message : message,
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
    if (!selectedQuarantineMessage) {
      return;
    }

    setIsReviewingQuarantine(true);
    setStatusMessage(null);
    setViewError(null);

    try {
      await fetchJson(
        `/api/inbox/quarantine/${selectedQuarantineMessage.id}/review`,
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
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "Unable to review quarantine",
      );
    } finally {
      setIsReviewingQuarantine(false);
    }
  }

  if (isSessionPending) {
    return (
      <main className="app-shell">
        <section className="hero-card hero-card--centered">
          <p className="eyebrow">Mi Casa Su Casa</p>
          <h1>Loading your shared inbox…</h1>
          <p className="lede">
            Checking the current session and preparing the latest messages.
          </p>
        </section>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="app-shell">
        <section className="hero-card auth-card">
          <div>
            <p className="eyebrow">Mi Casa Su Casa</p>
            <h1>Shared verification inbox, without the chaos.</h1>
            <p className="lede">
              Sign in with your invited household account to see the provider
              groups you have access to and quickly find the latest verification
              code.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleLogin}>
            <label className="field-group">
              <span>Email</span>
              <input
                autoComplete="email"
                name="email"
                type="email"
                value={loginState.email}
                onChange={(event) =>
                  setLoginState((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                required
              />
            </label>

            <label className="field-group">
              <span>Password</span>
              <input
                autoComplete="current-password"
                name="password"
                type="password"
                value={loginState.password}
                onChange={(event) =>
                  setLoginState((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
                required
              />
            </label>

            {loginError || sessionError ? (
              <p className="inline-error">
                {loginError ?? sessionError?.message}
              </p>
            ) : null}

            <button
              className="primary-button"
              disabled={isLoggingIn}
              type="submit"
            >
              {isLoggingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <section className="topbar-card">
        <div>
          <p className="eyebrow">Mi Casa Su Casa</p>
          <h1>Welcome back, {getDisplayName(session)}.</h1>
          <p className="lede">
            Scan the latest provider messages, open the code you need, and keep
            the inbox tidy for the next person.
          </p>
        </div>

        <div className="topbar-actions">
          <div className="session-summary">
            <span className="session-summary__label">Access</span>
            <strong>{isOwner ? "Owner" : "Family member"}</strong>
            <span>{session?.user?.email}</span>
          </div>

          <button
            className="secondary-button"
            onClick={handleLogout}
            type="button"
          >
            Sign out
          </button>
        </div>
      </section>

      {statusMessage || viewError ? (
        <section className="feedback-row" aria-live="polite">
          {statusMessage ? (
            <p className="feedback-pill">{statusMessage}</p>
          ) : null}
          {viewError ? (
            <p className="feedback-pill feedback-pill--error">{viewError}</p>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-grid">
        <aside className="panel-card provider-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Providers</p>
              <h2>Your accessible groups</h2>
            </div>
            <span className="panel-meta">{providers.length} total</span>
          </div>

          <div className="provider-list">
            {providers.map((provider) => {
              const isSelected = provider.provider_key === selectedProviderKey;

              return (
                <button
                  aria-pressed={isSelected}
                  className={
                    isSelected
                      ? "provider-card provider-card--selected"
                      : "provider-card"
                  }
                  key={provider.provider_key}
                  onClick={() => setSelectedProviderKey(provider.provider_key)}
                  type="button"
                >
                  <div>
                    <strong>{provider.display_name}</strong>
                    <p>{formatTimestamp(provider.latest_received_at)}</p>
                  </div>
                  <div className="provider-stats">
                    <span>{provider.message_count} messages</span>
                    <span>{provider.new_count} new</span>
                  </div>
                </button>
              );
            })}

            {!providers.length && !isLoadingInbox ? (
              <div className="empty-state">
                <strong>No providers yet</strong>
                <p>
                  Once messages arrive for your household services, they’ll
                  appear here.
                </p>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="panel-card inbox-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Inbox</p>
              <h2>{selectedProvider?.display_name ?? "Choose a provider"}</h2>
            </div>
            {selectedProvider ? (
              <span className="panel-meta">{messages.length} messages</span>
            ) : null}
          </div>

          <div className="two-column-panel">
            <div className="message-list">
              {messages.map((message) => {
                const isSelected = message.id === selectedMessageId;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={
                      isSelected
                        ? "message-card message-card--selected"
                        : "message-card"
                    }
                    key={message.id}
                    onClick={() => setSelectedMessageId(message.id)}
                    type="button"
                  >
                    <div className="message-card__header">
                      <strong>{message.subject ?? "Untitled message"}</strong>
                      <span className={getStatusTone(message.status)}>
                        {message.status}
                      </span>
                    </div>
                    <p>{message.from_header ?? "Unknown sender"}</p>
                    <span>{formatTimestamp(message.received_at)}</span>
                  </button>
                );
              })}

              {!messages.length && !isLoadingInbox ? (
                <div className="empty-state">
                  <strong>No messages here yet</strong>
                  <p>
                    Select another provider or wait for the next verification
                    email.
                  </p>
                </div>
              ) : null}
            </div>

            <article className="detail-panel">
              {selectedMessage ? (
                <>
                  <div className="detail-panel__header">
                    <div>
                      <p className="panel-eyebrow">Message detail</p>
                      <h3>{selectedMessage.subject ?? "Untitled message"}</h3>
                      <p>{selectedMessage.from_header ?? "Unknown sender"}</p>
                    </div>
                    <span className={getStatusTone(selectedMessage.status)}>
                      {selectedMessage.status}
                    </span>
                  </div>

                  <div className="code-card">
                    <span className="code-card__label">Verification code</span>
                    <strong>
                      {selectedMessage.extracted_code ?? "No code detected"}
                    </strong>
                  </div>

                  <div className="message-actions">
                    <button
                      className="secondary-button"
                      disabled={isSavingMessage}
                      onClick={() => handleStatusChange("new")}
                      type="button"
                    >
                      Mark new
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isSavingMessage}
                      onClick={() => handleStatusChange("used")}
                      type="button"
                    >
                      Mark used
                    </button>
                    <button
                      className="secondary-button"
                      disabled={isSavingMessage}
                      onClick={() => handleStatusChange("expired")}
                      type="button"
                    >
                      Mark expired
                    </button>
                  </div>

                  <section className="message-body-card">
                    <h4>Plain-text message</h4>
                    <pre>{selectedMessage.text_body}</pre>
                  </section>
                </>
              ) : (
                <div className="empty-state empty-state--detail">
                  <strong>Select a message</strong>
                  <p>
                    Pick the most recent message in a provider group to see the
                    full code and body.
                  </p>
                </div>
              )}
            </article>
          </div>
        </section>

        {isOwner ? (
          <section className="panel-card quarantine-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-eyebrow">Owner tools</p>
                <h2>Quarantine review</h2>
              </div>
              <span className="panel-meta">
                {quarantineMessages.length} pending
              </span>
            </div>

            <div className="two-column-panel">
              <div className="message-list">
                {quarantineMessages.map((message) => {
                  const isSelected = message.id === selectedQuarantineId;

                  return (
                    <button
                      aria-pressed={isSelected}
                      className={
                        isSelected
                          ? "message-card message-card--selected"
                          : "message-card"
                      }
                      key={message.id}
                      onClick={() => setSelectedQuarantineId(message.id)}
                      type="button"
                    >
                      <div className="message-card__header">
                        <strong>{message.subject ?? "Untitled message"}</strong>
                        <span className="status-chip status-chip--quarantine">
                          review
                        </span>
                      </div>
                      <p>{message.envelope_from}</p>
                      <span>{formatTimestamp(message.received_at)}</span>
                    </button>
                  );
                })}

                {!quarantineMessages.length && !isLoadingQuarantine ? (
                  <div className="empty-state">
                    <strong>Quarantine is empty</strong>
                    <p>
                      Messages that need manual classification will appear here
                      for owner review.
                    </p>
                  </div>
                ) : null}
              </div>

              <article className="detail-panel">
                {selectedQuarantineMessage ? (
                  <>
                    <div className="detail-panel__header">
                      <div>
                        <p className="panel-eyebrow">Quarantine detail</p>
                        <h3>
                          {selectedQuarantineMessage.subject ??
                            "Untitled message"}
                        </h3>
                        <p>{selectedQuarantineMessage.envelope_from}</p>
                      </div>
                      <span className="status-chip status-chip--quarantine">
                        Needs review
                      </span>
                    </div>

                    <div className="code-card">
                      <span className="code-card__label">Detected code</span>
                      <strong>
                        {selectedQuarantineMessage.extracted_code ??
                          "No code detected"}
                      </strong>
                    </div>

                    <section className="message-body-card message-body-card--tight">
                      <h4>Why it was quarantined</h4>
                      <p>{selectedQuarantineMessage.quarantine_reason}</p>
                    </section>

                    <label className="field-group">
                      <span>Release to provider</span>
                      <select
                        value={releaseProviderKey}
                        onChange={(event) =>
                          setReleaseProviderKey(event.target.value)
                        }
                      >
                        {providers.map((provider) => (
                          <option
                            key={provider.provider_key}
                            value={provider.provider_key}
                          >
                            {provider.display_name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="message-actions">
                      <button
                        className="primary-button"
                        disabled={isReviewingQuarantine || !releaseProviderKey}
                        onClick={() => handleQuarantineReview("release")}
                        type="button"
                      >
                        Release to inbox
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isReviewingQuarantine}
                        onClick={() => handleQuarantineReview("dismiss")}
                        type="button"
                      >
                        Dismiss
                      </button>
                    </div>

                    <section className="message-body-card">
                      <h4>Plain-text message</h4>
                      <pre>{selectedQuarantineMessage.text_body}</pre>
                    </section>
                  </>
                ) : (
                  <div className="empty-state empty-state--detail">
                    <strong>Select a quarantined message</strong>
                    <p>
                      Review the classification reason, then release it to the
                      right provider or dismiss it.
                    </p>
                  </div>
                )}
              </article>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
