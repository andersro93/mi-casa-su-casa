import { CssBaseline, MenuList, ThemeProvider } from "@mui/material";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  getPageTitle,
  isSettingsPath,
  Layout,
  UserAccountMenuContent,
} from "../src/client/components/Layout";
import { ColorModeContext, getTheme } from "../src/client/theme";
import { getUserInitials } from "../src/client/utils";

describe("Layout", () => {
  it("shows owner household settings in the sidebar and keeps account settings in the menu", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/home/inbox"]}>
        <ColorModeContext.Provider value={{ toggleColorMode: vi.fn() }}>
          <ThemeProvider theme={getTheme("light")}>
            <CssBaseline />
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
            </Layout>
          </ThemeProvider>
        </ColorModeContext.Provider>
      </MemoryRouter>,
    );

    const settingsIndex = html.indexOf("Settings");
    const membersIndex = html.indexOf("Members");
    const quarantineIndex = html.indexOf("Quarantine");
    const providersIndex = html.indexOf("Providers &amp; rules");
    const householdSettingsIndex = html.indexOf("Household settings");

    expect(html).toContain("Inbox");
    expect(html).toContain("Settings");
    expect(html).toContain("Household settings");
    expect(html).toContain("Quarantine");
    expect(html).toContain("Members");
    expect(html).toContain("Providers &amp; rules");
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
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/home/settings"]}>
        <ColorModeContext.Provider value={{ toggleColorMode: vi.fn() }}>
          <ThemeProvider theme={getTheme("light")}>
            <CssBaseline />
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
            </Layout>
          </ThemeProvider>
        </ColorModeContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('href="/home/inbox"');
    expect(isSettingsPath("/home/settings")).toBe(true);
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/home/inbox")).toBe(false);
  });

  it("hides household settings from members", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/home/inbox"]}>
        <ColorModeContext.Provider value={{ toggleColorMode: vi.fn() }}>
          <ThemeProvider theme={getTheme("light")}>
            <CssBaseline />
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
            </Layout>
          </ThemeProvider>
        </ColorModeContext.Provider>
      </MemoryRouter>,
    );

    expect(html).not.toContain("Household settings");
  });
});

describe("UserAccountMenuContent", () => {
  it("renders settings, theme toggle, and sign out actions", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/home/inbox"]}>
        <ThemeProvider theme={getTheme("dark")}>
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
          </MenuList>
        </ThemeProvider>
      </MemoryRouter>,
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
    expect(getPageTitle("/home/quarantine")).toBe("Quarantine");
    expect(getPageTitle("/home/providers")).toBe("Providers & rules");
    expect(getPageTitle("/home/settings")).toBe("Household settings");
    expect(getPageTitle("/settings")).toBe("Settings");
  });
});
