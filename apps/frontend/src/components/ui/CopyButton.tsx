import { CheckOutlined, ContentCopyOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  type ButtonProps,
  IconButton,
  Tooltip,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";

/** Copy text to the clipboard, falling back to a hidden textarea + execCommand. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  value: string;
  /** What is being copied, used in labels: "Copy code". Default "Copy". */
  label?: string;
  copiedLabel?: string;
  /** Icon-only (default) or a regular button with text. */
  variant?: "icon" | "button";
  size?: "small" | "medium" | "large";
  color?: ButtonProps["color"] | "inherit";
  onCopied?: () => void;
  /** How long the "Copied" state is shown, in ms. */
  resetAfterMs?: number;
  sx?: ButtonProps["sx"];
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "icon",
  size = "medium",
  color = "primary",
  onCopied,
  resetAfterMs = 2000,
  sx,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = async () => {
    const ok = await copyToClipboard(value);
    setState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), resetAfterMs);
  };

  const text =
    state === "copied"
      ? copiedLabel
      : state === "failed"
        ? "Couldn't copy — select it instead"
        : label;
  const icon = state === "copied" ? <CheckOutlined /> : <ContentCopyOutlined />;

  return (
    <>
      <Tooltip title={text} placement="top">
        {variant === "button" ? (
          <Button
            onClick={handleClick}
            startIcon={icon}
            size={size}
            color={color === "inherit" ? "inherit" : color}
            variant="contained"
            aria-label={state === "idle" ? label : text}
            sx={sx}
          >
            {text}
          </Button>
        ) : (
          <IconButton
            onClick={handleClick}
            size={size}
            color={color === "inherit" ? "inherit" : color}
            aria-label={state === "idle" ? label : text}
            sx={sx}
          >
            {icon}
          </IconButton>
        )}
      </Tooltip>
      {/* Announce the result to assistive tech without a visible toast. */}
      <Box
        component="span"
        role="status"
        aria-live="polite"
        sx={{
          position: "absolute",
          // Literal pixels: in sx, `width: 1` means 100% and would overflow.
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {state === "idle" ? "" : text}
      </Box>
    </>
  );
}
