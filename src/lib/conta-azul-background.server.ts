import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { contaAzulFirstDueDate, contaAzulIncrementalSince, CONTA_AZUL_SYNC_POLICY } from "@/lib/conta-azul-model";
import { enqueueDailyReconciliation, readReconciliation } from "@/lib/conta-azul-reconciliation.server";
import { contaAzulBackgroundOperations as operations, backgroundIntegrationSecurity as security } from "@/lib/conta-azul.functions";

type Session = { access_token: string; refresh_token: string; expires_at: number };
type Writer = { user_id: string; company_id: string; session_encrypted: string; progress_json: string | null };
type BackgroundCompany = "w2" | "somus" | "lie" | "lie-design" | "d61";
const WRITER_REFRESH_LEAD_MS = 180_000;
type Progress = {
  policyVersion?: number;
  reconciliationRequestId?: string;
  historicalAudit?: boolean;
  checkDeletions?: boolean;
  runId: string; startedAt: string; updatedSince?: string; full?: boolean; dueDateFrom?: string;
  phase: "catalog" | "revenue" | "expense" | "events" | "inventory-revenue" | "inventory-expense" | "inventory-compare" | "inventory-confirm" | "complete";
  page: number; window?: number; sequence?: number; hasNextWindow?: boolean; seen: string[]; expected: number | null;
  pendingIds: string[]; hasMore: boolean;
  imported: number; updated: number; skipped: number;
};

function environment(name: string) {
  const value = getRuntimeEnv()?.[name] ?? process.env[name];
  if (!value || typeof value !== "string") throw new Error("Atualizacao automatica ainda nao configurada.");
  return value;
}

export function backgroundOwnerAuthorized(request: Request) {
  const owner = environment("AUTOMATION_OWNER_EMAIL").trim().toLowerCase();
  return Boolean(request.headers.get("oai-authenticated-user-id"))
    && request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() === owner;
}

