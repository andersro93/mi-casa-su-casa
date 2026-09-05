import {
  Add,
  Brightness4,
  Brightness7,
  HubOutlined,
  Inbox as InboxIcon,
  Logout as LogoutIcon,
  ManageAccounts as ManageAccountsIcon,
  Menu as MenuIcon,
  People as PeopleIcon,
  Security as SecurityIcon,
  UnfoldMore,
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
import { type ReactNode, useContext, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ColorModeContext } from "../theme";
import type { HouseholdSummary, SessionData } from "../types";
import { buildHouseholdPath, getDisplayName, getUserInitials } from "../utils";
import { BrandLockup } from "./ui";

const DRAWER_WIDTH = 264;
const APP_BAR_HEIGHT = 64;

/**
 * Account settings (profile, password, 2FA, passkeys, sessions) are a global
 * route — not scoped to a household. Household settings live at
 * /:slug/settings and are linked from the sidebar instead.
 */
export const ACCOUNT_SETTINGS_PATH = "/settings";

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

type ActiveView = "inbox" | "members" | "quarantine" | "providers" | "settings";

function getActiveView(pathname: string): ActiveView {
  // Match on path segments (/:slug/:view), not substrings, so a household slug
  // that happens to contain a view name does not change the active view.
  const segments = pathname.split("/").filter(Boolean);
  const view = segments.length === 1 ? segments[0] : segments[1];

  if (view === "settings") return "settings";
  if (view === "quarantine") return "quarantine";
  if (view === "members") return "members";
  if (view === "providers") return "providers";
  return "inbox";
}

export function isSettingsPath(pathname: string) {
  return getActiveView(pathname) === "settings";
}

/** Title shown in the mobile app bar. */
export function getPageTitle(pathname: string): string {
  const view = getActiveView(pathname);
  if (view === "settings") {
    return pathname === ACCOUNT_SETTINGS_PATH
      ? "Settings"
      : "Household settings";
  }
  return {
    inbox: "Latest codes",
    members: "Members",
    quarantine: "Needs review",
    providers: "Services",
  }[view];
}

interface UserAccountMenuProps {
  session: SessionData | null | undefined;
  mode: "light" | "dark";
  onSettingsClick: () => void;
  onToggleColorMode: () => void;
  onLogout: () => void;
}

export function UserAccountMenuContent({
  session,
  mode,
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
        to={ACCOUNT_SETTINGS_PATH}
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

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
}

function NavItem({ to, icon, label, selected, onClick }: NavItemProps) {
  return (
    <ListItem disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        selected={selected}
        component={Link}
        to={to}
        onClick={onClick}
        aria-current={selected ? "page" : undefined}
        sx={{ minHeight: 44 }}
      >
        <ListItemIcon
          sx={{ minWidth: 40, color: selected ? "primary.main" : "inherit" }}
        >
          {icon}
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography sx={{ fontWeight: selected ? 700 : 500 }}>
              {label}
            </Typography>
          }
        />
      </ListItemButton>
    </ListItem>
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
  const pageTitle = getPageTitle(location.pathname);
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [householdMenuAnchor, setHouseholdMenuAnchor] =
    useState<null | HTMLElement>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(
    null,
  );

  const activeHousehold =
    households.find((household) => household.slug === householdSlug) ?? null;
  const roleLabel = householdRole === "owner" ? "Owner" : "Member";
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
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.default",
      }}
    >
      <Box
        sx={{
          px: 2.5,
          height: APP_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
        }}
      >
        <BrandLockup size={30} />
      </Box>

      {/* Household switcher: the primary context, so it sits at the top. */}
      <Box sx={{ px: 2, pb: 1 }}>
        <ButtonBase
          onClick={handleOpenHouseholdMenu}
          aria-haspopup="menu"
          aria-expanded={isHouseholdMenuOpen ? "true" : undefined}
          aria-label={`Household: ${householdName}. Switch household`}
          sx={{
            width: "100%",
            borderRadius: 3,
            border: 1,
            borderColor: "divider",
            px: 1.5,
            py: 1.25,
            textAlign: "left",
            justifyContent: "space-between",
            alignItems: "center",
            bgcolor: "background.paper",
            gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="overline"
              color="text.secondary"
              component="div"
              sx={{ lineHeight: 1.4 }}
            >
              Household
            </Typography>
            <Typography variant="subtitle1" noWrap>
              {householdName}
            </Typography>
            <Chip label={roleLabel} size="small" sx={{ mt: 0.5, height: 22 }} />
          </Box>
          <UnfoldMore color="action" fontSize="small" />
        </ButtonBase>
        <Menu
          anchorEl={householdMenuAnchor}
          open={isHouseholdMenuOpen}
          onClose={handleCloseHouseholdMenu}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          slotProps={{
            paper: {
              sx: {
                width: 300,
                maxWidth: "calc(100vw - 32px)",
                borderRadius: 3,
                mt: 0.5,
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
                sx={{ alignItems: "flex-start", py: 1.25 }}
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

      <List component="nav" aria-label="Main" sx={{ px: 2, pt: 1 }}>
        <NavItem
          to={buildHouseholdPath(householdSlug, "/inbox")}
          icon={<InboxIcon />}
          label="Inbox"
          selected={activeView === "inbox"}
          onClick={handleNavClick}
        />

        {isOwner && (
          <>
            <ListItem sx={{ px: 1, pt: 2, pb: 0.5 }}>
              <Typography
                variant="overline"
                color="text.secondary"
                component="div"
              >
                Settings
              </Typography>
            </ListItem>
            <NavItem
              to={buildHouseholdPath(householdSlug, "/members")}
              icon={<PeopleIcon />}
              label="Members"
              selected={activeView === "members"}
              onClick={handleNavClick}
            />
            <NavItem
              to={buildHouseholdPath(householdSlug, "/quarantine")}
              icon={<SecurityIcon />}
              label="Needs review"
              selected={activeView === "quarantine"}
              onClick={handleNavClick}
            />
            <NavItem
              to={buildHouseholdPath(householdSlug, "/providers")}
              icon={<HubOutlined />}
              label="Services"
              selected={activeView === "providers"}
              onClick={handleNavClick}
            />
            <NavItem
              to={buildHouseholdPath(householdSlug, "/settings")}
              icon={<ManageAccountsIcon />}
              label="Household settings"
              selected={
                activeView === "settings" &&
                location.pathname !== ACCOUNT_SETTINGS_PATH
              }
              onClick={handleNavClick}
            />
          </>
        )}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Keyboard users can jump past the navigation. */}
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: "absolute",
          left: 16,
          top: -100,
          zIndex: (theme) => theme.zIndex.appBar + 1,
          px: 2,
          py: 1,
          borderRadius: 2,
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontWeight: 600,
          "&:focus-visible": { top: 12 },
        }}
      >
        Skip to content
      </Box>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
          bgcolor: "background.paper",
          color: "text.primary",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Toolbar sx={{ minHeight: APP_BAR_HEIGHT, gap: 1 }}>
          <IconButton
            color="inherit"
            aria-label="Open menu"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ display: { md: "none" } }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ flexGrow: 1, minWidth: 0, display: { md: "none" } }}>
            <Typography variant="h6" component="div" noWrap>
              {pageTitle}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              component="div"
              sx={{ lineHeight: 1.2 }}
            >
              {householdName}
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1, display: { xs: "none", md: "block" } }} />

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
            onClose={handleCloseUserMenu}
            onToggleColorMode={handleToggleColorMode}
            onLogout={handleLogoutClick}
          />
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
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
            display: { xs: "block", md: "none" },
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
            display: { xs: "none", md: "block" },
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
        id="main-content"
        tabIndex={-1}
        sx={{
          outline: "none",
          flexGrow: 1,
          p: { xs: 2, sm: 3, md: 4 },
          minWidth: 0,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: `${APP_BAR_HEIGHT}px`,
        }}
      >
        <Box sx={{ width: "100%", maxWidth: 1400, mx: "auto", minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
