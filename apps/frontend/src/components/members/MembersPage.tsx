import {
  DeleteOutlined,
  MoreVert,
  PeopleOutlined,
  PersonAddAlt1Outlined,
  ShieldOutlined,
  TuneOutlined,
} from "@mui/icons-material";
import {
  Avatar,
  Box,
  Button,
  Card,
  IconButton,
  List,
  ListItem,
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
  useCancelInvitation,
  useChangeMemberRole,
  useCreateInvitation,
  useInvitations,
  useMembers,
  useRemoveMember,
  useResendInvitation,
  useSetMemberAccess,
} from "../../queries/members";
import type {
  InvitationDeliveryResponse,
  InvitationSummary,
  MemberSummary,
} from "../../types";
import { formatRelativeTime, stringAvatar } from "../../utils";
import { ConfirmDialog } from "../ConfirmDialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  RelativeTime,
  StatusChip,
} from "../ui";
import { AccessDialog } from "./AccessDialog";
import { InviteDialog, type InviteDraft } from "./InviteDialog";
import { InviteResultDialog } from "./InviteResultDialog";

interface MembersPageProps {
  slug: string;
  householdName: string;
  currentUserId: string | null | undefined;
}

type DialogState =
  | { kind: "invite" }
  | { kind: "access"; member: MemberSummary }
  | { kind: "role"; member: MemberSummary; role: "member" | "owner" }
  | { kind: "remove"; member: MemberSummary }
  | { kind: "cancel-invite"; invitation: InvitationSummary }
  | null;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function accessSummary(member: MemberSummary) {
  if (member.role === "owner") return "Can see everything";
  if (member.providerAccess.length === 0) return "Can't see any services yet";
  return `Can see: ${member.providerAccess.map((a) => a.displayName).join(", ")}`;
}

