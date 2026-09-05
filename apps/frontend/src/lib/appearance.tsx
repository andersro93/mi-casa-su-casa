/**
 * Colour mode and MUI theme. Lifted out of `main.tsx` so the router's root
 * route can provide it: every screen, including the pending and not-found
 * fallbacks, renders inside it.
 */
import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ColorModeContext,
  type ColorModePreference,
  getTheme,
  persistColorMode,
  readStoredColorMode,
  resolveColorMode,
} from "../theme";

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const [preference, setPreference] = useState<ColorModePreference>(() =>
    readStoredColorMode(getStorage()),
  );
  const mode = resolveColorMode(preference, prefersDarkMode);

  const colorMode = useMemo(
    () => ({
      toggleColorMode: () => {
        setPreference((current) => {
          const next =
            resolveColorMode(current, prefersDarkMode) === "light"
              ? "dark"
              : "light";
          persistColorMode(getStorage(), next);
          return next;
        });
      },
    }),
    [prefersDarkMode],
  );

  const theme = useMemo(() => getTheme(mode), [mode]);

  // Keep the browser/PWA chrome in step with the app surface colour.
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme.palette.background.paper);
  }, [theme]);

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
