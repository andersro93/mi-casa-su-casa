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
        void sendPasswordResetEmail(env, {
          to: user.email,
          recipientName: user.name,
          resetUrl: url,
        });
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
    advanced: {
      database: {
        generateId: "uuid",
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
