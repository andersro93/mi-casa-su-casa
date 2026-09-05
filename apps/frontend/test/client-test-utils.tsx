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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterContextProvider,
} from "@tanstack/react-router";
import { cleanup, type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach } from "vitest";

import { ColorModeContext, getTheme } from "../src/theme";

// Vitest has no global afterEach here, so Testing Library cannot auto-clean;
// unmount between tests ourselves or renders pile up in the same document.
afterEach(() => {
  cleanup();
});

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

interface RenderClientOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial router entries; defaults to the inbox of a household "home". */
  initialEntries?: string[];
  mode?: "light" | "dark";
  /** Supply a client to inspect/prime the cache; defaults to a fresh one with retries off. */
  queryClient?: QueryClient;
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
}

/**
 * The app's own path patterns, so a component's `Link`s and the router's own
 * path matching resolve exactly as they do in production.
 */
const APP_PATHS = [
  "/login",
  "/two-factor",
  "/forgot-password",
  "/reset-password",
  "/setup",
  "/invite/$token",
  "/new-household",
  "/settings",
  "/$slug/inbox",
  "/$slug/inbox/$providerKey",
  "/$slug/quarantine",
  "/$slug/members",
  "/$slug/providers",
  "/$slug/settings",
] as const;

/**
 * A memory-history router for the component under test — the TanStack
 * equivalent of the React Router `MemoryRouter` these tests used.
 *
 * It is mounted with `RouterContextProvider`, not `RouterProvider`: that puts
 * the router (and so the current location) into context without rendering the
 * matched route, which is what keeps `renderClient` synchronous.
 * `RouterProvider` resolves its first match asynchronously, so every `getBy*`
 * immediately after `render` would miss. Screens read the URL through
 * `useLocation`/`useRouterState`; route params reach them as props from the
 * route component, which is where the app reads them too.
 */
function createTestRouter(initialEntries: string[]) {
  const rootRoute = createRootRoute({ component: Outlet });
  const blank = () => null;
  const children = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: blank,
    }),
    ...APP_PATHS.map((path) =>
      createRoute({ getParentRoute: () => rootRoute, path, component: blank }),
    ),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "$",
      component: blank,
    }),
  ];

  return createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries }),
  });
}

/** Render a client component inside the theme + router providers the app uses. */
export function renderClient(
  ui: ReactElement,
  {
    initialEntries = ["/home/inbox"],
    mode = "light",
    queryClient = createTestQueryClient(),
    ...options
  }: RenderClientOptions = {},
) {
  const router = createTestRouter(initialEntries);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ColorModeContext.Provider value={{ toggleColorMode: () => {} }}>
          <ThemeProvider theme={getTheme(mode)}>
            <CssBaseline />
            <RouterContextProvider
              router={
                router as unknown as Parameters<
                  typeof RouterContextProvider
                >[0]["router"]
              }
            >
              {children}
            </RouterContextProvider>
          </ThemeProvider>
        </ColorModeContext.Provider>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), router };
}
