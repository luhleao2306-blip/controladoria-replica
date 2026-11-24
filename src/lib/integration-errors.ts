export function integrationErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message) return error.message;
  return fallback;
}

export function isTransientIntegrationError(error: unknown) {
  const message = integrationErrorMessage(error, "");
  return /failed to fetch|fetch failed|network(?:error| request failed)|load failed|timed? ?out|timeout|temporar(?:y|ily)|connection (?:reset|closed|lost)|socket hang up|D1 DB is overloaded|\b(?:429|500|502|503|504)\b/i.test(message);
}
