import { Box, Typography } from "@mui/material";
import { FONT_FAMILY_BODY } from "../../theme";

interface CodeDisplayProps {
  code: string;
  size?: "small" | "large";
}

/** A one-time code, set so digits are easy to read and type: tabular, grouped. */
export function CodeDisplay({ code, size = "large" }: CodeDisplayProps) {
  // Group long purely-numeric codes in threes/fours for readability; the
  // copied value is always the raw code.
  const display = /^\d{6}$/.test(code)
    ? `${code.slice(0, 3)} ${code.slice(3)}`
    : /^\d{8}$/.test(code)
      ? `${code.slice(0, 4)} ${code.slice(4)}`
      : code;
  return (
    <Box component="span" sx={{ display: "inline-block", minWidth: 0 }}>
      <Typography
        component="span"
        aria-label={`Code ${code.split("").join(" ")}`}
        sx={{
          fontFamily: FONT_FAMILY_BODY,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: size === "large" ? "0.06em" : "0.04em",
          fontSize:
            size === "large" ? { xs: "2.25rem", sm: "2.75rem" } : "1.25rem",
          lineHeight: 1.1,
          wordBreak: "break-all",
        }}
      >
        {display}
      </Typography>
    </Box>
  );
}
