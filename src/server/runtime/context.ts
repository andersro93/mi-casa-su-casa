import type { AppVariables } from "../auth/middleware";

export type AppContext = {
  env: Env;
  executionContext: ExecutionContext;
};

export function createAppContext(
  env: Env,
  executionContext: ExecutionContext,
): AppContext {
  return { env, executionContext };
}

export type RouteAppContext = AppVariables & {
  env: Env;
};
