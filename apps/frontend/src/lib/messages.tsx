/**
 * The app-level snackbar. It used to live inside `Layout`, so only signed-in
 * screens could raise a message; now it sits on the root route and any screen
 * — the create-household page, account settings, the household shell — can
 * call `useAppMessages()`.
 */
import { Alert, Snackbar } from "@mui/material";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface AppMessages {
  /** A confirmation ("Household X created."). */
  notify: (message: string) => void;
  /** A failure; shown in the same place, in red. */
  notifyError: (message: string) => void;
  /**
   * Take down whatever is showing. Signing out uses it so a message raised
   * while signed in cannot follow the visitor onto the sign-in screen.
   */
  dismiss: () => void;
}

const AppMessageContext = createContext<AppMessages>({
  notify: () => {},
  notifyError: () => {},
  dismiss: () => {},
});

export function useAppMessages(): AppMessages {
  return useContext(AppMessageContext);
}

export function AppMessageProvider({ children }: { children: ReactNode }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const value = useMemo<AppMessages>(
    () => ({
      notify: (message: string) => {
        setErrorMessage(null);
        setStatusMessage(message);
      },
      notifyError: (message: string) => {
        setStatusMessage(null);
        setErrorMessage(message);
      },
      dismiss: () => {
        setStatusMessage(null);
        setErrorMessage(null);
      },
    }),
    [],
  );

  const handleClose = useCallback(() => {
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  return (
    <AppMessageContext.Provider value={value}>
      {children}
      <Snackbar
        open={Boolean(statusMessage || errorMessage)}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleClose}
          severity={errorMessage ? "error" : "success"}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {errorMessage || statusMessage}
        </Alert>
      </Snackbar>
    </AppMessageContext.Provider>
  );
}
