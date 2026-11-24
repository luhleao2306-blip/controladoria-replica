export async function packFinancialRead<T>(value: T, compact = false, compression?: "gzip"): Promise<T | { compactData: string; compression?: "gzip" }> {
  if (!compact) return value;
  const json = JSON.stringify(value);
  if (compression !== "gzip") return { compactData: json };
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return { compactData: btoa(chunks.join("")), compression: "gzip" };
}

export async function unpackFinancialRead<T>(value: T): Promise<Exclude<T, { compactData: string }>> {
  if (value && typeof value === "object" && "compactData" in value) {
    if (typeof value.compactData !== "string") throw new Error("Leitura financeira compacta invalida.");
    let json = value.compactData;
    if ("compression" in value && value.compression === "gzip") {
      const binary = atob(value.compactData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    }
    const result = JSON.parse(json);
    if (!result || typeof result !== "object" || !Array.isArray(result.metadata)) {
      throw new Error("Leitura financeira compacta incompleta.");
    }
    return result;
  }
  return value as Exclude<T, { compactData: string }>;
}
