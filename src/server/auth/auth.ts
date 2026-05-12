import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, twoFactor } from "better-auth/plugins";

import { dbForEnv } from "../db/client";
import * as schema from "../db/schema";
import { sendPasswordResetEmail } from "../email/sender";

function getRpId(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export function authForEnv(env: Env) {
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
      disableSignUp: true,
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
      admin({
        adminRoles: ["admin"],
        defaultRole: "user",
      }),
      twoFactor(),
      passkey({
        rpID: getRpId(env.APP_URL),
        rpName: env.APP_NAME,
      }),
    ],
  });
}
