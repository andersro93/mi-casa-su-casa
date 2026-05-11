import React, { useState, useContext } from "react";
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
  Divider,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Inbox as InboxIcon,
  Security as SecurityIcon,
  People as PeopleIcon,
  Brightness4,
  Brightness7,
  Logout as LogoutIcon,
} from "@mui/icons-material";
import { ColorModeContext } from "../theme";
import type { SessionData } from "../types";
import { getDisplayName } from "../utils";

const DRAWER_WIDTH = 280;

type ViewType = "inbox" | "quarantine" | "members";

interface LayoutProps {
  children: React.ReactNode;
  session: SessionData | null | undefined;
  isOwner: boolean;
  onLogout: () => void;
  activeView: ViewType;
  onNavigate: (view: ViewType) => void;
}

export function Layout({
  children,
  session,
  isOwner,
  onLogout,
  activeView,
  onNavigate,
}: LayoutProps) {
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const isDesktop = useMediaQuery(theme.breakpoints.up("lg"));
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleNavClick = (view: ViewType) => {
    onNavigate(view);
    if (!isDesktop) {
      setMobileOpen(false);
    }
  };

  const drawerContent = (
    <>
      <Toolbar>
        <Typography variant="h6" noWrap component="div" sx={{ fontWeight: "bold" }}>
          Mi Casa Su Casa
        </Typography>
      </Toolbar>
      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Access: {isOwner ? "Owner" : "Family member"}
        </Typography>
        <Typography variant="body2" noWrap title={session?.user?.email ?? ""}>
          {session?.user?.email}
        </Typography>
      </Box>
      <Divider />
      <List sx={{ px: 2, pt: 2 }}>
        <ListItem disablePadding sx={{ mb: 1 }}>
          <ListItemButton
            selected={activeView === "inbox"}
            onClick={() => handleNavClick("inbox")}
            sx={{ borderRadius: 2 }}
          >
            <ListItemIcon>
              <InboxIcon color={activeView === "inbox" ? "primary" : "inherit"} />
            </ListItemIcon>
              <ListItemText
                primary={
                  <Typography sx={{ fontWeight: activeView === 'inbox' ? 'bold' : 'normal' }}>
                    Inbox
                  </Typography>
                }
              />
          </ListItemButton>
        </ListItem>

        {isOwner && (
          <>
            <ListItem disablePadding sx={{ mb: 1 }}>
              <ListItemButton
                selected={activeView === "quarantine"}
                onClick={() => handleNavClick("quarantine")}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <SecurityIcon color={activeView === "quarantine" ? "primary" : "inherit"} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: activeView === "quarantine" ? "bold" : "normal" }}>
                      Quarantine
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>

            <ListItem disablePadding>
              <ListItemButton
                selected={activeView === "members"}
                onClick={() => handleNavClick("members")}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon>
                  <PeopleIcon color={activeView === "members" ? "primary" : "inherit"} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography sx={{ fontWeight: activeView === "members" ? "bold" : "normal" }}>
                      Members
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>
          </>
        )}
      </List>
    </>
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

          <Typography variant="body2" sx={{ mr: 2, display: { xs: "none", sm: "block" } }}>
            {getDisplayName(session)}
          </Typography>

          <IconButton sx={{ ml: 1 }} onClick={colorMode.toggleColorMode} color="inherit">
            {theme.palette.mode === "dark" ? <Brightness7 /> : <Brightness4 />}
          </IconButton>
          <IconButton sx={{ ml: 1 }} onClick={onLogout} color="inherit" title="Sign out">
            <LogoutIcon />
          </IconButton>
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
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          mt: "64px", // Toolbar height
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
