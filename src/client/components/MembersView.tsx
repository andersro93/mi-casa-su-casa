import {
  AdminPanelSettingsOutlined,
  ChevronRightOutlined,
  EmailOutlined,
  GroupOutlined,
  KeyOutlined,
  PersonAddOutlined,
  ShieldOutlined,
  VpnKeyOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { type FormEvent } from "react";
import type {
  InvitationFormState,
  InvitationSummary,
  MemberFormState,
  MemberSummary,
  ProviderOption,
} from "../types";

interface MembersViewProps {
  members: MemberSummary[];
  invitations: InvitationSummary[];
  providerOptions: ProviderOption[];
  selectedMemberId: string | null;
  onSelectMember: (id: string) => void;
  isLoadingMembers: boolean;
  memberFormState: MemberFormState;
  onMemberFormChange: (update: Partial<MemberFormState>) => void;
  onCreateMember: (e: FormEvent<HTMLFormElement>) => void;
  isSavingMember: boolean;
  invitationFormState: InvitationFormState;
  onInvitationFormChange: (update: Partial<InvitationFormState>) => void;
  onCreateInvitation: (e: FormEvent<HTMLFormElement>) => void;
  onResendInvitation: (invitationId: string) => void;
  onCancelInvitation: (invitationId: string) => void;
  isSavingInvitation: boolean;
  onRoleChange: (userId: string, role: MemberSummary["role"]) => void;
  onProviderAccessToggle: (
    userId: string,
    providerKey: string,
    hasAccess: boolean,
  ) => void;
}

const avatarColors = [
  "#6366F1", // Indigo
  "#8B5CF6", // Violet
  "#A855F7", // Purple
  "#EC4899", // Fuchsia
  "#3B82F6", // Blue
  "#0EA5E9", // Light Blue
  "#14B8A6", // Sky
  "#06B6D4", // Cyan
];

function stringToColor(string: string) {
  let hash = 0;
  for (let i = 0; i < string.length; i += 1) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function stringAvatar(name: string) {
  const safeName = name || "?";
  const parts = safeName.split(" ");
  const initials =
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : safeName[0];

  return {
    sx: {
      bgcolor: stringToColor(safeName),
      color: "#fff",
      fontWeight: "bold",
    },
    children: initials.toUpperCase(),
  };
}

export function MembersView({
  members,
  invitations,
  providerOptions,
  selectedMemberId,
  onSelectMember,
  isLoadingMembers,
  memberFormState,
  onMemberFormChange,
  onCreateMember,
  isSavingMember,
  invitationFormState,
  onInvitationFormChange,
  onCreateInvitation,
  onResendInvitation,
  onCancelInvitation,
  isSavingInvitation,
  onRoleChange,
  onProviderAccessToggle,
}: MembersViewProps) {
  const selectedMember = members.find((m) => m.id === selectedMemberId);

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}
    >
      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "divider" }}>
        <Box component="form" onSubmit={onCreateMember}>
          <CardHeader
            avatar={
              <Avatar
                sx={{ bgcolor: "primary.light", color: "primary.contrastText" }}
              >
                <PersonAddOutlined />
              </Avatar>
            }
            title="Create a household member"
            subheader="Invite-only onboarding"
            titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
          />
          <Divider />
          <CardContent>
            <Alert severity="info" sx={{ mb: 3 }} icon={<KeyOutlined />}>
              Provision a member directly, then share the generated login
              details privately with them.
            </Alert>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", md: "row" },
                gap: 2,
                alignItems: "flex-start",
              }}
            >
              <TextField
                label="Name"
                size="small"
                value={memberFormState.name}
                onChange={(e) => onMemberFormChange({ name: e.target.value })}
                required
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                size="small"
                value={memberFormState.email}
                onChange={(e) => onMemberFormChange({ email: e.target.value })}
                required
                fullWidth
              />
              <TextField
                label="Temporary password"
                type="password"
                size="small"
                value={memberFormState.password}
                onChange={(e) =>
                  onMemberFormChange({ password: e.target.value })
                }
                slotProps={{ htmlInput: { minLength: 12 } }}
                required
                fullWidth
              />
              <FormControl size="small" fullWidth>
                <InputLabel id="role-select-label">Role</InputLabel>
                <Select
                  labelId="role-select-label"
                  value={memberFormState.role}
                  label="Role"
                  onChange={(e) =>
                    onMemberFormChange({
                      role: e.target.value as "member" | "admin",
                    })
                  }
                >
                  <MenuItem value="member">Member</MenuItem>
                  <MenuItem value="admin">Owner</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </CardContent>
          <CardActions sx={{ justifyContent: "flex-end", px: 3, pb: 3, pt: 0 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={isSavingMember}
              sx={{ minWidth: 160 }}
            >
              {isSavingMember ? "Creating…" : "Create member"}
            </Button>
          </CardActions>
        </Box>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "divider" }}>
        <Box component="form" onSubmit={onCreateInvitation}>
          <CardHeader
            avatar={
              <Avatar
                sx={{
                  bgcolor: "secondary.light",
                  color: "secondary.contrastText",
                }}
              >
                <EmailOutlined />
              </Avatar>
            }
            title="Invite a household member"
            subheader="Send a secure invite link by email"
            titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
          />
          <Divider />
          <CardContent>
            <Alert severity="info" sx={{ mb: 3 }} icon={<PersonAddOutlined />}>
              Invitations let members choose their own password and immediately
              receive provider access once accepted.
            </Alert>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", md: "row" },
                  gap: 2,
                  alignItems: "flex-start",
                }}
              >
                <TextField
                  label="Name"
                  size="small"
                  value={invitationFormState.name}
                  onChange={(e) =>
                    onInvitationFormChange({ name: e.target.value })
                  }
                  required
                  fullWidth
                />
                <TextField
                  label="Email"
                  type="email"
                  size="small"
                  value={invitationFormState.email}
                  onChange={(e) =>
                    onInvitationFormChange({ email: e.target.value })
                  }
                  required
                  fullWidth
                />
                <FormControl size="small" fullWidth>
                  <InputLabel id="invite-role-select-label">Role</InputLabel>
                  <Select
                    labelId="invite-role-select-label"
                    value={invitationFormState.role}
                    label="Role"
                    onChange={(e) =>
                      onInvitationFormChange({
                        role: e.target.value as "member" | "admin",
                      })
                    }
                  >
                    <MenuItem value="member">Member</MenuItem>
                    <MenuItem value="admin">Owner</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <FormControl size="small" fullWidth>
                <InputLabel id="invite-providers-select-label">
                  Provider Access
                </InputLabel>
                <Select
                  labelId="invite-providers-select-label"
                  multiple
                  value={invitationFormState.providerIds}
                  label="Provider Access"
                  onChange={(e) =>
                    onInvitationFormChange({
                      providerIds: e.target.value as string[],
                    })
                  }
                  renderValue={(selected) => {
                    const providerIds = selected as string[];

                    if (!providerIds.length) {
                      return "No provider access yet";
                    }

                    return providerOptions
                      .filter((provider) => providerIds.includes(provider.id))
                      .map((provider) => provider.display_name)
                      .join(", ");
                  }}
                >
                  {providerOptions.map((provider) => (
                    <MenuItem key={provider.id} value={provider.id}>
                      {provider.display_name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </CardContent>
          <CardActions sx={{ justifyContent: "flex-end", px: 3, pb: 3, pt: 0 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={
                isSavingInvitation ||
                !invitationFormState.name.trim() ||
                !invitationFormState.email.trim()
              }
              sx={{ minWidth: 160 }}
            >
              {isSavingInvitation ? "Sending…" : "Send invitation"}
            </Button>
          </CardActions>
        </Box>
      </Card>

      <Card variant="outlined" sx={{ borderRadius: 2, borderColor: "divider" }}>
        <CardHeader
          avatar={
            <Avatar sx={{ bgcolor: "info.light", color: "info.contrastText" }}>
              <EmailOutlined />
            </Avatar>
          }
          title="Pending and recent invitations"
          subheader="Track invitation status and resend or cancel pending links"
          titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
        />
        <Divider />
        <CardContent>
          {invitations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No invitations yet.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {invitations.map((invitation) => {
                const isPending = invitation.status === "pending";

                return (
                  <Card
                    key={invitation.id}
                    variant="outlined"
                    sx={{ borderRadius: 2 }}
                  >
                    <CardContent
                      sx={{
                        display: "flex",
                        flexDirection: { xs: "column", md: "row" },
                        gap: 2,
                        justifyContent: "space-between",
                        alignItems: { xs: "flex-start", md: "center" },
                      }}
                    >
                      <Box>
                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: "bold" }}
                        >
                          {invitation.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {invitation.email}
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            gap: 1,
                            flexWrap: "wrap",
                            mt: 1.5,
                          }}
                        >
                          <Chip
                            size="small"
                            label={
                              invitation.role === "admin" ? "Owner" : "Member"
                            }
                            color={
                              invitation.role === "admin"
                                ? "primary"
                                : "default"
                            }
                          />
                          <Chip
                            size="small"
                            label={invitation.status}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                            variant="outlined"
                          />
                        </Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 1.5 }}
                        >
                          Providers:{" "}
                          {invitation.providers.length
                            ? invitation.providers
                                .map((provider) => provider.display_name)
                                .join(", ")
                            : "No provider access selected"}
                        </Typography>
                      </Box>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        <Button
                          variant="outlined"
                          disabled={!isPending || isSavingInvitation}
                          onClick={() => onResendInvitation(invitation.id)}
                        >
                          Resend
                        </Button>
                        <Button
                          color="error"
                          variant="text"
                          disabled={!isPending || isSavingInvitation}
                          onClick={() => onCancelInvitation(invitation.id)}
                        >
                          Cancel
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: 3,
          flexGrow: 1,
          minHeight: 0,
          alignItems: "flex-start",
        }}
      >
        <TableContainer
          component={Card}
          variant="outlined"
          sx={{
            flexGrow: 1,
            borderRadius: 2,
            minWidth: 0,
            overflowX: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Table sx={{ minWidth: 500 }} aria-label="members table">
            <TableHead sx={{ bgcolor: "background.default" }}>
              <TableRow>
                <TableCell sx={{ fontWeight: "bold", color: "text.secondary" }}>
                  Member
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    color: "text.secondary",
                    display: { xs: "none", sm: "table-cell" },
                  }}
                >
                  Email
                </TableCell>
                <TableCell sx={{ fontWeight: "bold", color: "text.secondary" }}>
                  Role
                </TableCell>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    color: "text.secondary",
                    display: { xs: "none", md: "table-cell" },
                  }}
                >
                  Provider Access
                </TableCell>
                <TableCell
                  align="right"
                  sx={{ fontWeight: "bold", color: "text.secondary" }}
                >
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => {
                const isSelected = member.id === selectedMemberId;

                return (
                  <TableRow
                    key={member.id}
                    hover
                    selected={isSelected}
                    onClick={() => onSelectMember(member.id)}
                    sx={{
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                      "&.Mui-selected": {
                        bgcolor: "action.selected",
                        "&:hover": { bgcolor: "action.hover" },
                      },
                    }}
                  >
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 2 }}
                      >
                        <Badge
                          overlap="circular"
                          anchorOrigin={{
                            vertical: "bottom",
                            horizontal: "right",
                          }}
                          badgeContent={
                            member.role === "admin" ? (
                              <Tooltip title="Household Owner" placement="top">
                                <AdminPanelSettingsOutlined
                                  sx={{
                                    fontSize: 16,
                                    color: "primary.main",
                                    bgcolor: "background.paper",
                                    borderRadius: "50%",
                                  }}
                                />
                              </Tooltip>
                            ) : null
                          }
                        >
                          <Avatar {...stringAvatar(member.name)} />
                        </Badge>
                        <Typography
                          variant="subtitle2"
                          sx={{
                            fontWeight: isSelected ? "bold" : "medium",
                            color: isSelected ? "primary.main" : "text.primary",
                          }}
                        >
                          {member.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", sm: "table-cell" } }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {member.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={member.role === "admin" ? "Owner" : "Member"}
                        color={member.role === "admin" ? "primary" : "default"}
                        size="small"
                        sx={{ fontWeight: "bold" }}
                      />
                    </TableCell>
                    <TableCell
                      sx={{ display: { xs: "none", md: "table-cell" } }}
                    >
                      <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                        {member.providerAccess.slice(0, 2).map((access) => (
                          <Chip
                            key={access.providerKey}
                            label={access.displayName}
                            size="small"
                            variant="outlined"
                          />
                        ))}
                        {member.providerAccess.length > 2 && (
                          <Chip
                            label={`+${member.providerAccess.length - 2}`}
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {member.providerAccess.length === 0 && (
                          <Typography variant="body2" color="text.disabled">
                            None
                          </Typography>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        color={isSelected ? "primary" : "default"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectMember(member.id);
                        }}
                      >
                        <ChevronRightOutlined />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}

              {!members.length && !isLoadingMembers && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ borderBottom: "none", py: 8 }}>
                    <Box sx={{ textAlign: "center" }}>
                      <GroupOutlined
                        sx={{ fontSize: 48, color: "text.disabled", mb: 2 }}
                      />
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: "bold" }}
                        gutterBottom
                      >
                        No members yet
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Create the first invited household member to get
                        started.
                      </Typography>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {selectedMember && (
          <Card
            variant="outlined"
            sx={{
              width: { xs: "100%", md: 400 },
              flexShrink: 0,
              borderRadius: 2,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CardHeader
              avatar={
                <Avatar
                  {...stringAvatar(selectedMember.name)}
                  sx={{
                    width: 56,
                    height: 56,
                    fontSize: "1.25rem",
                    ...stringAvatar(selectedMember.name).sx,
                  }}
                />
              }
              title={selectedMember.name}
              subheader={
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mt: 0.5,
                  }}
                >
                  <EmailOutlined sx={{ fontSize: 16 }} />
                  {selectedMember.email}
                </Box>
              }
              titleTypographyProps={{ variant: "h6", fontWeight: "bold" }}
              subheaderTypographyProps={{
                variant: "body2",
                color: "text.secondary",
              }}
              action={
                <Tooltip title="Send email">
                  <IconButton
                    href={`mailto:${selectedMember.email}`}
                    color="primary"
                  >
                    <EmailOutlined />
                  </IconButton>
                </Tooltip>
              }
              sx={{ p: 3 }}
            />
            <Divider />
            <CardContent
              sx={{
                p: 3,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <Box>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 2,
                  }}
                >
                  <ShieldOutlined fontSize="small" />
                  Role & Permissions
                </Typography>
                <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Owners can invite members and configure provider access.
                  </Typography>
                  <FormControl fullWidth size="small">
                    <InputLabel id="role-change-label">
                      Household Role
                    </InputLabel>
                    <Select
                      labelId="role-change-label"
                      value={selectedMember.role}
                      label="Household Role"
                      onChange={(e) =>
                        onRoleChange(
                          selectedMember.id,
                          e.target.value as "admin" | "member",
                        )
                      }
                    >
                      <MenuItem value="member">Member</MenuItem>
                      <MenuItem value="admin">Owner</MenuItem>
                    </Select>
                  </FormControl>
                </Card>
              </Box>

              <Box>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 2,
                  }}
                >
                  <VpnKeyOutlined fontSize="small" />
                  Provider Access
                </Typography>
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <List disablePadding>
                    {providerOptions.map((provider, i) => {
                      const hasAccess = selectedMember.providerAccess.some(
                        (access) =>
                          access.providerKey === provider.provider_key,
                      );

                      return (
                        <React.Fragment key={provider.id}>
                          {i > 0 && <Divider />}
                          <ListItem sx={{ p: 2 }}>
                            <ListItemText
                              disableTypography
                              primary={
                                <Typography
                                  variant="subtitle2"
                                  sx={{ fontWeight: "bold" }}
                                >
                                  {provider.display_name}
                                </Typography>
                              }
                              secondary={
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{ mt: 0.5 }}
                                >
                                  {hasAccess ? "Access granted" : "No access"}
                                </Typography>
                              }
                            />
                            <Tooltip
                              title={
                                hasAccess ? "Revoke access" : "Grant access"
                              }
                            >
                              <Switch
                                checked={hasAccess}
                                onChange={(e) =>
                                  onProviderAccessToggle(
                                    selectedMember.id,
                                    provider.provider_key,
                                    e.target.checked,
                                  )
                                }
                                color="primary"
                              />
                            </Tooltip>
                          </ListItem>
                        </React.Fragment>
                      );
                    })}
                    {!providerOptions.length && (
                      <ListItem sx={{ p: 3, justifyContent: "center" }}>
                        <Typography variant="body2" color="text.disabled">
                          No providers configured yet.
                        </Typography>
                      </ListItem>
                    )}
                  </List>
                </Card>
              </Box>
            </CardContent>
          </Card>
        )}
      </Box>
    </Box>
  );
}
