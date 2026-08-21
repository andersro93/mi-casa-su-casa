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
