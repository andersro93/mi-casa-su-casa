import { CssBaseline, MenuList, ThemeProvider } from "@mui/material";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  Layout,
  UserAccountMenuContent,
} from "../src/client/components/Layout";
import { ColorModeContext, getTheme } from "../src/client/theme";
import { getUserInitials } from "../src/client/utils";

describe("Layout", () => {
  it("keeps settings out of the sidebar and shows avatar initials fallback", () => {
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

    expect(html).toContain("Inbox");
    expect(html).toContain("Quarantine");
    expect(html).toContain("Members");
    expect(html).toContain("Providers &amp; rules");
    expect(html).not.toContain(">Settings<");
    expect(html).toContain("AM");
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
              householdSlug="home"
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
