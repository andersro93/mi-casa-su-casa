import {
  CheckCircleOutlined,
  HistoryOutlined,
  MarkEmailUnreadOutlined,
} from "@mui/icons-material";
import { Chip, type ChipProps } from "@mui/material";
import type { ReactElement } from "react";
import type { InboxMessage } from "../../types";

export type StatusTone = "success" | "neutral" | "warning" | "error" | "info";

interface StatusChipProps extends Omit<ChipProps, "color" | "label" | "icon"> {
  tone: StatusTone;
  label: string;
  icon?: ReactElement;
}

const TONE_COLOR: Record<StatusTone, ChipProps["color"]> = {
  success: "success",
  neutral: "default",
  warning: "warning",
  error: "error",
  info: "info",
};

/** A small status label that always pairs colour with text (and an icon). */
export function StatusChip({
  tone,
  label,
  icon,
  size = "small",
  variant = "outlined",
  ...props
}: StatusChipProps) {
  return (
    <Chip
      {...props}
      size={size}
      variant={variant}
      color={TONE_COLOR[tone]}
      label={label}
      icon={icon}
    />
  );
}

export const MESSAGE_STATUS: Record<
  InboxMessage["status"],
  { label: string; tone: StatusTone; icon: ReactElement }
> = {
  new: { label: "New", tone: "success", icon: <MarkEmailUnreadOutlined /> },
  used: { label: "Used", tone: "neutral", icon: <CheckCircleOutlined /> },
  expired: { label: "Expired", tone: "warning", icon: <HistoryOutlined /> },
};

export function MessageStatusChip({
  status,
  ...props
}: { status: InboxMessage["status"] } & Omit<
  StatusChipProps,
  "tone" | "label" | "icon"
>) {
  const meta = MESSAGE_STATUS[status];
  return (
    <StatusChip
      {...props}
      tone={meta.tone}
      label={meta.label}
      icon={meta.icon}
    />
  );
}
