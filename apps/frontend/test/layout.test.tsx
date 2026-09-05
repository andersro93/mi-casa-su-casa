// @vitest-environment jsdom
import { MenuList } from "@mui/material";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  getPageTitle,
  isSettingsPath,
  Layout,
  UserAccountMenuContent,
} from "../src/components/Layout";
import { getUserInitials } from "../src/utils";
import { renderClient } from "./client-test-utils";

/**
 * These used to render to static markup with a React Router `MemoryRouter`.
 * TanStack Router's `Link` needs a live router, so they render into jsdom
 * through `renderClient` and assert on the resulting HTML instead.
 */
function markup(
  ui: ReactElement,
  path: string,
  mode: "light" | "dark" = "light",
) {
  return renderClient(ui, { initialEntries: [path], mode }).container.innerHTML;
}

describe("Layout", () => {
  it("shows owner household settings in the sidebar and keeps account settings in the menu", () => {
    const html = markup(
      <Layout
        session={{
          user: {
            email: "alex.member@example.com",
          },
        }}
        households={[
          {
            id: "household-1",
            slug: "home",
            displayName: "Home",
            role: "owner",
          },
        ]}
        isOwner={true}
        householdSlug="home"
        householdName="Home"
        householdRole="owner"
        onSelectHousehold={vi.fn()}
        onCreateHousehold={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>Inbox content</div>
      </Layout>,
      "/home/inbox",
    );

    const settingsIndex = html.indexOf("Settings");
    const membersIndex = html.indexOf("Members");
    const quarantineIndex = html.indexOf("Needs review");
    const providersIndex = html.indexOf("Services");
    const householdSettingsIndex = html.indexOf("Household settings");

    expect(html).toContain("Inbox");
    expect(html).toContain("Settings");
    expect(html).toContain("Household settings");
    expect(html).toContain("Needs review");
    expect(html).toContain("Members");
    expect(html).toContain("Services");
    expect(html).toContain("Home");
    expect(html).toContain("Owner");
    expect(html).toContain("AM");
    expect(settingsIndex).toBeGreaterThan(-1);
    expect(membersIndex).toBeGreaterThan(settingsIndex);
    expect(quarantineIndex).toBeGreaterThan(membersIndex);
    expect(providersIndex).toBeGreaterThan(quarantineIndex);
    expect(householdSettingsIndex).toBeGreaterThan(providersIndex);
  });

  it("treats household settings paths as settings views", () => {
    const html = markup(
      <Layout
        session={{
          user: {
            email: "alex.member@example.com",
          },
        }}
        households={[
          {
            id: "household-1",
            slug: "home",
            displayName: "Home",
            role: "owner",
          },
        ]}
        isOwner={true}
        householdSlug="home"
        householdName="Home"
        householdRole="owner"
        onSelectHousehold={vi.fn()}
        onCreateHousehold={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>Settings content</div>
      </Layout>,
      "/home/settings",
    );

    expect(html).toContain('href="/home/inbox"');
    expect(isSettingsPath("/home/settings")).toBe(true);
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/home/inbox")).toBe(false);
  });

  it("hides household settings from members", () => {
    const html = markup(
      <Layout
        session={{
          user: {
            email: "alex.member@example.com",
          },
        }}
        households={[
          {
            id: "household-1",
            slug: "home",
            displayName: "Home",
            role: "member",
          },
        ]}
        isOwner={false}
        householdSlug="home"
        householdName="Home"
        householdRole="member"
        onSelectHousehold={vi.fn()}
        onCreateHousehold={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>Inbox content</div>
      </Layout>,
      "/home/inbox",
    );

    expect(html).not.toContain("Household settings");
  });

  it("offers a skip link to the main content for keyboard users", () => {
    const html = markup(
      <Layout
        session={{ user: { email: "alex.member@example.com" } }}
        households={[
          {
            id: "household-1",
            slug: "home",
            displayName: "Home",
            role: "member",
          },
        ]}
        isOwner={false}
        householdSlug="home"
        householdName="Home"
        householdRole="member"
        onSelectHousehold={vi.fn()}
        onCreateHousehold={vi.fn()}
        onLogout={vi.fn()}
      >
        <div>Inbox content</div>
      </Layout>,
      "/home/inbox",
    );
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('id="main-content"');
  });
});

describe("UserAccountMenuContent", () => {
  it("renders settings, theme toggle, and sign out actions", () => {
    const html = markup(
      <MenuList>
        <UserAccountMenuContent
          session={{
            user: {
              name: "Alex Member",
              email: "alex.member@example.com",
            },
          }}
          mode="dark"
          onSettingsClick={vi.fn()}
          onToggleColorMode={vi.fn()}
          onLogout={vi.fn()}
        />
      </MenuList>,
      "/home/inbox",
      "dark",
    );

    expect(html).toContain("Alex Member");
    expect(html).toContain("alex.member@example.com");
    expect(html).toContain("Settings");
    // Account settings are a global route, distinct from /:slug/settings
    // (household settings).
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('href="/home/settings"');
    expect(html).toContain("Light mode");
    expect(html).toContain("Sign out");
  });
});

describe("getUserInitials", () => {
  it("uses name initials when a profile name exists", () => {
    expect(
      getUserInitials({
        user: {
          name: "Alex Member",
          email: "alex.member@example.com",
        },
      }),
    ).toBe("AM");
  });

  it("falls back to email-derived initials when there is no name", () => {
    expect(
      getUserInitials({
        user: {
          email: "alex.member@example.com",
        },
      }),
    ).toBe("AM");
  });
});

describe("getPageTitle", () => {
  it("names the current page for the mobile app bar", () => {
    expect(getPageTitle("/home/inbox")).toBe("Latest codes");
    expect(getPageTitle("/home/inbox/netflix")).toBe("Latest codes");
    expect(getPageTitle("/home/members")).toBe("Members");
    expect(getPageTitle("/home/quarantine")).toBe("Needs review");
    expect(getPageTitle("/home/providers")).toBe("Services");
    expect(getPageTitle("/home/settings")).toBe("Household settings");
    expect(getPageTitle("/settings")).toBe("Settings");
  });
});
