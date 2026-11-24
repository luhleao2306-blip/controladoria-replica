import { getRuntimeEnv } from "./runtime-env";
import { backgroundIntegrationSecurity } from "./conta-azul.functions";
import { runBackgroundW2 } from "./conta-azul-background.server";

const PATH = "/api/integrations/conta-azul/scheduler";
const encoder = new TextEncoder();
type Company = "w2" | "somus" | "lie" | "lie-design" | "d61";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function handleContaAzulScheduler(request: Request) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = getRuntimeEnv()?.CONTA_AZUL_SCHEDULER_SECRET ?? process.env.CONTA_AZUL_SCHEDULER_SECRET;
  if (typeof secret !== "string" || secret.length < 64) return json({ error: "scheduler_unavailable" }, 503);
  const timestamp = request.headers.get("x-sync-timestamp") ?? "";
  const nonce = request.headers.get("x-sync-nonce") ?? "";
  const signature = request.headers.get("x-sync-signature") ?? "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 90_000
    || !/^[a-f0-9-]{36}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return json({ error: "unauthorized" }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "invalid_request" }, 400);
  if (new URL(request.url).pathname !== PATH) return json({ error: "invalid_request" }, 400);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_request" }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256) { await reader.cancel(); return json({ error: "invalid_request" }, 400); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = new TextDecoder().decode(bytes);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, Uint8Array.from(signature.match(/../g)!, hex => parseInt(hex, 16)),
    encoder.encode(`${timestamp}\n${nonce}\nPOST\n${PATH}\n${body}`));
  if (!valid) return json({ error: "unauthorized" }, 401);
  let company: Company, action: "step" | "status";
  try {
    const parsed = JSON.parse(body);
    if (!parsed || Object.keys(parsed).some(k => !["company", "action"].includes(k))
      || !["w2", "somus", "lie", "lie-design", "d61"].includes(parsed.company) || !["step", "status"].includes(parsed.action)) throw new Error();
    ({ company, action } = parsed);
  } catch { return json({ error: "invalid_request" }, 400); }
  const db = await backgroundIntegrationSecurity.integrationDatabase();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_scheduler_nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_scheduler_status (company_key TEXT PRIMARY KEY, last_tick_at TEXT NOT NULL, last_completed_at TEXT, status TEXT NOT NULL, error_code TEXT)").run();
  await db.prepare("DELETE FROM integration_scheduler_nonces WHERE expires_at<?").bind(Date.now()).run();
  const accepted = await db.prepare("INSERT INTO integration_scheduler_nonces (nonce,expires_at) VALUES (?,?) ON CONFLICT(nonce) DO NOTHING RETURNING nonce")
    .bind(nonce, Date.now() + 180_000).first();
  if (!accepted) return json({ error: "replayed_request" }, 409);
  if (action === "status") {
    const source = await runBackgroundW2("status", company);
    const scheduler = await db.prepare("SELECT * FROM integration_scheduler_status WHERE company_key=?").bind(company).first();
    return json({ ...source, scheduler });
  }
  const now = new Date().toISOString();
  try {
    const result = await runBackgroundW2("step", company, { maxSteps: 8, maxElapsedMs: 45_000, scheduleDaily: true });
    const completed = result.status === "completed" ? new Date().toISOString() : null;
    // A concurrent/busy tick has not checked the source. Preserve its last error
    // until a request actually advances or completes the import.
    await db.prepare("INSERT INTO integration_scheduler_status (company_key,last_tick_at,last_completed_at,status,error_code) VALUES (?,?,?,?,NULL) ON CONFLICT(company_key) DO UPDATE SET last_tick_at=CASE WHEN excluded.status='busy' THEN integration_scheduler_status.last_tick_at ELSE excluded.last_tick_at END,last_completed_at=COALESCE(excluded.last_completed_at,integration_scheduler_status.last_completed_at),status=CASE WHEN excluded.status='busy' THEN integration_scheduler_status.status ELSE excluded.status END,error_code=CASE WHEN excluded.status='busy' THEN integration_scheduler_status.error_code ELSE NULL END WHERE excluded.last_tick_at>=integration_scheduler_status.last_tick_at OR integration_scheduler_status.status='busy'")
      .bind(company, now, completed, result.status).run();
    return json(result);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const errorCode = ["authorization_required", "source_authorization_required", "source_configuration_error"].includes(code)
      ? code : "source_unavailable";
    let message = error && typeof error === "object" && "message" in error ? String(error.message) : "source_unavailable";
    const runtime = { ...process.env, ...getRuntimeEnv() };
    for (const [name, value] of Object.entries(runtime)) {
      if (/SECRET|TOKEN|KEY|PASSWORD|SESSION/.test(name) && typeof value === "string" && value.length >= 8) message = message.split(value).join("[redacted]");
    }
    console.error(JSON.stringify({ component: "conta-azul-scheduler", company, message: message.slice(0, 300) }));
    await db.prepare("INSERT INTO integration_scheduler_status (company_key,last_tick_at,status,error_code) VALUES (?,?,?,?) ON CONFLICT(company_key) DO UPDATE SET last_tick_at=excluded.last_tick_at,status=excluded.status,error_code=excluded.error_code WHERE excluded.last_tick_at>=integration_scheduler_status.last_tick_at OR integration_scheduler_status.status='busy'")
      .bind(company, now, "error", errorCode).run();
    return json({ company, error: errorCode, previousDataPreserved: true }, 503);
  }
}
