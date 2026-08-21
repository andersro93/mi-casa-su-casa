import "@fontsource-variable/inter";
import "@fontsource-variable/nunito";

import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { createQueryClient } from "./queries/client";
import { registerServiceWorker } from "./service-worker";
import {
  ColorModeContext,
  type ColorModePreference,
  getTheme,
  persistColorMode,
  readStoredColorMode,
  resolveColorMode,
} from "./theme";

const queryClient = createQueryClient();

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function AppWrapper() {
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ColorModeContext.Provider value={colorMode}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
          </ThemeProvider>
        </ColorModeContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

createRoot(container).render(
  <StrictMode>
    <AppWrapper />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  registerServiceWorker();
}
