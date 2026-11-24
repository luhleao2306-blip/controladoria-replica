// Verification timestamps change on every API read, not on financial changes.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const entries = value.map(canonical);
    if (entries.length && entries.every((entry) => entry && typeof entry === "object" && "id" in entry)) {
      entries.sort((a, b) => String((a as { id: unknown }).id).localeCompare(String((b as { id: unknown }).id)));
    }
    return entries;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["verifiedAt", "readRevision", "confirmedAt", "savedView"].includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function snapshotSignature(sources: { company: string; snapshot: object }[]) {
  return JSON.stringify(canonical([...sources].sort((a, b) => a.company.localeCompare(b.company))));
}
