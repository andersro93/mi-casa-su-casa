import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { SenderRule } from "../../types";
import { describeSenderProblem, normalizeSenderValue } from "./senderRules";

export interface SenderDraft {
  matchType: SenderRule["match_type"];
  matchValue: string;
}

interface SenderDialogProps {
  open: boolean;
  serviceName: string;
  /** Existing sender when editing. */
  initial?: SenderDraft | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: SenderDraft) => void | Promise<void>;
}

/** Add/edit one sender for a service, in plain language. */
export function SenderDialog({
  open,
  serviceName,
  initial = null,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SenderDialogProps) {
  const titleId = useId();
  const [matchType, setMatchType] = useState<SenderRule["match_type"]>(
    initial?.matchType ?? "domain",
  );
  const [matchValue, setMatchValue] = useState(initial?.matchValue ?? "");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setMatchType(initial?.matchType ?? "domain");
      setMatchValue(initial?.matchValue ?? "");
      setSubmitted(false);
    }
  }, [open, initial]);

  const problem = describeSenderProblem(matchType, matchValue);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (problem) return;
    void onSubmit({
      matchType,
      matchValue: normalizeSenderValue(matchType, matchValue),
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
          {initial
            ? `Edit sender for ${serviceName}`
            : `Add a sender for ${serviceName}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Emails from this sender will be filed under {serviceName}. Look at
              the “From” line of a code email from the service to find it.
            </Typography>
            <FormControl>
              <FormLabel id={`${titleId}-type`}>Which emails count?</FormLabel>
              <RadioGroup
                aria-labelledby={`${titleId}-type`}
                value={matchType}
                onChange={(e) => {
                  setMatchType(e.target.value as SenderRule["match_type"]);
                  setSubmitted(false);
                }}
              >
                <FormControlLabel
                  value="domain"
                  control={<Radio />}
                  label={
                    <span>
                      Any email from a domain{" "}
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.secondary"
                      >
                        — e.g. netflix.com (also covers em.netflix.com)
                      </Typography>
                    </span>
                  }
                />
                <FormControlLabel
                  value="exact"
                  control={<Radio />}
                  label={
                    <span>
                      Only one exact address{" "}
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.secondary"
                      >
                        — e.g. info@account.netflix.com
                      </Typography>
                    </span>
                  }
                />
              </RadioGroup>
            </FormControl>
            <TextField
              autoFocus
              fullWidth
              required
              label={matchType === "domain" ? "Domain" : "Email address"}
              placeholder={
                matchType === "domain"
                  ? "netflix.com"
                  : "info@account.netflix.com"
              }
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
              error={submitted && Boolean(problem)}
              helperText={submitted && problem ? problem : " "}
              slotProps={{
                htmlInput: {
                  autoCapitalize: "none",
                  autoCorrect: "off",
                  spellCheck: false,
                  inputMode: matchType === "domain" ? "url" : "email",
                },
              }}
            />
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
            {isSaving ? "Saving…" : initial ? "Save sender" : "Add sender"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
