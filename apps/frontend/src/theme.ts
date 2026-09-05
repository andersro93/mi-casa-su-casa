import { alpha, createTheme } from "@mui/material/styles";
import { createContext } from "react";

/**
 * Colour mode handling.
 *
 * The user's choice is persisted in localStorage; "system" (the default)
 * follows `prefers-color-scheme`. The context keeps the small surface the
 * Layout menu needs.
 */
export type ColorMode = "light" | "dark";
export type ColorModePreference = ColorMode | "system";

export const COLOR_MODE_STORAGE_KEY = "mcsc:color-mode";

export const ColorModeContext = createContext({ toggleColorMode: () => {} });

export function readStoredColorMode(
  storage: Pick<Storage, "getItem"> | null | undefined,
): ColorModePreference {
  try {
    const value = storage?.getItem(COLOR_MODE_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function persistColorMode(
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined,
  preference: ColorModePreference,
) {
  try {
    if (preference === "system") {
      storage?.removeItem(COLOR_MODE_STORAGE_KEY);
    } else {
      storage?.setItem(COLOR_MODE_STORAGE_KEY, preference);
    }
  } catch {
    // Private mode / storage disabled: the choice just won't survive reloads.
  }
}

export function resolveColorMode(
  preference: ColorModePreference,
  prefersDark: boolean,
): ColorMode {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * Brand colours, sampled from assets/mi-casa-su-casa-logo.png and the PWA
 * icons: a terracotta house, a coral envelope, on cream.
 */
export const brand = {
  terracotta: "#CA6B3D",
  terracottaDeep: "#B55326",
  terracottaDark: "#A4481F",
  coral: "#F38466",
  coralSoft: "#F7AB94",
  coralDeep: "#E07A58",
  cream: "#F7F8F2",
  sand: "#F3E8D6",
  cocoa: "#2B211C",
  cocoaDark: "#1C1715",
} as const;

export const FONT_FAMILY_BODY =
  '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const FONT_FAMILY_HEADING =
  '"Nunito Variable", "Nunito", "Inter Variable", "Inter", system-ui, sans-serif';

const heading = {
  fontFamily: FONT_FAMILY_HEADING,
  fontWeight: 700,
  lineHeight: 1.2,
  letterSpacing: "-0.01em",
} as const;

export function getTheme(mode: ColorMode) {
  const isLight = mode === "light";

  const palette = {
    mode,
    primary: isLight
      ? {
          main: brand.terracottaDeep,
          light: brand.terracotta,
          dark: brand.terracottaDark,
          contrastText: "#FFFFFF",
        }
      : {
          main: brand.coral,
          light: brand.coralSoft,
          dark: brand.coralDeep,
          contrastText: "#2B1A12",
        },
    secondary: isLight
      ? {
          main: brand.coral,
          light: brand.coralSoft,
          dark: brand.coralDeep,
          contrastText: brand.cocoa,
        }
      : {
          main: brand.terracotta,
          light: "#D98A63",
          dark: brand.terracottaDeep,
          contrastText: "#FFFFFF",
        },
    background: isLight
      ? { default: brand.cream, paper: "#FFFFFF" }
      : { default: brand.cocoaDark, paper: "#262019" },
    text: isLight
      ? { primary: brand.cocoa, secondary: "#6F6158", disabled: "#A89C93" }
      : { primary: "#F3ECE6", secondary: "#B8ACA3", disabled: "#7D716A" },
    divider: isLight ? "#E9E3DA" : "#3A312B",
    success: { main: isLight ? "#2F8F5B" : "#5CC08A" },
    warning: { main: isLight ? "#C98A08" : "#F2B84B" },
    error: { main: isLight ? "#C8382E" : "#F07A70" },
    info: { main: isLight ? "#2F7FB8" : "#7DBDE8" },
  };

  // A palette-only theme so component overrides below can reference the
  // resolved colours. Everything is then passed to ONE createTheme call:
  // typography must be part of the initial options, otherwise the per-variant
  // font families are already baked in and the override only changes the
  // top-level value.
  const base = createTheme({ palette });

  return createTheme({
    palette,
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: FONT_FAMILY_BODY,
      h1: { ...heading, fontSize: "2.25rem" },
      h2: { ...heading, fontSize: "1.75rem" },
      h3: { ...heading, fontSize: "1.5rem" },
      h4: { ...heading, fontSize: "1.25rem" },
      h5: { ...heading, fontSize: "1.125rem" },
      h6: { ...heading, fontSize: "1rem" },
      subtitle1: { fontWeight: 600, lineHeight: 1.4 },
      subtitle2: { fontWeight: 600, lineHeight: 1.4 },
      body1: { lineHeight: 1.55 },
      body2: { lineHeight: 1.5 },
      button: {
        fontWeight: 600,
        textTransform: "none",
        letterSpacing: 0,
      },
      overline: {
        fontWeight: 700,
        letterSpacing: "0.08em",
        lineHeight: 1.6,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: {
            WebkitTapHighlightColor: "transparent",
            textRendering: "optimizeLegibility",
          },
          body: {
            backgroundColor: base.palette.background.default,
          },
          "a:focus-visible, button:focus-visible, [tabindex]:focus-visible": {
            outline: `2px solid ${base.palette.primary.main}`,
            outlineOffset: 2,
          },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
              scrollBehavior: "auto !important",
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 10, paddingInline: 16 },
          sizeSmall: { minHeight: 36 },
          sizeMedium: { minHeight: 44, paddingInline: 20 },
          sizeLarge: { minHeight: 52, paddingInline: 24, fontSize: "1rem" },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: 10 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
          rounded: { borderRadius: 12 },
          outlined: { borderColor: base.palette.divider },
        },
      },
      MuiCard: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: { borderRadius: 16 },
        },
      },
      MuiCardHeader: {
        defaultProps: {
          slotProps: {
            title: { variant: "h5" },
            subheader: { variant: "body2" },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: base.palette.background.paper,
          },
          notchedOutline: { borderColor: base.palette.divider },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 20,
            [base.breakpoints.down("sm")]: {
              margin: 16,
              width: "calc(100% - 32px)",
              maxHeight: "calc(100% - 32px)",
            },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: { ...heading, fontSize: "1.25rem" },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 8, fontWeight: 600 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            "&.Mui-selected": {
              backgroundColor: alpha(base.palette.primary.main, 0.1),
              "&:hover": {
                backgroundColor: alpha(base.palette.primary.main, 0.16),
              },
            },
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: { borderRadius: 8, marginInline: 6 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: { borderRadius: 12 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: "0.8125rem" },
        },
      },
      MuiLink: {
        defaultProps: { underline: "hover" },
        styleOverrides: {
          root: { fontWeight: 500 },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: { borderRadius: 8 },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: { fontWeight: 600 },
        },
      },
    },
  });
}
