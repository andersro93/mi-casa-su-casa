import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";

import { dbForEnv } from "../db/client";
import * as schema from "../db/schema";
import { sendPasswordResetEmail } from "../email/sender";

function getRpId(url: string) {
  // APP_URL is validated at the edge (see runtime/env.ts); a bad value here
  // must not silently bind passkeys to "localhost".
  return new URL(url).hostname;
}

export function authForEnv(env: Env) {
  return createAuth(env, { disableSignUp: true });
}

export function provisioningAuthForEnv(env: Env) {
  return createAuth(env, { disableSignUp: false });
}

function createAuth(env: Env, options: { disableSignUp: boolean }) {
  return betterAuth({
    appName: "Mi Casa Su Casa",
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    secret: env.AUTH_SECRET,
    database: drizzleAdapter(dbForEnv(env), {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: options.disableSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => {
        try {
          await sendPasswordResetEmail(env, {
            to: user.email,
            recipientName: user.name,
            resetUrl: url,
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "password_reset_email_failed",
              userId: user.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: false,
        },
      },
    },
    // Workers never set NODE_ENV, so Better Auth would otherwise leave rate
    // limiting off; memory storage is per-isolate, so persist counters in D1.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 5 * 60, max: 3 },
        "/reset-password": { window: 5 * 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
        "/sign-in/passkey": { window: 60, max: 10 },
      },
    },
    advanced: {
      database: {
        generateId: "uuid",
      },
      ipAddress: {
        // Set by Cloudflare on every request; not client-spoofable.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    plugins: [
      twoFactor(),
      passkey({
        rpID: getRpId(env.APP_URL),
        rpName: env.APP_NAME,
      }),
    ],
  });
}
