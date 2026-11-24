let currentEnv: Record<string, any> | null = null;

export function resolveRequestEnv(request: Request, explicitEnv?: unknown) {
  // Nitro forwards only the Request to the SSR service, with bindings attached
  // to its runtime. Direct Worker execution supplies them as the second argument.
  return explicitEnv ?? (request as Request & { runtime?: { cloudflare?: { env?: unknown } } }).runtime?.cloudflare?.env;
}

export function setRuntimeEnv(env: unknown) {
  currentEnv = (env ?? null) as Record<string, any> | null;
}

export function getRuntimeEnv<T extends Record<string, any> = Record<string, any>>() {
  return currentEnv as T | null;
}
