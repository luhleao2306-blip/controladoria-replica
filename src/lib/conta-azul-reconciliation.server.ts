export type ReconciliationCompany = "w2" | "somus" | "lie" | "lie-design" | "d61";

export async function reconciliationTable(db: any) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS integration_reconciliations (
    company_key TEXT PRIMARY KEY, company_id TEXT NOT NULL, request_id TEXT NOT NULL,
    requested_at TEXT NOT NULL, run_id TEXT, completed_at TEXT, last_error TEXT
  )`).run();
}

export async function readReconciliation(db: any, company: ReconciliationCompany, companyId: string) {
  await reconciliationTable(db);
  return db.prepare("SELECT * FROM integration_reconciliations WHERE company_key=? AND company_id=?")
    .bind(company, companyId).first();
}

export async function requestReconciliation(db: any, company: ReconciliationCompany, companyId: string, requestId: string = crypto.randomUUID()) {
  await reconciliationTable(db);
  // An incremental update is shared by every tab; repeated clicks never duplicate work.
  const row = await db.prepare(`INSERT INTO integration_reconciliations
    (company_key,company_id,request_id,requested_at) VALUES (?,?,?,?)
    ON CONFLICT(company_key) DO UPDATE SET request_id=excluded.request_id,
      requested_at=excluded.requested_at,run_id=NULL,completed_at=NULL,last_error=NULL
    WHERE integration_reconciliations.completed_at IS NOT NULL
      AND integration_reconciliations.company_id=excluded.company_id
      AND integration_reconciliations.request_id<>excluded.request_id
    RETURNING *`).bind(company, companyId, requestId, new Date().toISOString()).first();
  const result = row ?? await readReconciliation(db, company, companyId);
  if (!result) throw new Error("A empresa da atualizacao mudou. Nenhum dado foi alterado.");
  return result;
}

const brasiliaClock = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric",
  month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

export function latestContaAzulDailyDate(now: Date) {
  const parts = Object.fromEntries(brasiliaClock.formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) >= 20 ? today : new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
}

export async function enqueueDailyReconciliation(db: any, company: ReconciliationCompany, companyId: string, now: Date) {
  const day = latestContaAzulDailyDate(now);
  // One durable watermark per company, separate from the queue shared with the manual refresh button.
  await db.prepare(`CREATE TABLE IF NOT EXISTS integration_daily_reconciliations (
    company_key TEXT PRIMARY KEY, company_id TEXT NOT NULL, local_date TEXT NOT NULL, queued_at TEXT NOT NULL
  )`).run();
  const marker = await db.prepare("SELECT company_id,local_date FROM integration_daily_reconciliations WHERE company_key=?")
    .bind(company).first();
  if (marker && marker.company_id !== companyId) throw new Error("A empresa da atualização diária mudou.");
  if (marker?.local_date >= day) return;
  const requestId = `daily:${day}`;
  const row = await requestReconciliation(db, company, companyId, requestId);
  // Let an outstanding manual run finish first. The next tick will try again.
  if (row.request_id !== requestId) return;
  await db.prepare(`INSERT INTO integration_daily_reconciliations (company_key,company_id,local_date,queued_at)
    VALUES (?,?,?,?) ON CONFLICT(company_key) DO UPDATE SET local_date=excluded.local_date,queued_at=excluded.queued_at
    WHERE integration_daily_reconciliations.company_id=excluded.company_id AND integration_daily_reconciliations.local_date<excluded.local_date`)
    .bind(company, companyId, day, now.toISOString()).run();
}
