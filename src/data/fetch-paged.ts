import type { SupabaseClient } from "@supabase/supabase-js";

export async function fetchAllRows<T>(client: SupabaseClient, table: string): Promise<T[]> {
  const pageSize = 1000;
  const readPage = async (from: number, counted = false) => {
    for (let attempt = 0; ; attempt++) {
    const result = await client.from(table)
      .select("*", counted ? { count: "exact" } : undefined)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1)
      .abortSignal(AbortSignal.timeout(15_000));
    if (result.error) {
      const transient = [408, 429, 500, 502, 503, 504].includes(result.status) ||
        result.error.code === "57014" || /timeout|timed out|fetch failed|failed to fetch|abort/i.test(result.error.message ?? "");
      if (!transient || attempt >= 2) throw result.error;
      await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    return { rows: (result.data ?? []) as T[], count: result.count };
    }
  };
  const first = await readPage(0, true);
  const rows = [...first.rows];
  if (first.count !== null) {
    // Four ordered pages at a time reduce latency without flooding the API.
    for (let from = pageSize; from < first.count; from += pageSize * 4) {
      const offsets = Array.from({ length: 4 }, (_, i) => from + i * pageSize)
        .filter((offset) => offset < first.count!);
      const pages = await Promise.all(offsets.map((offset) => readPage(offset)));
      for (const page of pages) rows.push(...page.rows);
    }
    if (rows.length !== first.count) throw new Error(`A carga de ${table} mudou durante a leitura. Tente novamente.`);
  } else if (first.rows.length === pageSize) {
    for (let from = pageSize; ; from += pageSize) {
      const page = await readPage(from);
      rows.push(...page.rows);
      if (page.rows.length < pageSize) break;
    }
  }
  return rows;
}
