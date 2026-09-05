/**
 * Registers the app-shell service worker (apps/frontend/public/sw.js) and asks
 * it to check for a new version whenever the app comes back to the foreground,
 * so an installed home-screen app picks up deploys without a manual reload.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => undefined);
        }
      });
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  };

  if (document.readyState === "complete") {
    void register();
  } else {
    window.addEventListener("load", () => void register(), { once: true });
  }
}
