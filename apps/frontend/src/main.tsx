import "@fontsource-variable/inter";
import "@fontsource-variable/nunito";

import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { router } from "./router";
import { registerServiceWorker } from "./service-worker";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Root container not found");
}

// Theme, query client and snackbar providers moved into the router's root
// route (see router.tsx) so pending and not-found screens render inside them.
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  registerServiceWorker();
}
