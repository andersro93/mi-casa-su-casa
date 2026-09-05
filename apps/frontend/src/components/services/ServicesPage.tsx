import {
  Add,
  AlternateEmailOutlined,
  DeleteOutlined,
  DriveFileRenameOutline,
  HubOutlined,
  LanguageOutlined,
  MoreVert,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { useState } from "react";
import {
  useCreateSender,
  useCreateService,
  useDeleteSender,
  useDeleteService,
  useServices,
  useUpdateSender,
  useUpdateService,
} from "../../queries/admin";
import type { ProviderConfiguration, SenderRule } from "../../types";
import { ConfirmDialog } from "../ConfirmDialog";
import { ServiceAvatar } from "../inbox/ServiceAvatar";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "../ui";
import { SenderDialog, type SenderDraft } from "./SenderDialog";
import { ServiceDialog, type ServiceDraft } from "./ServiceDialog";
import { describeSender } from "./senderRules";

interface ServicesPageProps {
  slug: string;
  householdName: string;
}

type DialogState =
  | { kind: "create-service" }
  | { kind: "rename-service"; service: ProviderConfiguration }
  | { kind: "delete-service"; service: ProviderConfiguration }
  | { kind: "add-sender"; service: ProviderConfiguration }
  | { kind: "edit-sender"; service: ProviderConfiguration; rule: SenderRule }
  | { kind: "delete-sender"; service: ProviderConfiguration; rule: SenderRule }
  | null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Owner screen: the services the household shares and which senders belong
 * to each. Everything happens on the card itself — no separate action panel.
 */
export function ServicesPage({ slug, householdName }: ServicesPageProps) {
  const servicesQuery = useServices(slug);
  const services = servicesQuery.data?.providers ?? [];
  const rules = servicesQuery.data?.rules ?? [];

  const createService = useCreateService(slug);
  const updateService = useUpdateService(slug);
  const deleteService = useDeleteService(slug);
  const createSender = useCreateSender(slug);
  const updateSender = useUpdateSender(slug);
  const deleteSender = useDeleteSender(slug);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    service: ProviderConfiguration;
  } | null>(null);

  const isSaving =
    createService.isPending ||
    updateService.isPending ||
    deleteService.isPending ||
    createSender.isPending ||
    updateSender.isPending ||
    deleteSender.isPending;

  const closeDialog = () => {
    setDialog(null);
    setDialogError(null);
  };

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    fallback: string,
  ) => {
    setDialogError(null);
    try {
      await action();
      setToast(success);
      closeDialog();
    } catch (error) {
      setDialogError(errorMessage(error, fallback));
    }
  };

  const handleServiceSubmit = (draft: ServiceDraft) => {
    if (dialog?.kind === "rename-service") {
      return run(
        () =>
          updateService.mutateAsync({
            id: dialog.service.id,
            providerKey: dialog.service.provider_key,
            displayName: draft.displayName,
          }),
        "Service renamed.",
        "Couldn't rename the service.",
      );
    }
    return run(
      async () => {
        const created = await createService.mutateAsync({
          providerKey: draft.providerKey,
          displayName: draft.displayName,
        });
        if (draft.firstSenderDomain) {
          await createSender.mutateAsync({
            providerId: created.provider.id,
            matchType: "domain",
            matchValue: draft.firstSenderDomain,
          });
        }
      },
      `${draft.displayName} added.`,
      "Couldn't add the service.",
    );
  };

  const handleSenderSubmit = (draft: SenderDraft) => {
    if (dialog?.kind === "edit-sender") {
      return run(
        () =>
          updateSender.mutateAsync({
            id: dialog.rule.id,
            providerId: dialog.service.id,
            matchType: draft.matchType,
            matchValue: draft.matchValue,
          }),
        "Sender updated.",
        "Couldn't update the sender.",
      );
    }
    if (dialog?.kind === "add-sender") {
      return run(
        () =>
          createSender.mutateAsync({
            providerId: dialog.service.id,
            matchType: draft.matchType,
            matchValue: draft.matchValue,
          }),
        `Sender added to ${dialog.service.display_name}.`,
        "Couldn't add the sender.",
      );
    }
  };

  const header = (
    <PageHeader
      eyebrow={householdName}
      title="Services"
      description="The accounts your household shares — Netflix, Spotify, the bank. Each service lists the email addresses its codes come from, so we know which emails belong to it."
      action={
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialog({ kind: "create-service" })}
        >
          Add service
        </Button>
      }
    />
  );

  let body: React.ReactNode;
  if (servicesQuery.isLoading) {
    body = <LoadingState variant="cards" rows={3} label="Loading services" />;
  } else if (servicesQuery.error) {
    body = (
      <ErrorState
        message={errorMessage(servicesQuery.error, "Couldn't load services.")}
        onRetry={() => void servicesQuery.refetch()}
      />
    );
  } else if (services.length === 0) {
    body = (
      <EmptyState
        icon={<HubOutlined />}
        title="No services yet"
        description="Add the first service your household shares — Netflix, for example — and tell us which addresses its emails come from. Codes start showing up in the inbox right away."
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialog({ kind: "create-service" })}
          >
            Add your first service
          </Button>
        }
      />
    );
  } else {
    body = (
      <Stack
        spacing={2}
        component="ul"
        sx={{ listStyle: "none", p: 0, m: 0 }}
        aria-label="Services"
      >
        {services.map((service) => {
          const senders = rules.filter(
            (rule) => rule.provider_id === service.id,
          );
          return (
            <Card key={service.id} component="li">
              <CardContent
                sx={{
                  p: { xs: 2, sm: 2.5 },
                  "&:last-child": { pb: { xs: 2, sm: 2.5 } },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center" }}
                >
                  <ServiceAvatar name={service.display_name} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="h5" component="h2" noWrap>
                      {service.display_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {senders.length === 0
                        ? "No senders yet"
                        : senders.length === 1
                          ? "1 sender"
                          : `${senders.length} senders`}
                    </Typography>
                  </Box>
                  <IconButton
                    aria-label={`Options for ${service.display_name}`}
                    onClick={(event) =>
                      setMenu({ anchor: event.currentTarget, service })
                    }
                  >
                    <MoreVert />
                  </IconButton>
                </Stack>

                <Box sx={{ mt: 2 }}>
                  {senders.length === 0 ? (
                    <Typography
                      variant="body2"
                      color="warning.main"
                      sx={{ mb: 1.5 }}
                    >
                      Until you add a sender, this service's emails end up in
                      Needs review.
                    </Typography>
                  ) : null}
                  <Stack
                    direction="row"
                    useFlexGap
                    sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
                  >
                    {senders.map((rule) => (
                      <Chip
                        key={rule.id}
                        icon={
                          rule.match_type === "domain" ? (
                            <LanguageOutlined />
                          ) : (
                            <AlternateEmailOutlined />
                          )
                        }
                        label={describeSender(rule)}
                        variant="outlined"
                        onClick={() =>
                          setDialog({ kind: "edit-sender", service, rule })
                        }
                        onDelete={() =>
                          setDialog({ kind: "delete-sender", service, rule })
                        }
                        deleteIcon={
                          <DeleteOutlined
                            aria-label={`Remove sender ${rule.match_value}`}
                          />
                        }
                        sx={{ height: 34, "& .MuiChip-label": { px: 1.25 } }}
                      />
                    ))}
                    <Button
                      size="small"
                      startIcon={<Add />}
                      onClick={() => setDialog({ kind: "add-sender", service })}
                    >
                      Add sender
                    </Button>
                  </Stack>
                </Box>
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    );
  }

  return (
    <Box>
      {header}
      {body}

      <Menu
        anchorEl={menu?.anchor ?? null}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            if (menu)
              setDialog({ kind: "rename-service", service: menu.service });
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <DriveFileRenameOutline fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Rename" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu)
              setDialog({ kind: "delete-service", service: menu.service });
            setMenu(null);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Delete service" />
        </MenuItem>
      </Menu>

      <ServiceDialog
        open={
          dialog?.kind === "create-service" || dialog?.kind === "rename-service"
        }
        mode={dialog?.kind === "rename-service" ? "rename" : "create"}
        initial={
          dialog?.kind === "rename-service"
            ? {
                displayName: dialog.service.display_name,
                providerKey: dialog.service.provider_key,
              }
            : null
        }
        existingKeys={services.map((service) => service.provider_key)}
        isSaving={isSaving}
        error={dialogError}
        onClose={closeDialog}
        onSubmit={handleServiceSubmit}
      />

      <SenderDialog
        open={dialog?.kind === "add-sender" || dialog?.kind === "edit-sender"}
        serviceName={
          dialog?.kind === "add-sender" || dialog?.kind === "edit-sender"
            ? dialog.service.display_name
            : ""
        }
        initial={
          dialog?.kind === "edit-sender"
            ? {
                matchType: dialog.rule.match_type,
                matchValue: dialog.rule.match_value,
              }
            : null
        }
        isSaving={isSaving}
        error={dialogError}
        onClose={closeDialog}
        onSubmit={handleSenderSubmit}
      />

      <ConfirmDialog
        open={dialog?.kind === "delete-service"}
        title={
          dialog?.kind === "delete-service"
            ? `Delete ${dialog.service.display_name}?`
            : ""
        }
        description="Its senders are removed too, and new emails from them will go to Needs review instead of the inbox. Messages already received stay where they are."
        confirmLabel="Delete service"
        loadingLabel="Deleting…"
        confirmColor="error"
        isLoading={deleteService.isPending}
        error={dialogError}
        onClose={closeDialog}
        onConfirm={() =>
          dialog?.kind === "delete-service"
            ? run(
                () => deleteService.mutateAsync(dialog.service.id),
                `${dialog.service.display_name} deleted.`,
                "Couldn't delete the service.",
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={dialog?.kind === "delete-sender"}
        title={
          dialog?.kind === "delete-sender"
            ? `Stop matching ${dialog.rule.match_value}?`
            : ""
        }
        description={
          dialog?.kind === "delete-sender"
            ? `New emails from ${describeSender(dialog.rule)} will no longer be filed under ${dialog.service.display_name}.`
            : ""
        }
        confirmLabel="Remove sender"
        loadingLabel="Removing…"
        confirmColor="error"
        isLoading={deleteSender.isPending}
        error={dialogError}
        onClose={closeDialog}
        onConfirm={() =>
          dialog?.kind === "delete-sender"
            ? run(
                () => deleteSender.mutateAsync(dialog.rule.id),
                "Sender removed.",
                "Couldn't remove the sender.",
              )
            : undefined
        }
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
