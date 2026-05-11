import { createTheme } from "@mui/material/styles";
import { createContext } from "react";

export const ColorModeContext = createContext({ toggleColorMode: () => {} });

export function getTheme(mode: "light" | "dark") {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: mode === "light" ? "#8D6E63" : "#D7CCC8",
        light: "#BE9C91",
        dark: "#5F4339",
      },
      secondary: {
        main: mode === "light" ? "#F4A460" : "#FFCC80",
        light: "#F8C699",
        dark: "#C07C36",
      },
      background: {
        default: mode === "light" ? "#FAFAFA" : "#121212",
        paper: mode === "light" ? "#FFFFFF" : "#1E1E1E",
      },
      warning: {
        main: "#FF9800",
      },
      success: {
        main: "#4CAF50",
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
            boxShadow: mode === "light" 
              ? "0px 4px 20px rgba(0, 0, 0, 0.05)" 
              : "0px 4px 20px rgba(0, 0, 0, 0.5)",
          },
        },
      },
    },
  });
}
