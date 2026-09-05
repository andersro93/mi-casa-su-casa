/**
 * MUI surfaces that navigate with the router.
 *
 * MUI's `component={Link}` cannot type-check against TanStack Router's `Link`
 * (its props are generic in the route it points at), so each surface gets a
 * `createLink` wrapper instead — the documented integration. They take the
 * router's `to`/`params`/`search` props *and* the MUI props of the component
 * they wrap.
 */
import {
  Button,
  type ButtonProps,
  CardActionArea,
  type CardActionAreaProps,
  ListItemButton,
  type ListItemButtonProps,
  MenuItem,
  type MenuItemProps,
} from "@mui/material";
import { createLink } from "@tanstack/react-router";
import { forwardRef } from "react";

const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonProps<"a">>(
  (props, ref) => <Button ref={ref} component="a" {...props} />,
);

const ListItemButtonAnchor = forwardRef<
  HTMLAnchorElement,
  ListItemButtonProps<"a">
>((props, ref) => <ListItemButton ref={ref} component="a" {...props} />);

const MenuItemAnchor = forwardRef<HTMLAnchorElement, MenuItemProps<"a">>(
  (props, ref) => <MenuItem ref={ref} component="a" {...props} />,
);

const CardActionAreaAnchor = forwardRef<
  HTMLAnchorElement,
  CardActionAreaProps<"a">
>((props, ref) => <CardActionArea ref={ref} component="a" {...props} />);

export const ButtonLink = createLink(ButtonAnchor);
export const ListItemButtonLink = createLink(ListItemButtonAnchor);
export const MenuItemLink = createLink(MenuItemAnchor);
export const CardActionAreaLink = createLink(CardActionAreaAnchor);
