import {
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { type FormEvent } from "react";
import type { MemberFormState, MemberSummary, ProviderOption } from "../types";

interface MembersViewProps {
  members: MemberSummary[];
  providerOptions: ProviderOption[];
  selectedMemberId: string | null;
  onSelectMember: (id: string) => void;
  isLoadingMembers: boolean;
  memberFormState: MemberFormState;
  onMemberFormChange: (update: Partial<MemberFormState>) => void;
  onCreateMember: (e: FormEvent<HTMLFormElement>) => void;
  isSavingMember: boolean;
  onRoleChange: (userId: string, role: MemberSummary["role"]) => void;
  onProviderAccessToggle: (
    userId: string,
    providerKey: string,
    hasAccess: boolean,
  ) => void;
}

export function MembersView({
  members,
  providerOptions,
  selectedMemberId,
  onSelectMember,
  isLoadingMembers,
  memberFormState,
  onMemberFormChange,
  onCreateMember,
  isSavingMember,
  onRoleChange,
  onProviderAccessToggle,
}: MembersViewProps) {
  const selectedMember = members.find((m) => m.id === selectedMemberId);

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 4, height: "100%" }}
    >
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ fontWeight: "bold" }}
        >
          Invite-only onboarding
        </Typography>
        <Typography
          variant="h5"
          component="h2"
          sx={{ fontWeight: "bold", mb: 1 }}
        >
          Create a household member
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Provision a member directly, then share the generated login details
          privately with them.
        </Typography>

        <Box
          component="form"
          onSubmit={onCreateMember}
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            gap: 2,
            alignItems: { xs: "stretch", md: "flex-start" },
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
            onChange={(e) => onMemberFormChange({ password: e.target.value })}
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
          <Button
            type="submit"
            variant="contained"
            disabled={isSavingMember}
            sx={{ minWidth: 160, py: 1 }}
          >
            {isSavingMember ? "Creating…" : "Create member"}
          </Button>
        </Box>
      </Paper>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: 3,
          flexGrow: 1,
        }}
      >
        <Box sx={{ width: { xs: "100%", md: 360 }, flexShrink: 0 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              mb: 2,
            }}
          >
            <Typography variant="h5" component="h2" sx={{ fontWeight: "bold" }}>
              Household access
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {members.length} members
            </Typography>
          </Box>

          <Paper
            variant="outlined"
            sx={{ borderRadius: 2, overflow: "hidden" }}
          >
            <List disablePadding>
              {members.map((member, index) => {
                const isSelected = member.id === selectedMemberId;

                return (
                  <React.Fragment key={member.id}>
                    {index > 0 && <Divider />}
                    <ListItem disablePadding>
                      <ListItemButton
                        selected={isSelected}
                        onClick={() => onSelectMember(member.id)}
                        sx={{ py: 2 }}
                      >
                        <ListItemText
                          primary={
                            <Box
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                mb: 0.5,
                              }}
                            >
                              <Typography
                                variant="subtitle2"
                                sx={{
                                  fontWeight: isSelected ? "bold" : "medium",
                                }}
                              >
                                {member.name}
                              </Typography>
                              <Chip
                                label={member.role}
                                size="small"
                                color={
                                  member.role === "admin"
                                    ? "primary"
                                    : "default"
                                }
                                variant="outlined"
                                sx={{ height: 20 }}
                              />
                            </Box>
                          }
                          secondary={
                            <>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {member.email}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.disabled"
                                sx={{ mt: 0.5, display: "block" }}
                              >
                                {member.providerAccess.length} provider
                                {member.providerAccess.length === 1 ? "" : "s"}
                              </Typography>
                            </>
                          }
                        />
                      </ListItemButton>
                    </ListItem>
                  </React.Fragment>
                );
              })}

              {!members.length && !isLoadingMembers && (
                <Box sx={{ p: 4, textAlign: "center" }}>
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: "bold" }}
                    gutterBottom
                  >
                    No members yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Create the first invited household member to get started.
                  </Typography>
                </Box>
              )}
            </List>
          </Paper>
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="h5"
            component="h2"
            sx={{ fontWeight: "bold", mb: 2, visibility: "hidden" }}
          >
            Detail
          </Typography>

          {selectedMember ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Box>
                <Typography
                  variant="overline"
                  color="text.secondary"
                  sx={{ fontWeight: "bold" }}
                >
                  Member detail
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: "bold", mb: 0.5 }}>
                  {selectedMember.name}
                </Typography>
                <Typography variant="body1" color="text.secondary">
                  {selectedMember.email}
                </Typography>
              </Box>

              <Box>
                <FormControl sx={{ minWidth: 200 }}>
                  <InputLabel id="update-role-label">Role</InputLabel>
                  <Select
                    labelId="update-role-label"
                    value={selectedMember.role}
                    label="Role"
                    onChange={(e) =>
                      onRoleChange(selectedMember.id, e.target.value)
                    }
                  >
                    <MenuItem value="member">Member</MenuItem>
                    <MenuItem value="admin">Owner</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
                <Typography
                  variant="subtitle2"
                  sx={{ mb: 2, fontWeight: "bold" }}
                >
                  Provider access
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: "wrap", gap: 1 }}
                >
                  {providerOptions.map((provider) => {
                    const hasAccess = selectedMember.providerAccess.some(
                      (access) => access.providerKey === provider.provider_key,
                    );

                    return (
                      <Chip
                        key={provider.id}
                        label={provider.display_name}
                        color={hasAccess ? "primary" : "default"}
                        variant={hasAccess ? "filled" : "outlined"}
                        onClick={() =>
                          onProviderAccessToggle(
                            selectedMember.id,
                            provider.provider_key,
                            hasAccess,
                          )
                        }
                        sx={{
                          fontWeight: hasAccess ? "bold" : "regular",
                          borderRadius: 1,
                        }}
                      />
                    );
                  })}
                </Stack>
              </Paper>
            </Box>
          ) : (
            <Paper
              variant="outlined"
              sx={{
                p: 6,
                textAlign: "center",
                borderRadius: 2,
                borderStyle: "dashed",
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1 }}>
                Select a household member
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Choose a member to adjust role or provider access.
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}
