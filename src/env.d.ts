type SendEmail = {
  send(message: EmailMessage): Promise<void>;
};

interface Env {
  APP_NAME: string;
  APP_ORIGIN: string;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  DB: D1Database;
  EMAIL: SendEmail;
  ENVIRONMENT: string;
  OWNER_EMAIL?: string;
}

declare module "*.css" {
  const css: string;
  export default css;
}
