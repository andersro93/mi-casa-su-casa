import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useId, useState } from "react";
import { suggestHouseholdSlug } from "../../utils";
import {
  describeSenderProblem,
  normalizeSenderValue,
  suggestDomainFromName,
} from "./senderRules";

export interface ServiceDraft {
  displayName: string;
  providerKey: string;
  /** First sender (domain) when creating; empty to skip. */
  firstSenderDomain?: string;
}

interface ServiceDialogProps {
  open: boolean;
  mode: "create" | "rename";
  initial?: { displayName: string; providerKey: string } | null;
  existingKeys: string[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: ServiceDraft) => void | Promise<void>;
}

function uniqueKey(base: string, existing: string[], keep?: string) {
  if (!base) return "";
  if (base === keep || !existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Add a service (name + first sender) or rename one. */
export function ServiceDialog({
  open,
  mode,
  initial = null,
  existingKeys,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ServiceDialogProps) {
  const titleId = useId();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [domain, setDomain] = useState("");
  const [domainEdited, setDomainEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setDisplayName(initial?.displayName ?? "");
      setDomain("");
      setDomainEdited(false);
      setSubmitted(false);
    }
  }, [open, initial]);

  const nameProblem = displayName.trim() ? null : "Give the service a name.";
  const domainProblem =
    mode === "create" && domain.trim()
      ? describeSenderProblem("domain", domain)
      : null;
  const providerKey =
    mode === "rename" && initial
      ? initial.providerKey
      : uniqueKey(suggestHouseholdSlug(displayName), existingKeys);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameProblem || domainProblem) return;
    void onSubmit({
      displayName: displayName.trim(),
      providerKey,
      firstSenderDomain:
        mode === "create" && domain.trim()
          ? normalizeSenderValue("domain", domain)
          : undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id={titleId}>
          {mode === "create"
            ? "Add a service"
            : `Rename ${initial?.displayName ?? "service"}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {mode === "create" ? (
              <Typography variant="body2" color="text.secondary">
                A service is an account your household shares — Netflix,
                Spotify, your bank. Name it the way your family says it.
              </Typography>
            ) : null}
            <TextField
              autoFocus
              fullWidth
              required
              label="Service name"
              placeholder="e.g. Netflix"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (!domainEdited)
                  setDomain(suggestDomainFromName(e.target.value));
              }}
              error={submitted && Boolean(nameProblem)}
              helperText={
                submitted && nameProblem
                  ? nameProblem
                  : providerKey
                    ? `Short name used in links: ${providerKey}`
                    : " "
              }
            />
            {mode === "create" ? (
              <TextField
                fullWidth
                label="Emails come from (domain)"
                placeholder="netflix.com"
                value={domain}
                onChange={(e) => {
                  setDomainEdited(true);
                  setDomain(e.target.value);
                }}
                error={submitted && Boolean(domainProblem)}
                helperText={
                  submitted && domainProblem
                    ? domainProblem
                    : "Any email from this domain counts — e.g. netflix.com also covers em.netflix.com. Optional: you can add senders later."
                }
                slotProps={{
                  htmlInput: {
                    autoCapitalize: "none",
                    autoCorrect: "off",
                    spellCheck: false,
                    inputMode: "url",
                  },
                }}
              />
            ) : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={onClose}
            disabled={isSaving}
            variant="outlined"
            color="inherit"
          >
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={isSaving}>
            {isSaving
              ? "Saving…"
              : mode === "create"
                ? "Add service"
                : "Save name"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
