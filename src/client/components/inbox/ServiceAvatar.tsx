import { Avatar, Badge } from "@mui/material";
import { stringAvatar } from "../../utils";

interface ServiceAvatarProps {
  name: string;
  newCount?: number;
  size?: number;
}

/** Initial-letter avatar for a service, with a "new" count badge. */
export function ServiceAvatar({
  name,
  newCount = 0,
  size = 40,
}: ServiceAvatarProps) {
  const avatar = stringAvatar(name);
  return (
    <Badge
      color="primary"
      badgeContent={newCount}
      invisible={newCount === 0}
      overlap="circular"
      aria-label={newCount > 0 ? `${newCount} new` : undefined}
    >
      <Avatar
        {...avatar}
        sx={{
          ...avatar.sx,
          width: size,
          height: size,
          fontSize: size * 0.42,
        }}
      />
    </Badge>
  );
}
