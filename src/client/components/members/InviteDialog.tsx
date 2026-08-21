import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { ProviderOption } from "../../types";

export interface InviteDraft {
  email: string;
  name: string;
  role: "member" | "owner";
  providerIds: string[];
}

interface InviteDialogProps {
  open: boolean;
  providers: ProviderOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (draft: InviteDraft) => void | Promise<void>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The one way to add someone: invite them by email (or get a link to share). */
export function InviteDialog({
  open,
  providers,
  isSaving,
  error,
  onClose,
  onSubmit,
}: InviteDialogProps) {
  const titleId = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRole("member");
      setProviderIds(providers.map((p) => p.id));
      setSubmitted(false);
    }
  }, [open, providers]);

  const problems = {
    email: EMAIL.test(email.trim()) ? null : "Enter their email address.",
    name: name.trim() ? null : "Enter their name.",
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (problems.email || problems.name) return;
    void onSubmit({
      email: email.trim(),
      name: name.trim(),
      role,
      providerIds: role === "owner" ? [] : providerIds,
    });
  };

  const toggle = (id: string) =>
    setProviderIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby={titleId}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogTitle id={titleId}>Invite someone</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              They'll get an email with a link to create their account. If the
              email can't be sent, you'll get a link to share instead.
            </Typography>
            <TextField
              autoFocus
              required
              fullWidth
              type="email"
              inputMode="email"
              autoComplete="off"
              label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={submitted && Boolean(problems.email)}
              helperText={submitted ? problems.email : undefined}
            />
            <TextField
              required
              fullWidth
              autoComplete="off"
              label="Name"
              placeholder="e.g. Kari"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={submitted && Boolean(problems.name)}
              helperText={submitted ? problems.name : undefined}
            />
            <FormControl>
              <FormLabel id={`${titleId}-role`}>What can they do?</FormLabel>
              <RadioGroup
                aria-labelledby={`${titleId}-role`}
                value={role}
                onChange={(e) => setRole(e.target.value as "member" | "owner")}
              >
                <FormControlLabel
                  value="member"
                  control={<Radio />}
                  label={
                    <span>
                      Member{" "}
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.secondary"
                      >
                        — sees the codes for the services you pick below
                      </Typography>
                    </span>
                  }
                />
                <FormControlLabel
                  value="owner"
                  control={<Radio />}
                  label={
                    <span>
                      Owner{" "}
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.secondary"
                      >
                        — sees everything and can manage services and members
                      </Typography>
                    </span>
                  }
                />
              </RadioGroup>
            </FormControl>
            {role === "member" ? (
              <FormControl component="fieldset" variant="standard">
                <FormLabel component="legend">
                  Which services can they see?
                </FormLabel>
                {providers.length === 0 ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1 }}
                  >
                    You haven't added any services yet. You can give access
                    later.
                  </Typography>
                ) : (
                  <FormGroup>
                    {providers.map((provider) => (
                      <FormControlLabel
                        key={provider.id}
                        control={
                          <Checkbox
                            checked={providerIds.includes(provider.id)}
                            onChange={() => toggle(provider.id)}
                          />
                        }
                        label={provider.display_name}
                      />
                    ))}
                  </FormGroup>
                )}
              </FormControl>
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
            {isSaving ? "Sending…" : "Send invitation"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