function sessionClient(accessToken?: string) {
  return createClient<Database>(environment("SUPABASE_URL"), environment("SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

function authorizationRequired() {
  return Object.assign(new Error("O acesso automatico precisa ser autorizado novamente. Os dados anteriores foram preservados."), { code: "authorization_required" });
}

async function verifiedRecoverySession(expectedUser: string, expectedCompany: string, previousToken: string): Promise<Session | null> {
  const value = getRuntimeEnv()?.AUTOMATION_W2_INITIAL_SESSION ?? process.env.AUTOMATION_W2_INITIAL_SESSION;
  if (typeof value !== "string") return null;
  try {
    const seed = JSON.parse(value);
    const candidate = seed.session as Session;
    if (seed.userId !== expectedUser || seed.companyId !== expectedCompany || !candidate?.refresh_token
      || !candidate.access_token || candidate.access_token === previousToken
      || candidate.expires_at * 1000 <= Date.now() + WRITER_REFRESH_LEAD_MS) return null;
    const verified = await sessionClient(candidate.access_token).auth.getUser(candidate.access_token);
    if (verified.error || verified.data.user?.id !== expectedUser) return null;
    const client = sessionClient(candidate.access_token);
    await security.requireIntegrationAdmin(client, expectedUser);
    if (await security.resolveIntegrationCompany(client, "w2") !== expectedCompany) return null;
    return candidate;
  } catch { return null; }
}

async function authenticatedWriter(db: any, company: BackgroundCompany) {
  let row = await db.prepare("SELECT * FROM integration_background_w2 WHERE key='w2'").first() as Writer | null;
  let session: Session;
  let expectedUser: string, expectedCompany: string;
  if (row) {
    session = JSON.parse(await security.decryptToken(row.session_encrypted));
    expectedUser = row.user_id;
    expectedCompany = row.company_id;
  } else {
    const seed = JSON.parse(environment("AUTOMATION_W2_INITIAL_SESSION"));
    session = seed.session;
    expectedUser = seed.userId;
    expectedCompany = seed.companyId;
  }
  if (!session?.refresh_token || !session.access_token || !expectedUser || !expectedCompany) throw new Error("Autorizacao automatica invalida.");
  if (session.expires_at * 1000 <= Date.now() + WRITER_REFRESH_LEAD_MS) {
    const result = await sessionClient().auth.refreshSession({ refresh_token: session.refresh_token });
    if (result.error || !result.data.session || result.data.user?.id !== expectedUser) {
      const recovery = await verifiedRecoverySession(expectedUser, expectedCompany, session.access_token);
      if (!recovery) throw authorizationRequired();
      session = recovery;
    } else {
      const next = result.data.session;
      session = { access_token: next.access_token, refresh_token: next.refresh_token, expires_at: next.expires_at! };
    }
    // Persist rotation before any subsequent network operation can fail.
    const encrypted = await security.encryptToken(JSON.stringify(session));
    if (row) await db.prepare("UPDATE integration_background_w2 SET session_encrypted=? WHERE key='w2' AND user_id=?")
      .bind(encrypted, expectedUser).run();
    else {
      await db.prepare("INSERT INTO integration_background_w2 (key,user_id,company_id,session_encrypted) VALUES ('w2',?,?,?)")
        .bind(expectedUser, expectedCompany, encrypted).run();
      row = { user_id: expectedUser, company_id: expectedCompany, session_encrypted: encrypted, progress_json: null };
    }
  }
  let supabase = sessionClient(session.access_token);
  // getUser checks server-side revocation, unlike a signature-only JWT check.
  const verified = await supabase.auth.getUser(session.access_token);
  let recovered = false;
  if (verified.error || verified.data.user?.id !== expectedUser) {
    const recovery = await verifiedRecoverySession(expectedUser, expectedCompany, session.access_token);
    if (!recovery) throw authorizationRequired();
    session = recovery;
    supabase = sessionClient(session.access_token);
    recovered = true;
  }
  await security.requireIntegrationAdmin(supabase, expectedUser);
  const authorizedW2 = await security.resolveIntegrationCompany(supabase, "w2");
  if (authorizedW2 !== expectedCompany) throw new Error("A empresa da autorizacao mudou. Nenhum dado foi importado.");
  if (recovered && row) {
    await db.prepare("UPDATE integration_background_w2 SET session_encrypted=? WHERE key='w2' AND user_id=? AND company_id=?")
      .bind(await security.encryptToken(JSON.stringify(session)), expectedUser, expectedCompany).run();
  }
  if (!row) {
    await db.prepare("INSERT INTO integration_background_w2 (key,user_id,company_id,session_encrypted) VALUES ('w2',?,?,?)")
      .bind(expectedUser, expectedCompany, await security.encryptToken(JSON.stringify(session))).run();
  }
  const companyId = company === "w2" ? authorizedW2 : await security.resolveIntegrationCompany(supabase, company);
  if (!companyId) throw new Error("Empresa de producao indisponivel para atualizacao automatica.");
  let progressJson = row?.progress_json;
  await db.prepare("INSERT INTO integration_background_jobs (key,user_id,company_id) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING")
    .bind(company, expectedUser, companyId).run();
  const job = await db.prepare("SELECT user_id,company_id,progress_json,last_full_sync_at,last_full_due_from FROM integration_background_jobs WHERE key=?").bind(company).first();
  if (job?.user_id !== expectedUser || job?.company_id !== companyId) throw new Error("A empresa da autorizacao automatica mudou. Nenhum dado foi importado.");
  if (company !== "w2") progressJson = job.progress_json;
  return { context: { supabase, userId: expectedUser }, companyId, lastFullSyncAt: job.last_full_sync_at as string | null,
    lastFullDueFrom: job.last_full_due_from as string | null,
    progress: progressJson ? JSON.parse(progressJson) as Progress : null };
}

async function saveProgress(db: any, progress: Progress | null, company: BackgroundCompany) {
  const table = company === "w2" ? "integration_background_w2" : "integration_background_jobs";
  await db.prepare(`UPDATE ${table} SET progress_json=? WHERE key=?`)
    .bind(progress ? JSON.stringify(progress) : null, company).run();
}

export async function runBackgroundW2(action: "status" | "step", company: BackgroundCompany = "w2", options: { maxSteps?: number; maxElapsedMs?: number; scheduleDaily?: boolean } = {}) {
  if (!["w2", "somus", "lie", "lie-design", "d61"].includes(company) || !["status", "step"].includes(action)) throw new Error("Atualizacao automatica invalida.");
  const db = await security.integrationDatabase();
  const owner = crypto.randomUUID();
  const stepKey = `background:company:${company}`;
  if (!await security.claimLease(db, stepKey, owner, 120_000)) return { status: "busy", retryAfterSeconds: 15 };
  try {
    // Serialize shared credential rotation, not unrelated companies' API work.
    if (!await security.claimLease(db, "background:w2", owner, 120_000)) return { status: "busy", retryAfterSeconds: 15 };
    let writer: Awaited<ReturnType<typeof authenticatedWriter>>;
    try { writer = await authenticatedWriter(db, company); }
    finally { await db.prepare("DELETE FROM integration_leases WHERE key='background:w2' AND owner=?").bind(owner).run(); }
    const { context, companyId } = writer;
    const connection = await operations.getContaAzulConnectionStatus({ context, data: { company } });
    if (connection.connection_status === "expired") throw Object.assign(new Error("Reconecte a Conta Azul desta empresa para retomar a atualização automática."), { code: "source_authorization_required" });
    if (connection.connection_status !== "connected") throw new Error("Conecte a conta de producao antes de ativar a atualizacao automatica.");
    if (action === "status") {
      const importProgress = connection.import_status === "running"
        ? await db.prepare("SELECT i.started_at,i.revenue_count,i.expense_count,i.revenue_page,i.expense_page,l.expires_at FROM integration_imports i LEFT JOIN integration_leases l ON l.owner=i.run_id AND l.key=? WHERE i.company_id=?")
          .bind(`import:${companyId}`, companyId).first() : null;
      return { status: "authorized", company: company === "d61" ? "D61" : company === "lie-design" ? "Liê Design" : company === "lie" ? "LIE ARQUITETURA" : company === "w2" ? "W2 Publicidade" : "Somus", lastSyncAt: connection.last_sync_at,
      lastFullSyncAt: writer.lastFullSyncAt, dueDateFrom: contaAzulFirstDueDate(company), lastFullDueFrom: writer.lastFullDueFrom,
      storedTransactions: connection.transaction_count, importStatus: connection.import_status, importProgress, backgroundPending: Boolean(writer.progress),
      importMode: writer.progress ? writer.progress.full ? "initial" : "incremental" : null, updatedSince: writer.progress?.updatedSince ?? null };
    }
    if (options.scheduleDaily) await enqueueDailyReconciliation(db, company, companyId, new Date());
    let progress = writer.progress;
    let retiredRun = false;
    const incrementalSince = contaAzulIncrementalSince(connection.last_sync_at);
    const legacyRun = progress && (progress.policyVersion !== CONTA_AZUL_SYNC_POLICY
      || (progress.historicalAudit && incrementalSince
        && !(company === "somus" && writer.lastFullDueFrom !== contaAzulFirstDueDate(company))));
    if (progress && (legacyRun || (company === "somus" && progress.dueDateFrom !== contaAzulFirstDueDate(company))
      || Date.now() - Date.parse(progress.startedAt) > (progress.full ? 360 : 60) * 60_000 || connection.import_status !== "running")) {
      await operations.failContaAzulSync({ context, data: { company, runId: progress.runId } });
      if (progress.reconciliationRequestId) await db.prepare("UPDATE integration_reconciliations SET run_id=NULL,last_error=NULL WHERE company_key=? AND company_id=? AND request_id=? AND completed_at IS NULL")
        .bind(company, companyId, progress.reconciliationRequestId).run();
      await saveProgress(db, null, company);
      progress = null;
      retiredRun = true;
    }
    if (!progress && !retiredRun && connection.import_status === "running") return { status: "busy", retryAfterSeconds: 30 };
    if (!progress) {
      const requested = await readReconciliation(db, company, companyId);
      const reconciliationRequestId = requested && !requested.completed_at ? String(requested.request_id) : undefined;
      // Leave a stable read window; an explicit update takes priority.
      await db.prepare("CREATE TABLE IF NOT EXISTS integration_scheduler_status (company_key TEXT PRIMARY KEY, last_tick_at TEXT NOT NULL, last_completed_at TEXT, status TEXT NOT NULL, error_code TEXT)").run();
      const lastCompleted = await db.prepare("SELECT last_completed_at FROM integration_scheduler_status WHERE company_key=?").bind(company).first();
      const cutoffChanged = company === "somus" && writer.lastFullDueFrom !== contaAzulFirstDueDate(company);
      if (!reconciliationRequestId && !cutoffChanged && lastCompleted?.last_completed_at
        && Date.now() - Date.parse(lastCompleted.last_completed_at) < 90_000) {
        return { status: "up_to_date", lastSyncAt: connection.last_sync_at };
      }
      const inventory = await operations.getContaAzulInventoryStatus({ context, data: { company } });
      const checkedAt = Date.parse(inventory.checkedAt ?? "");
      const checkDeletions = Boolean(reconciliationRequestId) || !Number.isFinite(checkedAt) || checkedAt > Date.now() + 60000 || Date.now() - checkedAt >= 6 * 3600000;
      const job = await operations.beginContaAzulSync({ context, data: { company } });
      // An expanded due-date scope requires historical backfill, even after a recent sync.
      const full = !incrementalSince || cutoffChanged;
      progress = { ...job, policyVersion: CONTA_AZUL_SYNC_POLICY, reconciliationRequestId, checkDeletions, full, dueDateFrom: contaAzulFirstDueDate(company), updatedSince: full ? undefined : incrementalSince,
        phase: "catalog", page: 1, seen: [], expected: null, pendingIds: [], hasMore: false, imported: 0, updated: 0, skipped: 0 };
      await saveProgress(db, progress, company);
      if (reconciliationRequestId) await db.prepare("UPDATE integration_reconciliations SET run_id=?,last_error=NULL WHERE company_key=? AND company_id=? AND request_id=? AND completed_at IS NULL")
        .bind(job.runId, company, companyId, reconciliationRequestId).run();
      // Scheduled requests can continue immediately; manual one-step calls stay resumable.
      if ((options.maxSteps ?? 1) <= 1) return { status: "continue", phase: "catalog" };
    }
    const input = { company, runId: progress.runId };
    try {
      const started = Date.now();
      const maxSteps = Math.min(8, Math.max(1, options.maxSteps ?? (progress.full ? 4 : 1)));
      const maxElapsedMs = Math.min(45_000, Math.max(1000, options.maxElapsedMs ?? 25_000));
      for (let step = 0; step < maxSteps; step++) {
      if (progress.phase === "catalog") {
        await operations.syncContaAzulW2Catalog({ context, data: { company, incremental: !progress.full } });
        progress.phase = "revenue";
      } else if (progress.phase === "complete") {
        await operations.completeContaAzulW2Sync({ context, data: { ...input, startedAt: progress.startedAt } });
        if (progress.full) await db.prepare("UPDATE integration_background_jobs SET last_full_sync_at=?,last_full_due_from=? WHERE key=?")
          .bind(progress.startedAt, progress.dueDateFrom, company).run();
        if (progress.reconciliationRequestId) await db.prepare("UPDATE integration_reconciliations SET completed_at=?,last_error=NULL WHERE company_key=? AND company_id=? AND request_id=? AND run_id=?")
          .bind(new Date().toISOString(), company, companyId, progress.reconciliationRequestId, progress.runId).run();
        await saveProgress(db, null, company);
        const count = await context.supabase.from("financial_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId);
        if (count.error) throw new Error("Importacao concluida, mas a confirmacao da quantidade esta indisponivel.");
        return { status: "completed", lastSyncAt: progress.startedAt, storedTransactions: count.count,
          imported: progress.imported, updated: progress.updated, unchanged: progress.skipped };
      } else if (progress.phase === "events") {
        if (progress.pendingIds.length) {
          const ids = progress.pendingIds.slice(0, 5);
          const result = await operations.syncContaAzulChangedEvents({ context, data: { ...input, ids } });
          progress.updated += result.updated; progress.skipped += result.skipped;
          progress.pendingIds.splice(0, ids.length);
          if (!progress.pendingIds.length) advanceEventPage(progress);
        } else {
          if (progress.page > 1000 || !progress.updatedSince) throw new Error("Periodo de alteracoes financeiras invalido.");
          const result = await operations.getContaAzulChangedEvents({ context, data: { company, page: progress.page,
            window: progress.window, updatedSince: progress.updatedSince, updatedUntil: progress.startedAt } });
          if (progress.expected !== null && progress.expected !== result.reportedTotal) throw new Error("O total de eventos alterados mudou durante a importacao.");
          progress.expected = result.reportedTotal;
          const seen = new Set(progress.seen);
          for (const id of result.ids) {
            if (seen.has(id)) throw new Error("A API repetiu eventos alterados em paginas diferentes.");
            seen.add(id);
          }
          progress.seen = [...seen]; progress.pendingIds = [...result.ids]; progress.hasMore = result.hasMore;
          progress.hasNextWindow = result.hasNextWindow;
          if (!result.hasMore && seen.size !== result.reportedTotal) throw new Error("A quantidade de eventos alterados nao confere com a API.");
          if (!result.ids.length) advanceEventPage(progress);
        }
      } else if (progress.phase === "inventory-revenue" || progress.phase === "inventory-expense") {
        const result = await operations.scanContaAzulInventoryPage({ context, data: { ...input,
          type: progress.phase === "inventory-revenue" ? "revenue" : "expense", page: progress.page, window: progress.window } });
        if (result.hasMore) progress.page++;
        else if (result.hasNextWindow) advanceWindow(progress);
        else { progress.phase = progress.phase === "inventory-revenue" ? "inventory-expense" : "inventory-compare"; progress.page = 1; progress.window = 0; }
      } else if (progress.phase === "inventory-compare") {
        const result = await operations.getContaAzulInventoryCandidates({ context, data: input });
        progress.pendingIds = [...result.ids];
        if (result.ids.length) progress.phase = "inventory-confirm";
        else { await operations.completeContaAzulInventory({ context, data: input }); progress.phase = "complete"; }
      } else if (progress.phase === "inventory-confirm") {
        const ids = progress.pendingIds.slice(0, 40);
        const result = await operations.quarantineContaAzulW2Missing({ context, data: { ...input, ids, inventory: true } });
        if (result.archived.length + result.retained.length !== ids.length) throw new Error("A confirmacao das parcelas ausentes nao foi concluida.");
        progress.updated += result.archived.length;
        progress.pendingIds.splice(0, ids.length);
        if (!progress.pendingIds.length) { await operations.completeContaAzulInventory({ context, data: input }); progress.phase = "complete"; }
      } else if (progress.pendingIds.length) {
        const ids = progress.pendingIds.slice(0, 100);
        const detail = await operations.enrichContaAzulW2Batch({ context, data: { ...input, ids, force: false } });
        if (detail.errors.length || detail.enriched + detail.cached !== detail.requested) throw new Error("Detalhes incompletos na Conta Azul; a importacao nao foi confirmada.");
        progress.pendingIds.splice(0, ids.length);
        if (!progress.pendingIds.length) advancePage(progress);
      } else {
        if (progress.page > 1000) throw new Error("Limite de paginas atingido sem confirmar a importacao.");
        const sequence = (progress.sequence ?? 0) + 1;
        const page = await operations.syncContaAzulW2Page({ context, data: { ...input, type: progress.phase, page: progress.page, window: progress.window, sequence,
          updatedSince: progress.updatedSince, updatedUntil: progress.startedAt } });
        progress.sequence = sequence;
        if (page.reportedTotal !== null) {
          if (progress.expected !== null && progress.expected !== page.reportedTotal) throw new Error("O total da API mudou durante a importacao.");
          progress.expected = page.reportedTotal;
        }
        const seen = new Set(progress.seen);
        for (const id of page.externalIds) {
          if (seen.has(id)) throw new Error("A API repetiu parcelas em paginas diferentes.");
          seen.add(id);
        }
        progress.seen = [...seen];
        progress.imported += page.imported; progress.updated += page.updated; progress.skipped += page.skipped;
        progress.pendingIds = page.detailIds;
        progress.hasMore = page.hasMore;
        progress.hasNextWindow = page.hasNextWindow;
        if (!progress.pendingIds.length) advancePage(progress);
      }
      await saveProgress(db, progress, company);
      if (Date.now() - started >= maxElapsedMs) break;
      }
      return { status: "continue", phase: progress.phase, page: progress.page, pendingDetails: progress.pendingIds.length };
    } catch (error) {
      // Last successful watermark and complete financial rows remain intact.
      await operations.failContaAzulSync({ context, data: input });
      if (progress.reconciliationRequestId) await db.prepare("UPDATE integration_reconciliations SET run_id=NULL,last_error='source_retry_pending' WHERE company_key=? AND company_id=? AND request_id=? AND completed_at IS NULL")
        .bind(company, companyId, progress.reconciliationRequestId).run();
      await saveProgress(db, null, company);
      throw error;
    }
  } finally {
    await db.prepare("DELETE FROM integration_leases WHERE key=? AND owner=?").bind(stepKey, owner).run();
  }
}

function advancePage(progress: Progress) {
  if (progress.hasMore) { progress.page++; return; }
  if (progress.expected !== null && progress.seen.length !== progress.expected) throw new Error("A quantidade importada nao confere com a API.");
  if (progress.hasNextWindow) { advanceWindow(progress); return; }
  if (progress.phase === "revenue") progress.phase = "expense";
  else if (progress.updatedSince) progress.phase = "events";
  else advanceToInventory(progress);
  progress.page = 1; progress.window = 0; progress.sequence = 0; progress.seen = []; progress.expected = null;
}

function advanceWindow(progress: Progress) {
  progress.window = (progress.window ?? 0) + 1;
  progress.page = 1;
  progress.seen = [];
  progress.expected = null;
}

function advanceEventPage(progress: Progress) {
  if (progress.hasMore) progress.page++;
  else if (progress.hasNextWindow) advanceWindow(progress);
  else advanceToInventory(progress);
}

function advanceToInventory(progress: Progress) {
  progress.phase = progress.checkDeletions ? "inventory-revenue" : "complete";
  progress.page = 1; progress.window = 0; progress.seen = []; progress.expected = null; progress.pendingIds = [];
}
