import { beginContaAzulSync, failContaAzulSync, syncContaAzulW2Page, enrichContaAzulW2Batch, syncContaAzulW2Catalog, completeContaAzulW2Sync, getContaAzulChangedEvents, syncContaAzulChangedEvents, getContaAzulInventoryStatus, scanContaAzulInventoryPage, getContaAzulInventoryCandidates, quarantineContaAzulW2Missing, completeContaAzulInventory } from "@/lib/conta-azul.functions";
import { integrationErrorMessage } from "@/lib/integration-errors";

export type ContaAzulCompany = "w2" | "d61" | "somus" | "lie" | "lie-design";
export type SyncProgress = { phase: "starting" | "waiting" | "catalog" | "revenue" | "expense" | "details" | "verifying"; received: number; paid: number; page: number };
type SyncTotals = { received: number; paid: number; imported: number; updated: number; skipped: number };
type SyncOptions = { updatedSince?: string; onProgress?: (progress: SyncProgress) => void };
type ActiveSync = { request: Promise<SyncTotals>; updatedSince?: string; progress?: SyncProgress; listeners: Set<NonNullable<SyncOptions["onProgress"]>> };
const running = new Map<ContaAzulCompany, ActiveSync>();

export function syncContaAzulCompany(company: ContaAzulCompany, options: SyncOptions = {}) {
  if (typeof window === "undefined") throw new Error("Abra a plataforma para sincronizar a empresa.");
  const active = running.get(company);
  if (active && (options.updatedSince !== undefined || active.updatedSince === undefined)) {
    if (options.onProgress) {
      active.listeners.add(options.onProgress);
      if (active.progress) options.onProgress(active.progress);
    }
    return active.request;
  }
  const entry: ActiveSync = { request: null!, updatedSince: options.updatedSince, listeners: new Set(options.onProgress ? [options.onProgress] : []) };
  const onProgress = (value: SyncProgress) => {
    entry.progress = value;
    for (const listener of entry.listeners) listener(value);
  };
  const start = () => runSync(company, { ...options, onProgress });
  // A full reconciliation must not reuse the smaller background update.
  if (active) onProgress({ phase: "waiting", received: 0, paid: 0, page: 0 });
  const request = (active ? active.request.catch(() => undefined).then(start) : start()).finally(() => {
    if (running.get(company) === entry) running.delete(company);
  });
  entry.request = request;
  running.set(company, entry);
  return request;
}

