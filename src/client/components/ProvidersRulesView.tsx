import {
  AddCircleOutlined,
  AutoAwesomeOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  RuleFolderOutlined,
  SaveOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  FormControl,
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
import type { FormEvent } from "react";
import type {
  ProviderConfiguration,
  ProviderFormState,
  SenderRule,
  SenderRuleFormState,
} from "../types";
import { formatTimestamp } from "../utils";

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
  onCreateProvider: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateProvider: () => void;
  onDeleteProvider: () => void;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateRule: () => void;
  onDeleteRule: () => void;
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

  const providerColumns: GridColDef<ProviderConfiguration>[] = [
    {
      field: "display_name",
      headerName: "Provider",
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
          title="Provider and rule setup"
          subheader="Configure senders so codes route cleanly without owner intervention."
          titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
        />
        <Divider />
        <CardContent>
          <Alert severity="info" sx={{ mb: 3 }} icon={<LinkOutlined />}>
            Providers define the household service buckets. Sender rules attach
            exact addresses or domains to those providers so inbound
            verification emails classify automatically.
          </Alert>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Chip
              label={`${providers.length} providers`}
              color="primary"
              variant="outlined"
            />
            <Chip
              label={`${rules.length} sender rules`}
              color="secondary"
              variant="outlined"
            />
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
              Provider inventory
            </Typography>
            <Typography
              variant="h5"
              component="h2"
              sx={{ fontWeight: "bold", mb: 2 }}
            >
              Connected providers
            </Typography>
            <Box sx={{ height: 360, width: "100%" }}>
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
                  : "Choose a provider"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {providerRules.length} configured
              </Typography>
            </Box>
            <Box sx={{ height: 320, width: "100%" }}>
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
            <Box component="form" onSubmit={onCreateProvider}>
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
                title="New provider"
                subheader="Create or maintain a service bucket"
                titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
              />
              <Divider />
              <CardContent>
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
                    label="Provider key"
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
              </CardContent>
              <CardActions
                sx={{ justifyContent: "space-between", px: 3, pb: 3, pt: 0 }}
              >
                <Button
                  startIcon={<EditOutlined />}
                  onClick={onUpdateProvider}
                  disabled={isSaving || !selectedProviderId}
                >
                  Update selected
                </Button>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    color="error"
                    startIcon={<DeleteOutlined />}
                    onClick={onDeleteProvider}
                    disabled={isSaving || !selectedProviderId}
                  >
                    Delete
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveOutlined />}
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving…" : "Create provider"}
                  </Button>
                </Box>
              </CardActions>
            </Box>
          </Card>

          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <Box component="form" onSubmit={onCreateRule}>
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
                title="Rule details"
                subheader="Map incoming sender identities to the selected provider"
                titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
              />
              <Divider />
              <CardContent>
                <Stack spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="provider-rule-provider-label">
                      Provider
                    </InputLabel>
                    <Select
                      labelId="provider-rule-provider-label"
                      label="Provider"
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

                  {selectedRule && (
                    <Alert severity="success" icon={<LinkOutlined />}>
                      Editing existing rule{" "}
                      <strong>{selectedRule.match_value}</strong>.
                    </Alert>
                  )}
                </Stack>
              </CardContent>
              <CardActions
                sx={{ justifyContent: "space-between", px: 3, pb: 3, pt: 0 }}
              >
                <Button
                  startIcon={<EditOutlined />}
                  onClick={onUpdateRule}
                  disabled={isSaving || !selectedRuleId}
                >
                  Update selected
                </Button>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    color="error"
                    startIcon={<DeleteOutlined />}
                    onClick={onDeleteRule}
                    disabled={isSaving || !selectedRuleId}
                  >
                    Delete
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveOutlined />}
                    disabled={isSaving || !ruleFormState.providerId}
                  >
                    {isSaving ? "Saving…" : "Add rule"}
                  </Button>
                </Box>
              </CardActions>
            </Box>
          </Card>
        </Stack>
      </Box>
    </Box>
  );
}
