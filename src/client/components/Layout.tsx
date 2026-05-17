import {
  Add,
  Brightness4,
  Brightness7,
  ExpandMore,
  HubOutlined,
  Inbox as InboxIcon,
  Logout as LogoutIcon,
  ManageAccounts as ManageAccountsIcon,
  Menu as MenuIcon,
  People as PeopleIcon,
  Security as SecurityIcon,
} from "@mui/icons-material";
import {
  AppBar,
  Avatar,
  Box,
  ButtonBase,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import type React from "react";
import { useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ColorModeContext } from "../theme";
import type { HouseholdSummary, SessionData } from "../types";
import { buildHouseholdPath, getDisplayName, getUserInitials } from "../utils";

const DRAWER_WIDTH = 280;

interface LayoutProps {
  children: React.ReactNode;
  session: SessionData | null | undefined;
  households: HouseholdSummary[];
  isOwner: boolean;
  householdSlug: string;
  householdName: string;
  householdRole: HouseholdSummary["role"];
  onSelectHousehold: (household: HouseholdSummary) => void;
  onCreateHousehold: () => void;
  onLogout: () => void;
}

function getActiveView(pathname: string) {
  if (pathname === "/settings" || pathname.endsWith("/settings")) {
    return "settings";
  }

  if (pathname.includes("/quarantine")) {
    return "quarantine";
  }

  if (pathname.includes("/members")) {
    return "members";
  }

  if (pathname.includes("/inboxes")) {
    return "inboxes";
  }

  return "inbox";
}

export function isSettingsPath(pathname: string) {
  return getActiveView(pathname) === "settings";
}

interface UserAccountMenuProps {
  session: SessionData | null | undefined;
  mode: "light" | "dark";
  settingsPath: string;
  onSettingsClick: () => void;
  onToggleColorMode: () => void;
  onLogout: () => void;
}

export function UserAccountMenuContent({
  session,
  mode,
  settingsPath,
  onSettingsClick,
  onToggleColorMode,
  onLogout,
}: UserAccountMenuProps) {
  return (
    <>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
          {getDisplayName(session)}
        </Typography>
        <Typography variant="body2" color="text.secondary" noWrap>
          {session?.user?.email ?? ""}
        </Typography>
      </Box>
      <Divider />
      <MenuItem
        component={Link}
        to={settingsPath}
        onClick={onSettingsClick}
        sx={{ py: 1.25 }}
      >
        <ListItemIcon>
          <ManageAccountsIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={<Typography sx={{ fontWeight: 600 }}>Settings</Typography>}
        />
      </MenuItem>
      <MenuItem onClick={onToggleColorMode} sx={{ py: 1.25 }}>
        <ListItemIcon>
          {mode === "dark" ? (
            <Brightness7 fontSize="small" />
          ) : (
            <Brightness4 fontSize="small" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography sx={{ fontWeight: 600 }}>
              {mode === "dark" ? "Light mode" : "Dark mode"}
            </Typography>
          }
        />
      </MenuItem>
      <Divider />
      <MenuItem onClick={onLogout} sx={{ py: 1.25 }}>
        <ListItemIcon>
          <LogoutIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={<Typography sx={{ fontWeight: 600 }}>Sign out</Typography>}
        />
      </MenuItem>
    </>
  );
}

interface UserAccountMenuWrapperProps
  extends Omit<UserAccountMenuProps, "onSettingsClick"> {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
}

function UserAccountMenu({
  anchorEl,
  open,
  onClose,
  ...contentProps
}: UserAccountMenuWrapperProps) {
  return (
    <Menu
      id="user-account-menu"
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            width: 280,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: 3,
            mt: 1,
          },
        },
      }}
    >
      <UserAccountMenuContent {...contentProps} onSettingsClick={onClose} />
    </Menu>
  );
}

