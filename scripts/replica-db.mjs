import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const path = fileURLToPath(new URL('../.replica-local/operacional.sqlite', import.meta.url));

export function openReplicaDb() {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  return db;
}

export function replicaBindings() {
  const db = openReplicaDb();
  const execute = Symbol('execute');
  const prepare = (sql, values = []) => {
    const statement = db.prepare(sql);
    const run = () => { const { changes } = statement.run(...values); return { success: true, meta: { changes } }; };
    return {
      bind: (...args) => prepare(sql, args),
      first: async () => statement.get(...values) ?? null,
      all: async () => ({ results: statement.all(...values) }),
      run: async () => run(),
      [execute]: run,
    };
  };
  const batch = async statements => {
    db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(statement[execute]());
      db.exec('COMMIT');
      return results;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return { DB: { prepare, batch } };
}

export function seedReplicaStore(snapshot, companyIds, userId) {
  const settings = JSON.parse(readFileSync(new URL('../dados/configuracoes.json', import.meta.url), 'utf8'));
  const db = openReplicaDb();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS integration_imports (company_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, revenue_count INTEGER NOT NULL DEFAULT 0, expense_count INTEGER NOT NULL DEFAULT 0, revenue_done INTEGER NOT NULL DEFAULT 0, expense_done INTEGER NOT NULL DEFAULT 0, revenue_page INTEGER NOT NULL DEFAULT 0, expense_page INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS operational_settings (user_id TEXT NOT NULL, company TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, company));
      CREATE TABLE IF NOT EXISTS reporting_opening_balances (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, opening_date TEXT NOT NULL, amount_cents INTEGER NOT NULL, approved_at TEXT NOT NULL, note TEXT NOT NULL, UNIQUE(company_id, opening_date));
      BEGIN;
    `);
    const importRow = db.prepare("INSERT OR IGNORE INTO integration_imports(company_id,run_id,status,started_at,revenue_done,expense_done) VALUES (?,?,'completed',?,1,1)");
    for (const companyId of companyIds) importRow.run(companyId,randomUUID(),snapshot.finishedAt);
    const setting = db.prepare('INSERT OR IGNORE INTO operational_settings(user_id,company,payload,updated_at) VALUES (?,?,?,?)');
    for (const row of settings.operational) setting.run(userId,row.company,row.payload,row.updated_at);
    const balance = db.prepare('INSERT OR IGNORE INTO reporting_opening_balances VALUES (?,?,?,?,?,?)');
    for (const row of settings.openingBalances) balance.run(row.id,row.company_id,row.opening_date,row.amount_cents,row.approved_at,row.note);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
