import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { EMPTY_SETTINGS, operationalSettingsSchema } from "./operational-settings";
import { assertCompanyAccess } from "./platform-access.functions";

const companySchema = z.enum(["w2", "d61", "somus", "lie", "lie-design", "manual-test"]);
const ready = new WeakMap<object, Promise<unknown>>();
async function database() {
  const db = getRuntimeEnv<{ DB?: { prepare(sql: string): any; batch(statements: any[]): Promise<unknown> } }>()?.DB;
  if (!db) throw new Error("Banco de configuracoes indisponivel.");
  let initialized = ready.get(db);
  if (!initialized) {
    initialized = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS operational_settings (user_id TEXT NOT NULL, company TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, company))"),
      db.prepare("CREATE TABLE IF NOT EXISTS alert_resolutions (user_id TEXT NOT NULL, company TEXT NOT NULL, alert_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, company, alert_id))"),
    ]).catch(error => { ready.delete(db); throw error; });
    ready.set(db, initialized);
  }
  await initialized;
  return db;
}

export const getOperationalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ company: companySchema }).parse(input))
  .handler(async ({ context, data }) => {
    await assertCompanyAccess(context, data.company);
    const db = await database();
    const row = await db.prepare("SELECT payload FROM operational_settings WHERE user_id = ? AND company = ?").bind(context.userId, data.company).first();
    const alerts = await db.prepare("SELECT alert_id FROM alert_resolutions WHERE user_id = ? AND company = ? ORDER BY updated_at DESC LIMIT 200")
      .bind(context.userId, data.company).all();
    return { settings: row ? operationalSettingsSchema.parse(JSON.parse(row.payload)) : EMPTY_SETTINGS,
      resolved: alerts.results.map((r: { alert_id: string }) => r.alert_id) as string[] };
  });

export const saveOperationalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ company: companySchema, settings: operationalSettingsSchema }).parse(input))
  .handler(async ({ context, data }) => {
    await assertCompanyAccess(context, data.company);
    const db = await database();
    await db.prepare("INSERT INTO operational_settings (user_id, company, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, company) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at")
      .bind(context.userId, data.company, JSON.stringify(data.settings), new Date().toISOString()).run();
    return { ok: true };
  });

export const resolveFinancialAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => z.object({ company: companySchema, id: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    await assertCompanyAccess(context, data.company);
    const db = await database();
    await db.prepare("INSERT INTO alert_resolutions (user_id, company, alert_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, company, alert_id) DO UPDATE SET updated_at = excluded.updated_at")
      .bind(context.userId, data.company, data.id, new Date().toISOString()).run();
    return { ok: true };
  });
