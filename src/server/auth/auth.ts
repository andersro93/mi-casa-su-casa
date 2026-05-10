import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

import { dbForEnv } from "../db/client";
import * as schema from "../db/schema";

export function authForEnv(env: Env) {
  return betterAuth({
    appName: "Mi Casa Su Casa",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(dbForEnv(env), {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
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
    ],
  });
}
