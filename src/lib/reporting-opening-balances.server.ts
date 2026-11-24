import type { ApprovedOpeningBalance } from "./conta-azul-opening-balances";

// Opening balances are supplied by the private snapshot on each installation.
export async function readApprovedOpeningBalances(db: any, _company: string, companyId: string): Promise<ApprovedOpeningBalance[]> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS reporting_opening_balances (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, opening_date TEXT NOT NULL,
    amount_cents INTEGER NOT NULL, approved_at TEXT NOT NULL, note TEXT NOT NULL,
    UNIQUE(company_id, opening_date)
  )`).run();
  const { results } = await db.prepare("SELECT * FROM reporting_opening_balances WHERE company_id=? ORDER BY opening_date")
    .bind(companyId).all();
  return results.map((row: { id: string; opening_date: string; amount_cents: number; approved_at: string; note: string }) =>
    ({ id: row.id, companyId, date: row.opening_date, amountCents: row.amount_cents, approvedAt: row.approved_at, note: row.note }));
}

export function approvedOpeningRevision(rows: ApprovedOpeningBalance[]) {
  return rows.map(row => `${row.id}:${row.date}:${row.amountCents}`).sort().join("|");
}
