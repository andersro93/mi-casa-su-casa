import { CheckCircleOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from "@mui/material";
import QRCode from "qrcode";
import { type FormEvent, useId, useState } from "react";
import {
  useDisableTwoStep,
  useEnableTwoStep,
  useRegenerateBackupCodes,
  useVerifyTwoStep,
} from "../../queries/settings";
import type { TwoFactorSetup } from "../../types";
import { CopyButton, PasswordField, StatusChip } from "../ui";
import { SettingsSection } from "./SettingsSection";

interface TwoStepSectionProps {
  enabled: boolean;
  onSaved: (message: string) => void;
}

/** The one-shot codes, with the two ways of keeping them: copy, or download. */
function BackupCodeList({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(`Mi Casa Su Casa backup codes\n\n${text}\n`)}`;

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, bgcolor: "background.default" }}>
        <Box
          component="ul"
          aria-label="Backup codes"
          sx={{
            m: 0,
            pl: 0,
            listStyle: "none",
            columns: { xs: 1, sm: 2 },
            fontFamily: "monospace",
            fontSize: "1rem",
            lineHeight: 1.9,
          }}
        >
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </Box>
      </Paper>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <CopyButton
          value={text}
          label="Copy all codes"
          variant="button"
          size="small"
        />
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          component="a"
          href={href}
          download="mi-casa-su-casa-backup-codes.txt"
        >
          Download as a file
        </Button>
      </Stack>
    </>
  );
}

export function TwoStepSection({ enabled, onSaved }: TwoStepSectionProps) {
  const enable = useEnableTwoStep();
  const verify = useVerifyTwoStep();
  const disable = useDisableTwoStep();
  const regenerate = useRegenerateBackupCodes();
  const [dialog, setDialog] = useState<"enable" | "disable" | "codes" | null>(
    null,
  );
  /** A freshly minted set, shown once: the old ones stop working. */
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<TwoFactorSetup | null>(null);
  const [step, setStep] = useState(0); // 0 password, 1 scan+verify, 2 backup codes
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  const reset = () => {
    setDialog(null);
    setPassword("");
    setCode("");
    setEnrolment(null);
    setStep(0);
    setSaved(false);
    setError(null);
    setFreshCodes(null);
  };

  const startEnrolment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Enter your password to continue.");
      return;
    }
    try {
      const { uri } = await enable.mutateAsync(password);
      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCode.toDataURL(uri, { margin: 1 });
      } catch {
        qrDataUrl = null;
      }
      let secret: string | null = null;
      try {
        secret = new URL(uri).searchParams.get("secret");
      } catch {
        secret = null;
      }
      // No backup codes yet: the server only issues them once enrolment has
      // been finished with a working code, so step 2 fills them in.
      setEnrolment({ uri, qrDataUrl, secret, backupCodes: [] });
      setPassword("");
      setStep(1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't start two-step verification.",
      );
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const trimmed = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(trimmed)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    try {
      const backupCodes = await verify.mutateAsync(trimmed);
      setEnrolment((current) =>
        current ? { ...current, backupCodes } : current,
      );
      setStep(2);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code wasn't accepted. Try the next one.",
      );
    }
  };

  const finish = () => {
    reset();
    onSaved("Two-step verification is on.");
  };

  const turnOff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Enter your password to confirm.");
      return;
    }
    try {
      await disable.mutateAsync(password);
      reset();
      onSaved("Two-step verification is off.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't turn off two-step verification.",
      );
    }
  };

  return (
    <SettingsSection
      id="two-step"
      title="Two-step verification"
      description="An extra check when you sign in: a code from an authenticator app on your phone, plus backup codes for when you don't have it."
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <StatusChip
            tone={enabled ? "success" : "neutral"}
            label={enabled ? "On" : "Off"}
            icon={enabled ? <CheckCircleOutlined /> : undefined}
          />
          <Typography variant="body2" color="text.secondary">
            {enabled
              ? "You'll be asked for a code when signing in with your password."
              : "Not set up yet."}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {enabled ? (
            <Button
              variant="outlined"
              color="inherit"
              disabled={regenerate.isPending}
              onClick={async () => {
                setError(null);
                try {
                  const codes = await regenerate.mutateAsync();
                  setFreshCodes(codes);
                  setDialog("codes");
                } catch (err) {
                  onSaved(
                    err instanceof Error && err.message
                      ? err.message
                      : "Couldn't make new backup codes.",
                  );
                }
              }}
            >
              {regenerate.isPending ? "Making codes…" : "New backup codes"}
            </Button>
          ) : null}
          <Button
            variant={enabled ? "outlined" : "contained"}
            color={enabled ? "inherit" : "primary"}
            onClick={() => setDialog(enabled ? "disable" : "enable")}
          >
            {enabled ? "Turn off" : "Turn on"}
          </Button>
        </Stack>
      </Stack>

      <Dialog
        open={dialog === "enable"}
        onClose={enable.isPending || verify.isPending ? undefined : reset}
        fullWidth
        maxWidth="sm"
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId}>Turn on two-step verification</DialogTitle>
        <DialogContent>
          <Stepper activeStep={step} sx={{ mb: 3 }} alternativeLabel>
            <Step>
              <StepLabel>Confirm</StepLabel>
            </Step>
            <Step>
              <StepLabel>Scan</StepLabel>
            </Step>
            <Step>
              <StepLabel>Backup codes</StepLabel>
            </Step>
          </Stepper>
          {step === 0 ? (
            <form id="two-step-start" onSubmit={startEnrolment} noValidate>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  You'll need an authenticator app (Google Authenticator,
                  1Password, Authy…) on your phone. First, confirm it's you.
                </Typography>
                <PasswordField
                  autoFocus
                  fullWidth
                  label="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                {error ? <Alert severity="error">{error}</Alert> : null}
              </Stack>
            </form>
          ) : null}
          {step === 1 && enrolment ? (
            <form id="two-step-verify" onSubmit={verifyCode} noValidate>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Scan this with your authenticator app, then enter the 6-digit
                  code it shows.
                </Typography>
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                  sx={{ alignItems: "center" }}
                >
                  {enrolment.qrDataUrl ? (
                    <img
                      src={enrolment.qrDataUrl}
                      alt="QR code to scan with your authenticator app"
                      width={176}
                      height={176}
                      style={{ display: "block", borderRadius: 12 }}
                    />
                  ) : null}
                  {enrolment.secret ? (
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="div"
                      >
                        Can't scan? Enter this key by hand:
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: "center" }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: "monospace",
                            wordBreak: "break-all",
                          }}
                        >
                          {enrolment.secret}
                        </Typography>
                        <CopyButton
                          value={enrolment.secret}
                          label="Copy key"
                          size="small"
                        />
                      </Stack>
                    </Box>
                  ) : null}
                </Stack>
                <TextField
                  autoFocus
                  fullWidth
                  label="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  slotProps={{ htmlInput: { maxLength: 7 } }}
                />
                {error ? <Alert severity="error">{error}</Alert> : null}
              </Stack>
            </form>
          ) : null}
          {step === 2 && enrolment ? (
            <Stack spacing={2}>
              <Alert severity="success">Two-step verification is on.</Alert>
              <Typography variant="body2" color="text.secondary">
                If you lose your phone, one of these backup codes lets you in.
                Each works once. Save them somewhere safe now — they won't be
                shown again.
              </Typography>
              <BackupCodeList codes={enrolment.backupCodes} />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={saved}
                    onChange={(e) => setSaved(e.target.checked)}
                  />
                }
                label="I've saved these codes somewhere safe"
              />
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          {step < 2 ? (
            <Button
              onClick={reset}
              disabled={enable.isPending || verify.isPending}
              variant="outlined"
              color="inherit"
            >
              Cancel
            </Button>
          ) : null}
          {step === 0 ? (
            <Button
              type="submit"
              form="two-step-start"
              variant="contained"
              disabled={enable.isPending}
            >
              {enable.isPending ? "Checking…" : "Continue"}
            </Button>
          ) : null}
          {step === 1 ? (
            <Button
              type="submit"
              form="two-step-verify"
              variant="contained"
              disabled={verify.isPending}
            >
              {verify.isPending ? "Verifying…" : "Verify code"}
            </Button>
          ) : null}
          {step === 2 ? (
            <Button variant="contained" disabled={!saved} onClick={finish}>
              Done
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialog === "codes"}
        onClose={reset}
        fullWidth
        maxWidth="sm"
        aria-labelledby={`${titleId}-codes`}
      >
        <DialogTitle id={`${titleId}-codes`}>Your new backup codes</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity="warning">
              The codes you had before no longer work.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Each of these works once, if you can't reach your authenticator
              app. Save them somewhere safe now — they won't be shown again.
            </Typography>
            {freshCodes ? <BackupCodeList codes={freshCodes} /> : null}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            variant="contained"
            onClick={() => {
              reset();
              onSaved("New backup codes are ready.");
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialog === "disable"}
        onClose={disable.isPending ? undefined : reset}
        fullWidth
        maxWidth="xs"
        aria-labelledby={`${titleId}-off`}
      >
        <form onSubmit={turnOff} noValidate>
          <DialogTitle id={`${titleId}-off`}>
            Turn off two-step verification?
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Signing in with your password will no longer ask for a code.
                Confirm with your password.
              </Typography>
              <PasswordField
                autoFocus
                fullWidth
                label="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              onClick={reset}
              disabled={disable.isPending}
              variant="outlined"
              color="inherit"
            >
              Keep it on
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="error"
              disabled={disable.isPending}
            >
              {disable.isPending ? "Turning off…" : "Turn off"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </SettingsSection>
  );
}
