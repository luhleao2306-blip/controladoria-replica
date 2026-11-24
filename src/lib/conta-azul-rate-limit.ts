import { getRuntimeEnv } from "@/lib/runtime-env";

const initialized = new WeakMap<object, Promise<unknown>>();
const localSlots = new Map<string, number>();
const INTERVAL_MS = 150;

export async function waitForContaAzulSlot(account = "w2") {
  const db = getRuntimeEnv<{ DB?: { prepare(sql: string): any } }>()?.DB;
  let slot: number;
  if (db) {
    let ready = initialized.get(db);
    if (!ready) {
      ready = db.prepare("CREATE TABLE IF NOT EXISTS conta_azul_request_slots (account TEXT PRIMARY KEY, next_at INTEGER NOT NULL)").run();
      initialized.set(db, ready!);
    }
    await ready;
    const now = Date.now();
    const reserved = await db.prepare(`INSERT INTO conta_azul_request_slots (account, next_at) VALUES (?, ?)
      ON CONFLICT(account) DO UPDATE SET next_at = MAX(next_at, ?) + ? RETURNING next_at`)
      .bind(account, now + INTERVAL_MS, now, INTERVAL_MS).first();
    if (!reserved || !Number.isFinite(reserved.next_at)) throw new Error("Nao foi possivel coordenar as consultas da Conta Azul.");
    slot = reserved.next_at;
  } else {
    slot = Math.max(Date.now(), localSlots.get(account) ?? 0) + INTERVAL_MS;
    localSlots.set(account, slot);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, slot - Date.now())));
}
