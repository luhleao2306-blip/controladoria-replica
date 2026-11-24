const CHUNK_ERROR_PATTERNS = [
  "dynamically imported module",
  "importing a module script failed",
  "chunkloaderror",
  "loading chunk",
  "loading css chunk",
  "failed to fetch dynamically",
  "unexpected token '<'",
];

export function isStaleAssetError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const normalized = message.toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}
