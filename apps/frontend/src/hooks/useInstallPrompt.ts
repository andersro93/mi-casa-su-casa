import { useCallback, useEffect, useState } from "react";
import type { InstallState } from "../types";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isRunningStandalone(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Tracks whether the app is installed, can be installed via the browser's
 * native prompt (Chromium fires `beforeinstallprompt`), or needs the manual
 * "Add to Home Screen" route (iOS Safari).
 */
export function useInstallPrompt(): InstallState {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isRunningStandalone);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const onInstall = useCallback(async () => {
    if (!promptEvent) {
      return;
    }

    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;

    if (outcome === "accepted") {
      setPromptEvent(null);
    }
  }, [promptEvent]);

  return {
    status: installed ? "installed" : promptEvent ? "available" : "manual",
    onInstall,
  };
}
