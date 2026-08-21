import { Typography, type TypographyProps } from "@mui/material";
import { useEffect, useState } from "react";
import { formatRelativeTime, formatTimestamp } from "../../utils";

/** Re-renders on an interval so relative labels stay fresh. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface RelativeTimeProps extends Omit<TypographyProps, "children"> {
  value: string | null;
  /** Prefix such as "Received". */
  prefix?: string;
}

/** "2 min ago" with the absolute time as the tooltip and `<time>` dateTime. */
export function RelativeTime({ value, prefix, ...props }: RelativeTimeProps) {
  const now = useNow();
  if (!value) return null;
  const relative = formatRelativeTime(value, now);
  const absolute = formatTimestamp(value);
  return (
    <Typography
      component="time"
      dateTime={value}
      title={absolute}
      variant="body2"
      color="text.secondary"
      {...props}
    >
      {prefix ? `${prefix} ` : ""}
      {relative}
    </Typography>
  );
}
