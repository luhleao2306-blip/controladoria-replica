export const AUTH_UNAVAILABLE = "O serviço de acesso demorou para responder. Tente entrar novamente em alguns instantes.";

// Permission checks are read-only: one bounded retry still fails closed when
// the authoritative server cannot confirm access. No prior permission is reused.
export async function retryAccessRead<T>(operation: () => Promise<T>): Promise<T> {
  try { return await withAuthTimeout(operation(), 25000); }
  catch {
    await new Promise(resolve => setTimeout(resolve, 250));
    return withAuthTimeout(operation(), 25000);
  }
}

// Only password sign-in is retried. Refresh tokens and recovery emails must not
// be replayed here, and invalid credentials must never cause extra attempts.
export async function retryPasswordSignIn<T extends { error?: unknown }>(operation: () => Promise<T>): Promise<T> {
  const transient = (error: unknown) => {
    const status = Number((error as { status?: number })?.status);
    const name = (error as { name?: string })?.name;
    return status >= 500 || name === "AuthRetryableFetchError" || name === "TimeoutError" || error instanceof TypeError;
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await operation();
      if (attempt || !result.error || !transient(result.error)) return result;
    } catch (error) {
      if (attempt || !transient(error)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

export async function withAuthTimeout<T>(operation: PromiseLike<T>, milliseconds = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(AUTH_UNAVAILABLE)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos. Confira o e-mail usado no cadastro.";
  if (Number((error as { status?: number })?.status) >= 500) return AUTH_UNAVAILABLE;
  if (/timeout|timed out|fetch|network|abort|context|unexpected|lock|demorou/i.test(message)) return AUTH_UNAVAILABLE;
  return message || "Não foi possível entrar. Tente novamente.";
}
