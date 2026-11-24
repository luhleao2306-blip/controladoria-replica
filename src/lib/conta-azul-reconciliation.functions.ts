import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertCompanyAccess } from "@/lib/platform-access.functions";
import { backgroundIntegrationSecurity as security, contaAzulBackgroundOperations as operations } from "@/lib/conta-azul.functions";
import { readReconciliation, requestReconciliation } from "@/lib/conta-azul-reconciliation.server";

const input = (value: unknown) => z.object({ company: z.enum(["w2", "somus", "lie", "lie-design", "d61"]) }).strict().parse(value);

async function contextFor(context: any, company: "w2" | "somus" | "lie" | "lie-design" | "d61") {
  await assertCompanyAccess(context, company);
  const companyId = await security.resolveIntegrationCompany(context.supabase, company);
  if (!companyId) throw new Error("Empresa nao encontrada.");
  return { db: await security.integrationDatabase(), companyId };
}

export const requestContaAzulReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(input)
  .handler(async ({ context, data }) => {
    const { db, companyId } = await contextFor(context, data.company);
    const connection = await operations.getContaAzulConnectionStatus({ context, data });
    if (connection.connection_status === "expired") throw new Error("Reconecte a Conta Azul desta empresa para retomar a atualização automática.");
    if (!connection.server_sync_enabled || connection.connection_status !== "connected") {
      throw new Error("Conecte a empresa e ative a atualizacao no servidor antes de conferir a API.");
    }
    const row = await requestReconciliation(db, data.company, companyId);
    return { requestId: String(row.request_id), status: row.run_id ? "running" : "queued" };
  });

export const getContaAzulReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth]).inputValidator(input)
  .handler(async ({ context, data }) => {
    const { db, companyId } = await contextFor(context, data.company);
    const row = await readReconciliation(db, data.company, companyId);
    const job = row?.run_id ? await db.prepare("SELECT status,revenue_count,expense_count FROM integration_imports WHERE company_id=? AND run_id=?")
      .bind(companyId, row.run_id).first() : null;
    await db.prepare("CREATE TABLE IF NOT EXISTS integration_scheduler_status (company_key TEXT PRIMARY KEY, last_tick_at TEXT NOT NULL, last_completed_at TEXT, status TEXT NOT NULL, error_code TEXT)").run();
    const scheduler = await db.prepare("SELECT status,error_code FROM integration_scheduler_status WHERE company_key=?").bind(data.company).first();
    const blocked = ["authorization_required", "source_authorization_required", "source_configuration_error"].includes(String(scheduler?.error_code));
    if (!row) return { requestId: null, status: blocked ? "blocked" : "idle", checked: 0, completedAt: null, phase: null as string | null, eventProgress: null as { checked: number; total: number } | null };
    const retrying = row.last_error || scheduler?.status === "error" || job?.status === "failed";
    let phase: string | null = null, eventProgress: { checked: number; total: number } | null = null;
    if (row.run_id && !row.completed_at) {
      const background = await db.prepare("SELECT progress_json FROM integration_background_jobs WHERE key=? AND company_id=?")
        .bind(data.company, companyId).first();
      try {
        const progress = JSON.parse(background?.progress_json ?? "null");
        if (progress?.runId === row.run_id && ["catalog", "revenue", "expense", "events", "inventory-revenue", "inventory-expense", "inventory-compare", "inventory-confirm", "complete"].includes(progress.phase)) {
          phase = progress.phase;
          if (phase === "events" && Array.isArray(progress.seen) && Array.isArray(progress.pendingIds) && Number.isSafeInteger(progress.expected) && progress.expected >= 0) {
            eventProgress = { checked: Math.max(0, progress.seen.length - progress.pendingIds.length), total: progress.expected };
          }
        }
      } catch { /* An unavailable progress summary cannot confirm or cancel an import. */ }
    }
    return { requestId: String(row.request_id),
      status: row.completed_at ? "completed" : blocked ? "blocked" : retrying ? "retrying" : row.run_id ? "running" : "queued",
      checked: Number(job?.revenue_count ?? 0) + Number(job?.expense_count ?? 0),
      phase, eventProgress,
      completedAt: row.completed_at ? String(row.completed_at) : null };
  });
