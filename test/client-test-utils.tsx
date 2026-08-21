/**
 * Helpers for client interaction tests.
 *
 * Opt a test file into the DOM environment with a docblock at the top:
 *
 *   // @vitest-environment jsdom
 *
 * The unit project defaults to `environment: "node"` so the existing
 * static-markup tests stay untouched.
 */
import { CssBaseline, ThemeProvider } from "@mui/material";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import { ColorModeContext, getTheme } from "../src/client/theme";

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

interface RenderClientOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial router entries; defaults to the inbox of a household "home". */
  initialEntries?: string[];
  mode?: "light" | "dark";
}

/** Render a client component inside the theme + router providers the app uses. */
export function renderClient(
  ui: ReactElement,
  {
    initialEntries = ["/home/inbox"],
    mode = "light",
    ...options
  }: RenderClientOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <ColorModeContext.Provider value={{ toggleColorMode: () => {} }}>
          <ThemeProvider theme={getTheme(mode)}>
            <CssBaseline />
            {children}
          </ThemeProvider>
        </ColorModeContext.Provider>
      </MemoryRouter>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
