import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCompanyAccess } from "./platform-access.functions";
import { replicaApiUrl } from "./replica-url";

const D61_URL = replicaApiUrl;
const D61_TABLES = [
  "companies",
  "categorias",
  "centros_de_custo",
  "pessoas",
  "financial_transactions",
  "receitas",
  "despesas",
  "vendas",
  "contratos",
  "bem",
  "kpi_snapshots",
  "budget_targets",
] as const;

async function fetchAllD61(table: string) {
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Conexao D61 nao configurada no servidor.");
  const pageSize = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(
      `${D61_URL}/rest/v1/${table}?select=*&order=id.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Range: `${from}-${from + pageSize - 1}`,
          "Range-Unit": "items",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) throw new Error(`D61 ${table} ${res.status}: ${await res.text()}`);
    const batch = (await res.json()) as any[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export const getD61Data = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await assertCompanyAccess(context, "d61");
  const entries = await Promise.all(
    D61_TABLES.map(async (table) => {
      const rows = await fetchAllD61(table);
      return [table, rows] as const;
    }),
  );
  return Object.fromEntries(entries);
});