/** Owner screen: who is in the household, what they can see, and pending invitations. */
export function MembersPage({
  slug,
  householdName,
  currentUserId,
}: MembersPageProps) {
  const membersQuery = useMembers(slug);
  const invitationsQuery = useInvitations(slug);
  const members = membersQuery.data?.members ?? [];
  const providers = membersQuery.data?.providers ?? [];
  const pending = (invitationsQuery.data ?? []).filter(
    (i) => i.status === "pending",
  );

  const createInvitation = useCreateInvitation(slug);
  const resendInvitation = useResendInvitation(slug);
  const cancelInvitation = useCancelInvitation(slug);
  const removeMember = useRemoveMember(slug);
  const changeRole = useChangeMemberRole(slug);
  const setAccess = useSetMemberAccess(slug);

  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] =
    useState<InvitationDeliveryResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: HTMLElement;
    member: MemberSummary;
  } | null>(null);

  const closeDialog = () => {
    setDialog(null);
    setDialogError(null);
  };

  const run = async (
    action: () => Promise<unknown>,
    success: string | null,
    fallback: string,
  ) => {
    setDialogError(null);
    try {
      await action();
      if (success) setToast(success);
      closeDialog();
    } catch (error) {
      setDialogError(errorMessage(error, fallback));
    }
  };

  const handleInvite = (draft: InviteDraft) =>
    run(
      async () => {
        const result = await createInvitation.mutateAsync(draft);
        setInviteResult(result);
      },
      null,
      "Couldn't send the invitation.",
    );

  const handleResend = async (invitation: InvitationSummary) => {
    try {
      const result = await resendInvitation.mutateAsync(invitation.id);
      if (result.emailSent)
        setToast(`Invitation resent to ${invitation.email}.`);
      else setInviteResult(result);
    } catch (error) {
      setToast(errorMessage(error, "Couldn't resend the invitation."));
    }
  };

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const header = (
    <PageHeader
      eyebrow={householdName}
      title="Members"
      description="Everyone who can see your household's codes. Owners see everything and can manage services and members; members only see the services you give them."
      action={
        <Button
          variant="contained"
          startIcon={<PersonAddAlt1Outlined />}
          onClick={() => setDialog({ kind: "invite" })}
        >
          Invite someone
        </Button>
      }
    />
  );

  let body: React.ReactNode;
  if (membersQuery.isLoading) {
    body = <LoadingState variant="list" rows={3} label="Loading members" />;
  } else if (membersQuery.error) {
    body = (
      <ErrorState
        message={errorMessage(membersQuery.error, "Couldn't load members.")}
        onRetry={() => void membersQuery.refetch()}
      />
    );
  } else {
    body = (
      <Card>
        <List disablePadding aria-label="Members">
          {members.map((member, index) => {
            const isSelf = member.id === currentUserId;
            const avatar = stringAvatar(member.name || member.email);
            return (
              <ListItem
                key={member.id}
                divider={index < members.length - 1}
                sx={{
                  py: 1.5,
                  px: { xs: 2, sm: 2.5 },
                  gap: 1.5,
                  alignItems: "center",
                }}
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={`Options for ${member.name}`}
                    onClick={(event) =>
                      setMenu({ anchor: event.currentTarget, member })
                    }
                  >
                    <MoreVert />
                  </IconButton>
                }
              >
                <Avatar
                  {...avatar}
                  sx={{ ...avatar.sx, width: 40, height: 40 }}
                />
                <Box sx={{ minWidth: 0, flex: 1, pr: 5 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", minWidth: 0, flexWrap: "wrap" }}
                    useFlexGap
                  >
                    <Typography variant="subtitle1" noWrap>
                      {member.name}
                      {isSelf ? " (you)" : ""}
                    </Typography>
                    {member.role === "owner" ? (
                      <StatusChip
                        tone="info"
                        label="Owner"
                        icon={<ShieldOutlined />}
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {member.email}
                  </Typography>
                  <Typography
                    variant="body2"
                    color={
                      member.role !== "owner" &&
                      member.providerAccess.length === 0
                        ? "warning.main"
                        : "text.secondary"
                    }
                    sx={{ mt: 0.25 }}
                  >
                    {accessSummary(member)}
                  </Typography>
                </Box>
              </ListItem>
            );
          })}
        </List>
      </Card>
    );
  }

  return (
    <Box>
      {header}

      <Stack spacing={4}>
        {pending.length > 0 ? (
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              component="h2"
              sx={{ mb: 1 }}
            >
              Pending invitations
            </Typography>
            <Stack
              spacing={1.5}
              component="ul"
              sx={{ listStyle: "none", p: 0, m: 0 }}
              aria-label="Pending invitations"
            >
              {pending.map((invitation) => {
                const expired =
                  new Date(invitation.expiresAt).getTime() < Date.now();
                return (
                  <Card key={invitation.id} component="li" sx={{ p: 2 }}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.5}
                      sx={{
                        alignItems: { sm: "center" },
                        justifyContent: "space-between",
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle1" noWrap>
                          {invitation.name}{" "}
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                          >
                            · {invitation.email}
                          </Typography>
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {invitation.role === "owner" ? "Owner" : "Member"} ·
                          invited{" "}
                          <RelativeTime
                            value={invitation.createdAt}
                            component="span"
                            variant="body2"
                          />
                          {expired
                            ? " · link expired"
                            : ` · link expires ${formatRelativeTime(invitation.expiresAt).replace(" ago", "")}`}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={resendInvitation.isPending}
                          onClick={() => void handleResend(invitation)}
                        >
                          Resend
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() =>
                            setDialog({ kind: "cancel-invite", invitation })
                          }
                        >
                          Cancel invitation
                        </Button>
                      </Stack>
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        ) : null}

        <Box>
          {pending.length > 0 ? (
            <Typography
              variant="overline"
              color="text.secondary"
              component="h2"
              sx={{ mb: 1 }}
            >
              Members
            </Typography>
          ) : null}
          {body}
          {!membersQuery.isLoading &&
          !membersQuery.error &&
          members.length <= 1 &&
          pending.length === 0 ? (
            <Box sx={{ mt: 2 }}>
              <EmptyState
                icon={<PeopleOutlined />}
                title="It's just you so far"
                description="Invite the rest of the household. They get an email with a link, create an account, and see the codes for the services you pick."
                action={
                  <Button
                    variant="contained"
                    onClick={() => setDialog({ kind: "invite" })}
                  >
                    Invite someone
                  </Button>
                }
              />
            </Box>
          ) : null}
        </Box>
      </Stack>

      <Menu
        anchorEl={menu?.anchor ?? null}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {menu?.member.role !== "owner" ? (
          <MenuItem
            onClick={() => {
              if (menu) setDialog({ kind: "access", member: menu.member });
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <TuneOutlined fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Change what they can see" />
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={menu?.member.role === "owner" && ownerCount <= 1}
          onClick={() => {
            if (menu) {
              setDialog({
                kind: "role",
                member: menu.member,
                role: menu.member.role === "owner" ? "member" : "owner",
              });
            }
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <ShieldOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              menu?.member.role === "owner" ? "Make member" : "Make owner"
            }
          />
        </MenuItem>
        <MenuItem
          disabled={menu?.member.id === currentUserId}
          onClick={() => {
            if (menu) setDialog({ kind: "remove", member: menu.member });
            setMenu(null);
          }}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Remove from household" />
        </MenuItem>
      </Menu>

      <InviteDialog
        open={dialog?.kind === "invite"}
        providers={providers}
        isSaving={createInvitation.isPending}
        error={dialogError}
        onClose={closeDialog}
        onSubmit={handleInvite}
      />
      <InviteResultDialog
        result={inviteResult}
        onClose={() => setInviteResult(null)}
      />

      <AccessDialog
        open={dialog?.kind === "access"}
        member={dialog?.kind === "access" ? dialog.member : null}
        providers={providers}
        isSaving={setAccess.isPending}
        error={dialogError}
        onClose={closeDialog}
        onSave={(grant, revoke) =>
          dialog?.kind === "access"
            ? run(
                () =>
                  setAccess.mutateAsync({
                    userId: dialog.member.id,
                    grant,
                    revoke,
                  }),
                `Updated what ${dialog.member.name} can see.`,
                "Couldn't update access.",
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={dialog?.kind === "role"}
        title={
          dialog?.kind === "role"
            ? dialog.role === "owner"
              ? `Make ${dialog.member.name} an owner?`
              : `Make ${dialog.member.name} a member?`
            : ""
        }
        description={
          dialog?.kind === "role"
            ? dialog.role === "owner"
              ? "Owners see every service and can add or remove services and members — including you."
              : "They'll only see the services you give them, and can no longer manage the household."
            : ""
        }
        confirmLabel={
          dialog?.kind === "role" && dialog.role === "owner"
            ? "Make owner"
            : "Make member"
        }
        loadingLabel="Saving…"
        isLoading={changeRole.isPending}
        error={dialogError}
        onClose={closeDialog}
        onConfirm={() =>
          dialog?.kind === "role"
            ? run(
                () =>
                  changeRole.mutateAsync({
                    userId: dialog.member.id,
                    role: dialog.role,
                  }),
                `${dialog.member.name} is now ${dialog.role === "owner" ? "an owner" : "a member"}.`,
                "Couldn't change the role.",
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={dialog?.kind === "remove"}
        title={dialog?.kind === "remove" ? `Remove ${dialog.member.name}?` : ""}
        description="They lose access to this household's codes right away. You can invite them again later."
        confirmLabel="Remove"
        loadingLabel="Removing…"
        confirmColor="error"
        isLoading={removeMember.isPending}
        error={dialogError}
        onClose={closeDialog}
        onConfirm={() =>
          dialog?.kind === "remove"
            ? run(
                () => removeMember.mutateAsync(dialog.member.id),
                `${dialog.member.name} removed.`,
                "Couldn't remove the member.",
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={dialog?.kind === "cancel-invite"}
        title={
          dialog?.kind === "cancel-invite"
            ? `Cancel the invitation for ${dialog.invitation.name}?`
            : ""
        }
        description="The link they received will stop working. You can invite them again any time."
        confirmLabel="Cancel invitation"
        cancelLabel="Keep it"
        loadingLabel="Cancelling…"
        confirmColor="error"
        isLoading={cancelInvitation.isPending}
        error={dialogError}
        onClose={closeDialog}
        onConfirm={() =>
          dialog?.kind === "cancel-invite"
            ? run(
                () => cancelInvitation.mutateAsync(dialog.invitation.id),
                "Invitation cancelled.",
                "Couldn't cancel the invitation.",
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
