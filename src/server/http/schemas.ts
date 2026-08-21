import { z } from "zod";

import { validateHouseholdSlug } from "../domain/household-slug";

/** Request body schemas for every JSON endpoint (single source of truth). */

const trimmed = (max: number, label = "value") =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

export const emailSchema = z
  .string({ error: "email is required" })
  .trim()
  .toLowerCase()
  .min(3, "email is required")
  .max(254, "email must be at most 254 characters")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email must be a valid email address");

export const passwordSchema = z
  .string({ error: "password is required" })
  .min(12, "password must be at least 12 characters")
  .max(128, "password must be at most 128 characters");

export const householdRoleSchema = z
  .enum(["owner", "member", "admin"], {
    error: "role must be owner or member",
  })
  .transform((role) => (role === "admin" ? "owner" : role));

export const householdSlugSchema = z
  .string({ error: "slug is required" })
  .trim()
  .toLowerCase()
  .superRefine((slug, ctx) => {
    const check = validateHouseholdSlug(slug);
    if (!check.ok) ctx.addIssue({ code: "custom", message: check.error });
  });

const HOSTNAME =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const householdSettingsSchema = z.object({
  displayName: trimmed(80, "displayName"),
});

export const createHouseholdSchema = z.object({
  slug: householdSlugSchema,
  displayName: trimmed(80, "displayName"),
});

export const providerSchema = z.object({
  providerKey: z
    .string({ error: "providerKey is required" })
    .trim()
    .toLowerCase()
    .min(1, "providerKey is required")
    .max(40, "providerKey must be at most 40 characters")
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "providerKey may only contain lowercase letters, numbers and hyphens",
    ),
  displayName: trimmed(80, "displayName"),
});

export const senderRuleSchema = z
  .object({
    providerId: trimmed(64, "providerId"),
    matchType: z.enum(["exact", "domain"], {
      error: "matchType must be exact or domain",
    }),
    matchValue: z
      .string({ error: "matchValue is required" })
      .trim()
      .toLowerCase()
      .min(1, "matchValue is required")
      .max(254, "matchValue must be at most 254 characters"),
  })
  .transform((rule) => ({
    ...rule,
    matchValue:
      rule.matchType === "domain"
        ? rule.matchValue.replace(/^@+/, "")
        : rule.matchValue,
  }))
  .superRefine((rule, ctx) => {
    if (rule.matchType === "domain" && !HOSTNAME.test(rule.matchValue)) {
      ctx.addIssue({
        code: "custom",
        path: ["matchValue"],
        message: "matchValue must be a domain like netflix.com",
      });
    }
    if (
      rule.matchType === "exact" &&
      !emailSchema.safeParse(rule.matchValue).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["matchValue"],
        message: "matchValue must be a full email address",
      });
    }
  });

export const invitationSchema = z.object({
  email: emailSchema,
  name: trimmed(80, "name"),
  role: householdRoleSchema.default("member"),
  providerIds: z
    .array(z.string().trim().min(1).max(64))
    .max(50, "at most 50 providers can be scoped")
    .default([]),
});

export const createMemberSchema = z.object({
  email: emailSchema,
  name: trimmed(80, "name"),
  role: householdRoleSchema.default("member"),
});

export const roleChangeSchema = z.object({ role: householdRoleSchema });

export const providerAccessSchema = z.object({
  providerKey: trimmed(40, "providerKey").toLowerCase(),
});

export const profileSchema = z.object({
  name: trimmed(80, "name"),
  image: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(2048, "image must be at most 2048 characters")
        .url("image must be an http(s) URL")
        .refine(
          (url) => /^https?:\/\//i.test(url),
          "image must be an http(s) URL",
        ),
    ])
    .optional()
    .transform((value) => (value ? value : null)),
});

export const setupSchema = z.object({
  email: emailSchema,
  name: trimmed(80, "name"),
  password: passwordSchema,
  householdName: trimmed(80, "householdName"),
  householdSlug: householdSlugSchema,
  setupSecret: z
    .string({ error: "setupSecret is required" })
    .min(1, "setupSecret is required"),
});

export const acceptInvitationSchema = z.object({
  name: trimmed(80, "name"),
  password: passwordSchema,
});

export const quarantineReviewSchema = z.object({
  action: z.enum(["dismiss", "release"], {
    error: "action must be dismiss or release",
  }),
  providerKey: z.string().trim().toLowerCase().min(1).max(40).optional(),
});

export const messageStatusSchema = z.object({
  status: z.enum(["new", "used", "expired"], {
    error: "status must be new, used or expired",
  }),
});
