import { createTheme } from "@mui/material/styles";
import { createContext } from "react";

export const ColorModeContext = createContext({ toggleColorMode: () => {} });

export function getTheme(mode: "light" | "dark") {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#6366F1",
        light: "#818CF8",
        dark: "#4F46E5",
      },
      secondary: {
        main: "#A78BFA",
        light: "#C4B5FD",
        dark: "#7C3AED",
      },
      background: {
        default: mode === "light" ? "#F8FAFC" : "#0F172A",
        paper: mode === "light" ? "#FFFFFF" : "#1E293B",
      },
      text: {
        primary: mode === "light" ? "#0F172A" : "#F1F5F9",
        secondary: mode === "light" ? "#475569" : "#94A3B8",
      },
      divider: mode === "light" ? "#E2E8F0" : "#334155",
      warning: {
        main: "#F59E0B",
      },
      success: {
        main: "#10B981",
      },
      error: {
        main: "#EF4444",
      },
      info: {
        main: "#38BDF8",
      },
    },
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: {
        fontSize: "2.5rem",
        fontWeight: 600,
      },
      h2: {
        fontSize: "2rem",
        fontWeight: 600,
      },
      h3: {
        fontSize: "1.5rem",
        fontWeight: 500,
      },
      h4: {
        fontSize: "1.25rem",
        fontWeight: 500,
      },
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow:
              mode === "light"
                ? "0px 4px 20px rgba(99, 102, 241, 0.08)"
                : "0px 4px 20px rgba(0, 0, 0, 0.4)",
          },
        },
      },
    },
  });
}