export function Layout({
  children,
  session,
  households,
  isOwner,
  householdSlug,
  householdName,
  householdRole,
  onSelectHousehold,
  onCreateHousehold,
  onLogout,
}: LayoutProps) {
  const location = useLocation();
  const activeView = getActiveView(location.pathname);
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [householdMenuAnchor, setHouseholdMenuAnchor] =
    useState<null | HTMLElement>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(
    null,
  );

  const activeHousehold =
    households.find((household) => household.slug === householdSlug) ?? null;
  const roleLabel = householdRole === "owner" ? "Owner" : "Member";
  const settingsPath = buildHouseholdPath(householdSlug, "/settings");
  const isHouseholdMenuOpen = Boolean(householdMenuAnchor);
  const isUserMenuOpen = Boolean(userMenuAnchor);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleNavClick = () => {
    if (!isDesktop) {
      setMobileOpen(false);
    }
  };

  const handleOpenHouseholdMenu = (event: React.MouseEvent<HTMLElement>) => {
    setHouseholdMenuAnchor(event.currentTarget);
  };

  const handleCloseHouseholdMenu = () => {
    setHouseholdMenuAnchor(null);
  };

  const handleHouseholdSelect = (household: HouseholdSummary) => {
    handleCloseHouseholdMenu();
    handleNavClick();
    onSelectHousehold(household);
  };

  const handleCreateHouseholdClick = () => {
    handleCloseHouseholdMenu();
    handleNavClick();
    onCreateHousehold();
  };

  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setUserMenuAnchor(null);
  };

  const handleToggleColorMode = () => {
    handleCloseUserMenu();
    colorMode.toggleColorMode();
  };

  const handleLogoutClick = () => {
    handleCloseUserMenu();
    onLogout();
  };

  const drawerContent = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Toolbar>
        <Typography
          variant="h6"
          noWrap
          component="div"
          sx={{ fontWeight: "bold" }}
        >
          Mi Casa Su Casa
        </Typography>
      </Toolbar>
      <Divider />
      <List sx={{ px: 2, pt: 2 }}>
        <ListItem disablePadding sx={{ mb: 1 }}>
          <ListItemButton
            selected={activeView === "inbox"}
            component={Link}
            to={buildHouseholdPath(householdSlug, "/inbox")}
            onClick={handleNavClick}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon>
              <InboxIcon
                color={activeView === "inbox" ? "primary" : "inherit"}
              />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography
                  sx={{
                    fontWeight: activeView === "inbox" ? "bold" : "normal",
                  }}
                >
                  Inbox
                </Typography>
              }
            />
          </ListItemButton>
        </ListItem>

        {isOwner && (
          <>
            <ListItem sx={{ px: 1, pt: 1, pb: 0.5 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ fontWeight: 700, letterSpacing: 1 }}
              >
                Settings
              </Typography>
            </ListItem>

            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={activeView === "members"}
                component={Link}
                to={buildHouseholdPath(householdSlug, "/members")}
                onClick={handleNavClick}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <PeopleIcon
                    color={activeView === "members" ? "primary" : "inherit"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      sx={{
                        fontWeight:
                          activeView === "members" ? "bold" : "normal",
                      }}
                    >
                      Members
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={activeView === "quarantine"}
                component={Link}
                to={buildHouseholdPath(householdSlug, "/quarantine")}
                onClick={handleNavClick}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <SecurityIcon
                    color={activeView === "quarantine" ? "primary" : "inherit"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      sx={{
                        fontWeight:
                          activeView === "quarantine" ? "bold" : "normal",
                      }}
                    >
                      Quarantine
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={activeView === "inboxes"}
                component={Link}
                to={buildHouseholdPath(householdSlug, "/inboxes")}
                onClick={handleNavClick}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <HubOutlined
                    color={activeView === "inboxes" ? "primary" : "inherit"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      sx={{
                        fontWeight:
                          activeView === "inboxes" ? "bold" : "normal",
                      }}
                    >
                      Inboxes &amp; rules
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding>
              <ListItemButton
                selected={activeView === "settings"}
                component={Link}
                to={buildHouseholdPath(householdSlug, "/settings")}
                onClick={handleNavClick}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <ManageAccountsIcon
                    color={activeView === "settings" ? "primary" : "inherit"}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography
                      sx={{
                        fontWeight:
                          activeView === "settings" ? "bold" : "normal",
                      }}
                    >
                      Household settings
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>
          </>
        )}
      </List>
      <Box sx={{ mt: "auto", px: 2, pb: 2, pt: 2 }}>
        <Divider sx={{ mb: 2 }} />
        <ButtonBase
          onClick={handleOpenHouseholdMenu}
          sx={{
            width: "100%",
            borderRadius: 3,
            border: 1,
            borderColor: "divider",
            px: 2,
            py: 1.5,
            textAlign: "left",
            justifyContent: "space-between",
            alignItems: "center",
            bgcolor: "background.paper",
          }}
        >
          <Box sx={{ minWidth: 0, pr: 2 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {householdName}
            </Typography>
            <Chip
              label={roleLabel}
              size="small"
              sx={{ mt: 0.75, fontWeight: 600, maxWidth: "100%" }}
            />
          </Box>
          <ExpandMore color="action" />
        </ButtonBase>
        <Menu
          anchorEl={householdMenuAnchor}
          open={isHouseholdMenuOpen}
          onClose={handleCloseHouseholdMenu}
          anchorOrigin={{ vertical: "top", horizontal: "right" }}
          transformOrigin={{ vertical: "bottom", horizontal: "right" }}
          slotProps={{
            paper: {
              sx: {
                width: 320,
                maxWidth: "calc(100vw - 32px)",
                borderRadius: 3,
              },
            },
          }}
        >
          <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Switch household
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {session?.user?.email ?? ""}
            </Typography>
          </Box>
          {households.map((household) => {
            const selected = household.slug === activeHousehold?.slug;
            return (
              <MenuItem
                key={household.id}
                selected={selected}
                onClick={() => handleHouseholdSelect(household)}
                sx={{
                  alignItems: "flex-start",
                  py: 1.25,
                }}
              >
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: selected ? 700 : 500 }}>
                      {household.displayName}
                    </Typography>
                  }
                  secondary={household.role === "owner" ? "Owner" : "Member"}
                />
              </MenuItem>
            );
          })}
          <Divider />
          <MenuItem onClick={handleCreateHouseholdClick} sx={{ py: 1.25 }}>
            <ListItemIcon>
              <Add fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={
                <Typography sx={{ fontWeight: 600 }}>
                  Create new household
                </Typography>
              }
            />
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { lg: "none" } }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1 }} />

          <IconButton
            onClick={handleOpenUserMenu}
            color="inherit"
            aria-label="Open account menu"
            aria-controls={isUserMenuOpen ? "user-account-menu" : undefined}
            aria-expanded={isUserMenuOpen ? "true" : undefined}
            aria-haspopup="true"
            sx={{ p: 0.5 }}
          >
            <Avatar
              src={session?.user?.image ?? undefined}
              alt={getDisplayName(session)}
              sx={{ width: 36, height: 36, bgcolor: "primary.main" }}
            >
              {getUserInitials(session)}
            </Avatar>
          </IconButton>
          <UserAccountMenu
            session={session}
            anchorEl={userMenuAnchor}
            open={isUserMenuOpen}
            mode={theme.palette.mode}
            settingsPath={settingsPath}
            onClose={handleCloseUserMenu}
            onToggleColorMode={handleToggleColorMode}
            onLogout={handleLogoutClick}
          />
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}
      >
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: "block", lg: "none" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
            },
          }}
        >
          {drawerContent}
        </Drawer>
        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", lg: "block" },
            "& .MuiDrawer-paper": {
              boxSizing: "border-box",
              width: DRAWER_WIDTH,
              borderRight: 1,
              borderColor: "divider",
            },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3, md: 4 },
          minWidth: 0,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: "64px", // Toolbar height
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 1600, mx: "auto", minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