async function runSync(company: ContaAzulCompany, options: SyncOptions) {
  const totals = { received: 0, paid: 0, imported: 0, updated: 0, skipped: 0 };
  options.onProgress?.({ phase: "starting", received: 0, paid: 0, page: 0 });
  const job = await beginContaAzulSync({ data: { company } });
  const progress = (phase: SyncProgress["phase"], page = 0) => options.onProgress?.({ phase, page, received: totals.received, paid: totals.paid });
  try {
    progress("catalog");
    await syncContaAzulW2Catalog({ data: { company, incremental: Boolean(options.updatedSince) } });
    for (const type of ["revenue", "expense"] as const) {
      let expectedTotal: number | null = null;
      const seen = new Set<string>();
      let completed = false;
      let page = 1, window = 0;
      for (let sequence = 1; sequence <= 1000; sequence++) {
        progress(type, page);
        const result = await syncContaAzulW2Page({ data: { company, runId: job.runId, type, page, window, sequence, updatedSince: options.updatedSince, updatedUntil: job.startedAt } });
        if (result.reportedTotal !== null) {
          if (expectedTotal !== null && expectedTotal !== result.reportedTotal) throw new Error("A quantidade de registros mudou durante a leitura da Conta Azul. Reinicie a conferência.");
          expectedTotal = result.reportedTotal;
        }
        for (const id of result.externalIds) {
          if (seen.has(id)) throw new Error("A API repetiu registros em páginas diferentes. A importação não foi confirmada.");
          seen.add(id);
        }
        if (type === "revenue") totals.received += result.received;
        else totals.paid += result.received;
        totals.imported += result.imported;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
        progress("details", page);
        for (let offset = 0; offset < result.detailIds.length; offset += 120) {
          const detail = await enrichContaAzulW2Batch({ data: { company, runId: job.runId, ids: result.detailIds.slice(offset, offset + 120) } });
          if (detail.errors.length) throw new Error(`${detail.errors.length} parcelas com detalhes pendentes: ${detail.errors[0].message}`);
          if (detail.enriched + detail.cached !== detail.requested) throw new Error("Nem todos os detalhes solicitados foram conferidos.");
        }
        if (!result.hasMore) {
          if (expectedTotal !== null && seen.size !== expectedTotal) throw new Error("A quantidade importada não confere com o total da Conta Azul.");
          if (result.hasNextWindow) { window++; page = 1; expectedTotal = null; seen.clear(); continue; }
          completed = true;
          break;
        }
        page++;
      }
      if (!completed) throw new Error("Limite de páginas atingido sem confirmar o fim dos registros. A sincronização não foi concluída.");
    }
    progress("verifying");
    if (options.updatedSince) {
      const seen = new Set<string>();
      let expected: number | null = null, completed = false;
      let page = 1, window = 0;
      for (let step = 0; step < 1000; step++) {
        const events = await getContaAzulChangedEvents({ data: { company, page, window, updatedSince: options.updatedSince, updatedUntil: job.startedAt } });
        if (expected !== null && expected !== events.reportedTotal) throw new Error("A quantidade de eventos alterados mudou durante a leitura.");
        expected = events.reportedTotal;
        for (const id of events.ids) {
          if (seen.has(id)) throw new Error("A API repetiu eventos alterados.");
          seen.add(id);
        }
        for (let start = 0; start < events.ids.length; start += 5) {
          const result = await syncContaAzulChangedEvents({ data: { company, runId: job.runId, ids: events.ids.slice(start, start + 5) } });
          totals.updated += result.updated; totals.skipped += result.skipped;
        }
        if (!events.hasMore) {
          if (seen.size !== expected) throw new Error("A quantidade de eventos alterados nao confere com a API.");
          if (events.hasNextWindow) { window++; page = 1; expected = null; seen.clear(); continue; }
          completed = true; break;
        }
        page++;
      }
      if (!completed) throw new Error("A consulta de eventos alterados nao foi concluida.");
    }
    const inventory = await getContaAzulInventoryStatus({ data: { company } });
    const checkedAt = Date.parse(inventory.checkedAt ?? "");
    if (!options.updatedSince || !Number.isFinite(checkedAt) || checkedAt > Date.now() + 60000 || Date.now() - checkedAt >= 6 * 3600000) {
      for (const type of ["revenue", "expense"] as const) {
        let completed = false;
        let page = 1, window = 0;
        for (let step = 0; step < 1000; step++) {
          const result = await scanContaAzulInventoryPage({ data: { company, runId: job.runId, type, page, window } });
          if (result.hasMore) page++;
          else if (result.hasNextWindow) { window++; page = 1; }
          else { completed = true; break; }
        }
        if (!completed) throw new Error("O inventario de exclusoes nao foi concluido.");
      }
      const candidates = await getContaAzulInventoryCandidates({ data: { company, runId: job.runId } });
      for (let start = 0; start < candidates.ids.length; start += 40) {
        const ids = candidates.ids.slice(start, start + 40);
        const result = await quarantineContaAzulW2Missing({ data: { company, runId: job.runId, ids, inventory: true } });
        if (result.archived.length + result.retained.length !== ids.length) throw new Error("A confirmacao de exclusoes nao foi concluida.");
        totals.updated += result.archived.length;
      }
      await completeContaAzulInventory({ data: { company, runId: job.runId } });
    }
    await completeContaAzulW2Sync({ data: { company, ...job } });
    return totals;
  } catch (error) {
    await failContaAzulSync({ data: { company, runId: job.runId } }).catch(() => {});
    throw new Error(integrationErrorMessage(error, "A importação não foi concluída. Os dados anteriores foram preservados."));
  }
}

export async function syncContaAzulW2Incremental(updatedSince?: string) {
  if (running.has("w2")) return null;
  return syncContaAzulCompany("w2", { updatedSince });
}
