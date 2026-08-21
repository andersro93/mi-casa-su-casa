import { InputAdornment, TextField, type TextFieldProps } from "@mui/material";
import {
  HOUSEHOLD_SLUG_MAX_LENGTH,
  HOUSEHOLD_SLUG_MIN_LENGTH,
  RESERVED_HOUSEHOLD_SLUGS,
  validateHouseholdSlug,
} from "@server/domain/household-slug";

/** Plain-language version of the slug rules, for inline validation. */
export function describeSlugProblem(slug: string): string | null {
  if (!slug) return "Choose an address for your household's inbox.";
  const check = validateHouseholdSlug(slug);
  if (check.ok) return null;
  if (RESERVED_HOUSEHOLD_SLUGS.has(slug)) {
    return "That one's reserved — try a different address.";
  }
  if (
    slug.length < HOUSEHOLD_SLUG_MIN_LENGTH ||
    slug.length > HOUSEHOLD_SLUG_MAX_LENGTH
  ) {
    return `Use between ${HOUSEHOLD_SLUG_MIN_LENGTH} and ${HOUSEHOLD_SLUG_MAX_LENGTH} characters.`;
  }
  return "Use lowercase letters, numbers and hyphens only (no spaces), starting and ending with a letter or number.";
}

interface HouseholdAddressFieldProps
  extends Omit<TextFieldProps, "value" | "onChange" | "error" | "helperText"> {
  value: string;
  onChange: (value: string) => void;
  emailDomain: string | null | undefined;
  /** Show the validation message (after the user has submitted or touched). */
  showError?: boolean;
}

/**
 * The household's inbox address: `value@domain`. The slug doubles as the URL
 * segment, but to a family it is simply "the email address codes arrive at".
 */
export function HouseholdAddressField({
  value,
  onChange,
  emailDomain,
  showError = false,
  ...props
}: HouseholdAddressFieldProps) {
  const problem = describeSlugProblem(value);
  const domain = emailDomain ?? "your-domain";
  return (
    <TextField
      {...props}
      label="Inbox address"
      value={value}
      onChange={(e) =>
        onChange(e.target.value.toLowerCase().replace(/\s+/g, "-"))
      }
      error={showError && Boolean(problem)}
      helperText={
        showError && problem
          ? problem
          : value
            ? `Login codes will arrive at ${value}@${domain}. This can't be changed later.`
            : `Login codes will arrive at this address @${domain}. This can't be changed later.`
      }
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">@{domain}</InputAdornment>
          ),
        },
        htmlInput: {
          autoCapitalize: "none",
          autoCorrect: "off",
          spellCheck: false,
        },
      }}
    />
  );
}
