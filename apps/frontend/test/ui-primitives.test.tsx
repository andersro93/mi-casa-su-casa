// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { InboxOutlined } from "@mui/icons-material";
import { Button } from "@mui/material";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../src/components/ConfirmDialog";
import {
  CopyButton,
  EmptyState,
  ErrorState,
  LoadingState,
  MessageStatusChip,
  PageHeader,
  PasswordField,
  RelativeTime,
} from "../src/components/ui";
import { formatRelativeTime } from "../src/utils";
import { renderClient, screen, userEvent, within } from "./client-test-utils";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PageHeader", () => {
  it("renders the title as the page h1 with description and action", () => {
    renderClient(
      <PageHeader
        eyebrow="Familien Olsen"
        title="Inbox"
        description="Latest codes for your services."
        action={<Button>Refresh</Button>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Inbox" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Familien Olsen")).toBeInTheDocument();
    expect(
      screen.getByText("Latest codes for your services."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});

describe("EmptyState / LoadingState / ErrorState", () => {
  it("shows title, description and action", () => {
    renderClient(
      <EmptyState
        icon={<InboxOutlined />}
        title="No codes yet"
        description="They'll show up here."
        action={<Button>Invite someone</Button>}
      />,
    );
    expect(screen.getByText("No codes yet")).toBeInTheDocument();
    expect(screen.getByText("They'll show up here.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite someone" }),
    ).toBeInTheDocument();
  });

  it("LoadingState is announced as a status", () => {
    renderClient(<LoadingState label="Loading inbox" rows={2} />);
    expect(
      screen.getByRole("status", { name: "Loading inbox" }),
    ).toBeInTheDocument();
  });

  it("ErrorState offers a retry action", async () => {
    const onRetry = vi.fn();
    renderClient(<ErrorState message="Could not load." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load.");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("MessageStatusChip", () => {
  it("maps statuses to plain labels", () => {
    renderClient(
      <>
        <MessageStatusChip status="new" />
        <MessageStatusChip status="used" />
        <MessageStatusChip status="expired" />
      </>,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Used")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});

describe("CopyButton", () => {
  it("copies the value and shows a copied state, announced politely", async () => {
    // user-event installs its own clipboard stub on setup, so stub after.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const onCopied = vi.fn();
    renderClient(
      <CopyButton value="482913" label="Copy code" onCopied={onCopied} />,
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("482913");
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(
      screen.getAllByRole("button", { name: "Copied" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("status").some((el) => el.textContent === "Copied"),
    ).toBe(true);
  });

  it("falls back to execCommand when the clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.assign(document, { execCommand });
    renderClient(
      <CopyButton value="7731" variant="button" label="Copy code" />,
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(
      screen.getAllByRole("button", { name: "Copied" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("PasswordField", () => {
  it("toggles between hidden and visible", async () => {
    renderClient(
      <PasswordField label="Password" defaultValue="hunter22hunter22" />,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("ConfirmDialog (accessible)", () => {
  it("is labelled by its title, described by its body, and shows errors inline", () => {
    renderClient(
      <ConfirmDialog
        open
        title="Remove Kari?"
        description="She loses access right away."
        confirmLabel="Remove"
        loadingLabel="Removing…"
        error="Could not remove member."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Remove Kari?" });
    expect(dialog).toHaveAccessibleDescription(/She loses access right away/);
    expect(
      within(dialog).getByText("Could not remove member."),
    ).toBeInTheDocument();
  });

  it("uses the specific loading label", () => {
    renderClient(
      <ConfirmDialog
        open
        isLoading
        title="Leave?"
        description="…"
        confirmLabel="Leave"
        loadingLabel="Leaving…"
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Leaving…" })).toBeDisabled();
  });
});

describe("RelativeTime / formatRelativeTime", () => {
  const now = new Date("2026-08-21T10:00:00Z").getTime();

  it("formats ages the way people say them", () => {
    expect(formatRelativeTime("2026-08-21T09:59:40Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-08-21T09:55:00Z", now)).toBe("5 min ago");
    expect(formatRelativeTime("2026-08-21T07:00:00Z", now)).toBe("3 hr ago");
    expect(formatRelativeTime("2026-08-20T08:00:00Z", now)).toMatch(
      /^yesterday /,
    );
    expect(formatRelativeTime("2026-08-18T08:00:00Z", now)).toMatch(/^\w{3} /);
    expect(formatRelativeTime("2026-07-01T08:00:00Z", now)).toMatch(/2026/);
    expect(formatRelativeTime("garbage", now)).toBe("garbage");
  });

  it("renders a <time> element with the absolute timestamp as title", () => {
    vi.useFakeTimers({ now });
    renderClient(
      <RelativeTime value="2026-08-21T09:55:00Z" prefix="Received" />,
    );
    const time = screen.getByText(/Received 5 min ago/);
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-08-21T09:55:00Z");
    expect(time).toHaveAttribute("title");
  });
});
