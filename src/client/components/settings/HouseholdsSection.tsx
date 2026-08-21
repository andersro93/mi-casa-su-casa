import {
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useLeaveHousehold } from "../../queries/settings";
import type { HouseholdSummary } from "../../types";
import { ConfirmDialog } from "../ConfirmDialog";
import { SettingsSection } from "./SettingsSection";

interface HouseholdsSectionProps {
  households: HouseholdSummary[];
  onLeft: (household: HouseholdSummary) => void;
}

export function HouseholdsSection({
  households,
  onLeft,
}: HouseholdsSectionProps) {
  const leave = useLeaveHousehold();
  const [target, setTarget] = useState<HouseholdSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsSection
      id="households"
      title="Households"
      description="The households you belong to. Leaving one removes your access to its codes."
    >
      {households.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          You're not in a household yet.
        </Typography>
      ) : (
        <List disablePadding aria-label="Households">
          {households.map((household, index) => (
            <ListItem
              key={household.id}
              divider={index < households.length - 1}
              disableGutters
              secondaryAction={
                <Button
                  size="small"
                  color="error"
                  variant="text"
                  onClick={() => setTarget(household)}
                >
                  Leave
                </Button>
              }
            >
              <ListItemText
                primary={household.displayName}
                secondary={household.role === "owner" ? "Owner" : "Member"}
              />
            </ListItem>
          ))}
        </List>
      )}
      <ConfirmDialog
        open={Boolean(target)}
        title={`Leave ${target?.displayName ?? "this household"}?`}
        description={
          target?.role === "owner"
            ? "You'll lose access to its codes and settings. If you're the only owner, make someone else an owner first."
            : "You'll lose access to its codes. An owner can invite you back later."
        }
        confirmLabel="Leave household"
        loadingLabel="Leaving…"
        confirmColor="error"
        isLoading={leave.isPending}
        error={error}
        onClose={() => {
          setTarget(null);
          setError(null);
        }}
        onConfirm={async () => {
          if (!target) return;
          try {
            await leave.mutateAsync(target.slug);
            const left = target;
            setTarget(null);
            onLeft(left);
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : "Couldn't leave the household.",
            );
          }
        }}
      />
    </SettingsSection>
  );
}
