type SendEmail = {
  send(message: EmailMessage): Promise<void>;
};

interface Env {
  APP_NAME: string;
  APP_URL: string;
  ASSETS: Fetcher;
  AUTH_SECRET: string;
  DB: D1Database;
  EMAIL: SendEmail;
  ENVIRONMENT: string;
  OWNER_EMAIL?: string;
  SETUP_SECRET?: string;
}

declare module "*.css" {
  const css: string;
  export default css;
}
