import {
  AddCircleOutlined,
  AutoAwesomeOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  RuleFolderOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
  type GridRowParams,
  type GridRowSelectionModel,
} from "@mui/x-data-grid";
import { type FormEvent, useState } from "react";
import type {
  ProviderConfiguration,
  ProviderFormState,
  SenderRule,
  SenderRuleFormState,
} from "../types";
import { formatTimestamp } from "../utils";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProvidersRulesViewProps {
  providers: ProviderConfiguration[];
  rules: SenderRule[];
  selectedProviderId: string | null;
  selectedRuleId: string | null;
  providerFormState: ProviderFormState;
  ruleFormState: SenderRuleFormState;
  isSaving: boolean;
  onSelectProvider: (providerId: string) => void;
  onSelectRule: (ruleId: string) => void;
  onProviderFormChange: (update: Partial<ProviderFormState>) => void;
  onRuleFormChange: (update: Partial<SenderRuleFormState>) => void;
  onCreateProvider: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onUpdateProvider: () => Promise<boolean>;
  onDeleteProvider: () => Promise<boolean>;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onUpdateRule: () => Promise<boolean>;
  onDeleteRule: () => Promise<boolean>;
}

export function ProvidersRulesView({
  providers,
  rules,
  selectedProviderId,
  selectedRuleId,
  providerFormState,
  ruleFormState,
  isSaving,
  onSelectProvider,
  onSelectRule,
  onProviderFormChange,
  onRuleFormChange,
  onCreateProvider,
  onUpdateProvider,
  onDeleteProvider,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
}: ProvidersRulesViewProps) {
  const selectedProvider =
    providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) ?? null;
  const providerRules = rules.filter(
    (rule) => rule.provider_id === selectedProviderId,
  );
  const [providerDialogMode, setProviderDialogMode] = useState<
    "create" | "edit" | null
  >(null);
  const [ruleDialogMode, setRuleDialogMode] = useState<
    "create" | "edit" | null
  >(null);
  const [isDeleteProviderOpen, setIsDeleteProviderOpen] = useState(false);
  const [isDeleteRuleOpen, setIsDeleteRuleOpen] = useState(false);

  const resetProviderDraft = () => {
    onProviderFormChange({
      displayName: "",
      providerKey: "",
    });
  };

  const resetRuleDraft = () => {
    onRuleFormChange({
      providerId: selectedProviderId ?? "",
      matchType: "domain",
      matchValue: "",
    });
  };

  const handleOpenCreateProvider = () => {
    resetProviderDraft();
    setProviderDialogMode("create");
  };

  const handleOpenEditProvider = () => {
    if (!selectedProvider) {
      return;
    }

    onProviderFormChange({
      displayName: selectedProvider.display_name,
      providerKey: selectedProvider.provider_key,
    });
    setProviderDialogMode("edit");
  };

  const handleOpenCreateRule = () => {
    resetRuleDraft();
    setRuleDialogMode("create");
  };

  const handleOpenEditRule = () => {
    if (!selectedRule) {
      return;
    }

    onRuleFormChange({
      providerId: selectedRule.provider_id,
      matchType: selectedRule.match_type,
      matchValue: selectedRule.match_value,
    });
    setRuleDialogMode("edit");
  };

  const handleProviderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const didSave =
      providerDialogMode === "edit"
        ? await onUpdateProvider()
        : await onCreateProvider(event);

    if (didSave) {
      setProviderDialogMode(null);
    }
  };

  const handleRuleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const didSave =
      ruleDialogMode === "edit"
        ? await onUpdateRule()
        : await onCreateRule(event);

    if (didSave) {
      setRuleDialogMode(null);
    }
  };

  const handleDeleteProviderConfirm = async () => {
    const didDelete = await onDeleteProvider();

    if (didDelete) {
      setIsDeleteProviderOpen(false);
      setProviderDialogMode(null);
    }
  };

  const handleDeleteRuleConfirm = async () => {
    const didDelete = await onDeleteRule();

    if (didDelete) {
      setIsDeleteRuleOpen(false);
      setRuleDialogMode(null);
    }
  };

  const providerColumns: GridColDef<ProviderConfiguration>[] = [
    {
      field: "display_name",
      headerName: "Inbox",
      flex: 1,
      minWidth: 180,
    },
    {
      field: "provider_key",
      headerName: "Key",
      flex: 1,
      minWidth: 160,
    },
    {
      field: "rule_count",
      headerName: "Rules",
      width: 100,
      type: "number",
    },
    {
      field: "created_at",
      headerName: "Created",
      minWidth: 180,
      flex: 1,
      renderCell: ({ row }: GridRenderCellParams<ProviderConfiguration>) =>
        formatTimestamp(row.created_at),
    },
  ];

  const ruleColumns: GridColDef<SenderRule>[] = [
    {
      field: "match_type",
      headerName: "Type",
      width: 120,
      renderCell: ({ value }: GridRenderCellParams<SenderRule, string>) => (
        <Chip
          size="small"
          label={value === "domain" ? "Domain" : "Exact"}
          color={value === "domain" ? "secondary" : "primary"}
          variant="outlined"
        />
      ),
    },
    {
      field: "match_value",
      headerName: "Match value",
      flex: 1,
      minWidth: 220,
    },
    {
      field: "created_at",
      headerName: "Created",
      minWidth: 180,
      flex: 1,
      renderCell: ({ row }: GridRenderCellParams<SenderRule>) =>
        formatTimestamp(row.created_at),
    },
  ];

  const providerSelectionModel: GridRowSelectionModel = {
    type: "include",
    ids: new Set(selectedProviderId ? [selectedProviderId] : []),
  };

  const ruleSelectionModel: GridRowSelectionModel = {
    type: "include",
    ids: new Set(selectedRuleId ? [selectedRuleId] : []),
  };

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}
    >
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "divider" }}>
        <CardHeader
          avatar={
            <Avatar
              sx={{ bgcolor: "primary.light", color: "primary.contrastText" }}
            >
              <AutoAwesomeOutlined />
            </Avatar>
          }
          title="Inbox and rule setup"
          subheader="Configure inboxes so codes route cleanly without owner intervention."
          slotProps={{
            title: { variant: "h6", fontWeight: "bold" },
          }}
        />
        <Divider />
        <CardContent>
          <Alert severity="info" sx={{ mb: 3 }} icon={<LinkOutlined />}>
            Inboxes define the household service buckets. Sender rules attach
            exact addresses or domains to those inboxes so inbound
            verification emails classify automatically.
          </Alert>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Chip
                label={`${providers.length} inboxes`}
                color="primary"
                variant="outlined"
              />
              <Chip
                label={`${rules.length} sender rules`}
                color="secondary"
                variant="outlined"
              />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Button
                variant="contained"
                startIcon={<AddCircleOutlined />}
                onClick={handleOpenCreateProvider}
              >
                Create inbox
              </Button>
              <Button
                variant="outlined"
                startIcon={<RuleFolderOutlined />}
                onClick={handleOpenCreateRule}
                disabled={!providers.length}
              >
                Add rule
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            xl: "minmax(0, 1.5fr) minmax(340px, 0.9fr)",
          },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Stack spacing={3} sx={{ minWidth: 0 }}>
          <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: "bold" }}
            >
              Inbox inventory
            </Typography>
            <Typography
              variant="h5"
              component="h2"
              sx={{ fontWeight: "bold", mb: 2 }}
            >
              Connected inboxes
            </Typography>
            <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" } }}>
              {providers.map((provider) => {
                const isSelected = provider.id === selectedProviderId;

                return (
                  <Card
                    key={provider.id}
                    variant="outlined"
                    onClick={() => onSelectProvider(provider.id)}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 2,
                      borderColor: isSelected ? "primary.main" : "divider",
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack spacing={1.5}>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 2,
                            alignItems: "flex-start",
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="subtitle1"
                              sx={{ fontWeight: "bold" }}
                            >
                              {provider.display_name}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ wordBreak: "break-word" }}
                            >
                              {provider.provider_key}
                            </Typography>
                          </Box>
                          <Chip
                            label={`${provider.rule_count} rules`}
                            size="small"
                          />
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                          Created {formatTimestamp(provider.created_at)}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
              {!providers.length && (
                <Alert severity="info">No inboxes configured yet.</Alert>
              )}
            </Stack>
            <Box
              sx={{
                height: 360,
                width: "100%",
                display: { xs: "none", md: "block" },
              }}
            >
              <DataGrid
                rows={providers}
                columns={providerColumns}
                pageSizeOptions={[5, 10, 25]}
                initialState={{
                  pagination: { paginationModel: { pageSize: 5 } },
                }}
                disableRowSelectionOnClick
                onRowClick={(params: GridRowParams<ProviderConfiguration>) =>
                  onSelectProvider(String(params.row.id))
                }
                rowSelectionModel={providerSelectionModel}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ fontWeight: "bold" }}
            >
              Sender rules
            </Typography>
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                mb: 2,
              }}
            >
              <Typography
                variant="h5"
                component="h2"
                sx={{ fontWeight: "bold" }}
              >
                {selectedProvider
                  ? `${selectedProvider.display_name} rules`
                  : "Choose an inbox"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {providerRules.length} configured
              </Typography>
            </Box>
            <Stack spacing={1.5} sx={{ display: { xs: "flex", md: "none" } }}>
              {providerRules.map((rule) => {
                const isSelected = rule.id === selectedRuleId;

                return (
                  <Card
                    key={rule.id}
                    variant="outlined"
                    onClick={() => onSelectRule(rule.id)}
                    sx={{
                      cursor: "pointer",
                      borderRadius: 2,
                      borderColor: isSelected ? "primary.main" : "divider",
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack spacing={1.5}>
                        <Box
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 2,
                            alignItems: "flex-start",
                          }}
                        >
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="subtitle1"
                              sx={{
                                fontWeight: "bold",
                                wordBreak: "break-word",
                              }}
                            >
                              {rule.match_value}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Created {formatTimestamp(rule.created_at)}
                            </Typography>
                          </Box>
                          <Chip
                            size="small"
                            label={
                              rule.match_type === "domain" ? "Domain" : "Exact"
                            }
                            color={
                              rule.match_type === "domain"
                                ? "secondary"
                                : "primary"
                            }
                            variant="outlined"
                          />
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
              {!providerRules.length && (
                <Alert severity="info">
                  {selectedProvider
                    ? "No sender rules configured yet for this inbox."
                    : "Choose an inbox to view its rules."}
                </Alert>
              )}
            </Stack>
            <Box
              sx={{
                height: 320,
                width: "100%",
                display: { xs: "none", md: "block" },
              }}
            >
              <DataGrid
                rows={providerRules}
                columns={ruleColumns}
                pageSizeOptions={[5, 10]}
                initialState={{
                  pagination: { paginationModel: { pageSize: 5 } },
                }}
                disableRowSelectionOnClick
                onRowClick={(params: GridRowParams<SenderRule>) =>
                  onSelectRule(String(params.row.id))
                }
                rowSelectionModel={ruleSelectionModel}
              />
            </Box>
          </Paper>
        </Stack>

        <Stack spacing={3}>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardHeader
              avatar={
                <Avatar
                  sx={{
                    bgcolor: "secondary.light",
                    color: "secondary.contrastText",
                  }}
                >
                  <AddCircleOutlined />
                </Avatar>
              }
              title="Inbox actions"
              subheader="Open a dialog to create, update, or delete a selected inbox"
              slotProps={{
                title: { variant: "h6", fontWeight: "bold" },
              }}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Select an inbox from the inventory, then open the focused
                  edit flow when you need to make changes.
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={<AddCircleOutlined />}
                    onClick={handleOpenCreateProvider}
                  >
                    Create inbox
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<EditOutlined />}
                    onClick={handleOpenEditProvider}
                    disabled={!selectedProviderId}
                  >
                    Edit selected
                  </Button>
                  <Button
                    color="error"
                    variant="text"
                    startIcon={<DeleteOutlined />}
                    onClick={() => setIsDeleteProviderOpen(true)}
                    disabled={!selectedProviderId || isSaving}
                  >
                    Delete
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardHeader
              avatar={
                <Avatar
                  sx={{
                    bgcolor: "warning.main",
                    color: "warning.contrastText",
                  }}
                >
                  <RuleFolderOutlined />
                </Avatar>
              }
              title="Rule actions"
              subheader="Create or refine sender mapping rules without losing grid context"
              slotProps={{
                title: { variant: "h6", fontWeight: "bold" },
              }}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Rules stay tied to the selected inbox, but the editor opens
                  separately so the inventory remains easy to scan.
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={<RuleFolderOutlined />}
                    onClick={handleOpenCreateRule}
                    disabled={!providers.length}
                  >
                    Add rule
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<EditOutlined />}
                    onClick={handleOpenEditRule}
                    disabled={!selectedRuleId}
                  >
                    Edit selected
                  </Button>
                  <Button
                    color="error"
                    variant="text"
                    startIcon={<DeleteOutlined />}
                    onClick={() => setIsDeleteRuleOpen(true)}
                    disabled={!selectedRuleId || isSaving}
                  >
                    Delete
                  </Button>
                </Stack>
                {selectedRule && (
                  <Alert severity="success" icon={<LinkOutlined />}>
                    Selected rule <strong>{selectedRule.match_value}</strong> is
                    ready to edit.
                  </Alert>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Box>

      <Dialog
        open={providerDialogMode !== null}
        onClose={isSaving ? undefined : () => setProviderDialogMode(null)}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleProviderSubmit}>
          <DialogTitle sx={{ pr: 7 }}>
            {providerDialogMode === "edit"
              ? "Edit inbox"
              : "Create inbox"}
          </DialogTitle>
          <IconButton
            aria-label="Close inbox dialog"
            onClick={() => setProviderDialogMode(null)}
            disabled={isSaving}
            sx={{ position: "absolute", top: 12, right: 12 }}
          >
            <CloseOutlined />
          </IconButton>
          <DialogContent dividers>
            <Stack spacing={3}>
              <Alert severity="info" icon={<LinkOutlined />}>
                Inboxes define the household service buckets used by inbox and
                access controls.
              </Alert>
              <Stack spacing={2}>
                <TextField
                  label="Display name"
                  size="small"
                  value={providerFormState.displayName}
                  onChange={(event) =>
                    onProviderFormChange({ displayName: event.target.value })
                  }
                  required
                  fullWidth
                />
                <TextField
                  label="Inbox key"
                  size="small"
                  helperText="Lowercase identifier used in routing and access control"
                  value={providerFormState.providerKey}
                  onChange={(event) =>
                    onProviderFormChange({ providerKey: event.target.value })
                  }
                  required
                  fullWidth
                />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button
              onClick={() => setProviderDialogMode(null)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={isSaving}>
              {isSaving
                ? "Saving…"
                : providerDialogMode === "edit"
                  ? "Save inbox"
                  : "Create inbox"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog
        open={ruleDialogMode !== null}
        onClose={isSaving ? undefined : () => setRuleDialogMode(null)}
        fullWidth
        maxWidth="sm"
      >
        <Box component="form" onSubmit={handleRuleSubmit}>
          <DialogTitle sx={{ pr: 7 }}>
            {ruleDialogMode === "edit" ? "Edit sender rule" : "Add sender rule"}
          </DialogTitle>
          <IconButton
            aria-label="Close rule dialog"
            onClick={() => setRuleDialogMode(null)}
            disabled={isSaving}
            sx={{ position: "absolute", top: 12, right: 12 }}
          >
            <CloseOutlined />
          </IconButton>
          <DialogContent dividers>
            <Stack spacing={3}>
              <Alert severity="info" icon={<RuleFolderOutlined />}>
                Match exact senders or domains to the inbox that should own
                incoming verification messages.
              </Alert>
              <Stack spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="provider-rule-provider-label">
                    Inbox
                  </InputLabel>
                  <Select
                    labelId="provider-rule-provider-label"
                    label="Inbox"
                    value={ruleFormState.providerId}
                    onChange={(event) =>
                      onRuleFormChange({
                        providerId: String(event.target.value),
                      })
                    }
                  >
                    {providers.map((provider) => (
                      <MenuItem key={provider.id} value={provider.id}>
                        {provider.display_name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel id="provider-rule-type-label">
                    Match type
                  </InputLabel>
                  <Select
                    labelId="provider-rule-type-label"
                    label="Match type"
                    value={ruleFormState.matchType}
                    onChange={(event) =>
                      onRuleFormChange({
                        matchType: event.target
                          .value as SenderRuleFormState["matchType"],
                      })
                    }
                  >
                    <MenuItem value="domain">Domain</MenuItem>
                    <MenuItem value="exact">Exact sender</MenuItem>
                  </Select>
                </FormControl>

                <TextField
                  label={
                    ruleFormState.matchType === "domain"
                      ? "Domain"
                      : "Exact sender address"
                  }
                  size="small"
                  helperText={
                    ruleFormState.matchType === "domain"
                      ? "Example: netflix.com"
                      : "Example: login@netflix.com"
                  }
                  value={ruleFormState.matchValue}
                  onChange={(event) =>
                    onRuleFormChange({ matchValue: event.target.value })
                  }
                  required
                  fullWidth
                />
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={() => setRuleDialogMode(null)} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSaving || !ruleFormState.providerId}
            >
              {isSaving
                ? "Saving…"
                : ruleDialogMode === "edit"
                  ? "Save rule"
                  : "Add rule"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={isDeleteProviderOpen}
        title="Delete inbox?"
        description={
          selectedProvider ? (
            <Typography variant="body2" color="text.secondary">
              <strong>{selectedProvider.display_name}</strong> and its sender
              rules will be removed from routing and member access management.
            </Typography>
          ) : (
            ""
          )
        }
        confirmLabel="Delete inbox"
        confirmColor="error"
        isLoading={isSaving}
        onClose={() => setIsDeleteProviderOpen(false)}
        onConfirm={handleDeleteProviderConfirm}
      />

      <ConfirmDialog
        open={isDeleteRuleOpen}
        title="Delete sender rule?"
        description={
          selectedRule ? (
            <Typography variant="body2" color="text.secondary">
              Rule <strong>{selectedRule.match_value}</strong> will stop routing
              senders to this inbox.
            </Typography>
          ) : (
            ""
          )
        }
        confirmLabel="Delete rule"
        confirmColor="error"
        isLoading={isSaving}
        onClose={() => setIsDeleteRuleOpen(false)}
        onConfirm={handleDeleteRuleConfirm}
      />
    </Box>
  );
}
