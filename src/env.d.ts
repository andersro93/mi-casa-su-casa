type TransactionalEmailMessage = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

type SendEmail = {
  send(
    message: TransactionalEmailMessage,
  ): Promise<{ messageId?: string } | undefined>;
};

interface Env {
  APP_NAME: string;
  APP_URL: string;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  DB: D1Database;
  EMAIL: SendEmail;
  ENVIRONMENT: string;
  NODE_ENV?: string;
  OUTBOUND_EMAIL_FROM: string;
  /** Domain of the inbound addresses (<slug>@EMAIL_DOMAIN); optional, display only. */
  EMAIL_DOMAIN?: string;
  OWNER_EMAIL?: string;
  SETUP_SECRET?: string;
}

declare module "*.css" {
  const css: string;
  export default css;
}
