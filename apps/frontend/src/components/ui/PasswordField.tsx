import { VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import {
  IconButton,
  InputAdornment,
  TextField,
  type TextFieldProps,
} from "@mui/material";
import { useState } from "react";

type PasswordFieldProps = Omit<TextFieldProps, "type">;

/** A password TextField with a show/hide toggle. */
export function PasswordField({ slotProps, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      slotProps={{
        ...slotProps,
        input: {
          ...(slotProps?.input as object | undefined),
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label={visible ? "Hide password" : "Show password"}
                aria-pressed={visible}
                onClick={() => setVisible((current) => !current)}
                onMouseDown={(event) => event.preventDefault()}
                edge="end"
                size="small"
              >
                {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
