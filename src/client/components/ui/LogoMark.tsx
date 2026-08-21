import { Box, Typography } from "@mui/material";
import { brand } from "../../theme";

interface LogoMarkProps {
  size?: number;
}

/** The brand mark: a terracotta house with a coral envelope, drawn inline so it is crisp at any size. */
export function LogoMark({ size = 32 }: LogoMarkProps) {
  return (
    <Box
      component="svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      sx={{ display: "block", flexShrink: 0 }}
    >
      <title>Mi Casa Su Casa</title>
      {/* roof */}
      <path
        d="M32 8 L6 30 H14 V52 A6 6 0 0 0 20 58 H44 A6 6 0 0 0 50 52 V30 H58 Z"
        fill={brand.terracotta}
      />
      {/* chimney */}
      <rect
        x="42"
        y="12"
        width="7"
        height="12"
        rx="2"
        fill={brand.terracotta}
      />
      {/* envelope */}
      <rect x="20" y="32" width="24" height="18" rx="3" fill={brand.coral} />
      <path
        d="M20 35 L32 44 L44 35"
        fill="none"
        stroke={brand.terracotta}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}

interface BrandLockupProps {
  size?: number;
  /** Hide the wordmark (icon only). */
  compact?: boolean;
}

/** Logo + wordmark, used in the drawer header and on public pages. */
export function BrandLockup({ size = 32, compact = false }: BrandLockupProps) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1.25,
        minWidth: 0,
      }}
    >
      <LogoMark size={size} />
      {compact ? null : (
        <Typography
          variant="h5"
          component="span"
          noWrap
          sx={{ color: "text.primary", letterSpacing: "-0.01em" }}
        >
          Mi Casa Su Casa
        </Typography>
      )}
    </Box>
  );
}
