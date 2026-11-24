import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { mapContaAzulTransaction as mapTransaction, contaAzulMetadata, contaAzulFirstDueDate, contaAzulDate, contaAzulSearchWindow, assertContaAzulImportPeriod, canReuseContaAzulDetail, reconcileContaAzulCategoryNames, refreshContaAzulSummaryFromDetail, projectContaAzulDreCategories, contaAzulDescriptionFromDetail, contaAzulReportingDetail } from "@/lib/conta-azul-model";
import { waitForContaAzulSlot } from "@/lib/conta-azul-rate-limit";
import { integrationErrorMessage, isTransientIntegrationError } from "@/lib/integration-errors";
import { openingBalanceRanges, validateOpeningBalances } from "@/lib/conta-azul-opening-balances";
import { assertCompanyAccess } from "./platform-access.functions";
import { readContaAzulReadView, saveContaAzulReadView, contaAzulReadViewExists } from "@/lib/conta-azul-read-cache.server";
import { readApprovedOpeningBalances, approvedOpeningRevision } from "@/lib/reporting-opening-balances.server";
import { packFinancialRead } from "@/lib/financial-read-transport";

const CONTA_AZUL_API = "https://api-v2.contaazul.com";
const CONTA_AZUL_RECEIVABLES = "/v1/financeiro/contas-a-receber";
const CONTA_AZUL_PAYABLES = "/v1/financeiro/contas-a-pagar";
const CONTA_AZUL_INVENTORY_PAGE_SIZE = 1000;
const CONTA_AZUL_AUTHORIZE = "https://login.contaazul.com/#/oauth/authorize";
const W2_COMPANY_NAME = "W2 Publicidade";
const W2_TEST_COMPANY_ID = "w2-test";
const OAUTH_SCOPE = "openid profile aws.cognito.signin.user.admin";
const companyKeySchema = z.enum(["w2", "d61", "somus", "lie", "lie-design"]);
type IntegrationCompany = z.infer<typeof companyKeySchema>;
const COMPANY_NAMES = { w2: W2_COMPANY_NAME, d61: "D61", somus: "Somus", lie: "LIE ARQUITETURA", "lie-design": "Liê Design" };
const companyInput = (value: unknown) => z.object({ company: companyKeySchema.default("w2") }).parse(value ?? {});
const schemaReady = new WeakMap<object, Promise<void>>();
type IntegrationContext = { supabase: SupabaseClient<Database>; userId: string };

async function integrationDatabase() {
  const db = getTestDatabase();
  let initialized = schemaReady.get(db);
  if (!initialized) {
    initialized = initializeIntegrationSchema(db).catch((error) => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, initialized);
  }
  await initialized;
  return db;
}

async function initializeIntegrationSchema(db: any) {
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_oauth_states (nonce TEXT PRIMARY KEY, user_id TEXT NOT NULL, company_key TEXT NOT NULL, company_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_leases (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_imports (company_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, revenue_count INTEGER NOT NULL DEFAULT 0, expense_count INTEGER NOT NULL DEFAULT 0, revenue_done INTEGER NOT NULL DEFAULT 0, expense_done INTEGER NOT NULL DEFAULT 0, revenue_page INTEGER NOT NULL DEFAULT 0, expense_page INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_catalog_changes (company_id TEXT PRIMARY KEY, revision TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_inventory_pages (company_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, page INTEGER NOT NULL, total INTEGER NOT NULL, ids_json TEXT NOT NULL, PRIMARY KEY(company_id,run_id,kind,page))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_inventory_status (company_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_inventory_checks (company_id TEXT NOT NULL, run_id TEXT NOT NULL, external_id TEXT NOT NULL, PRIMARY KEY(company_id,run_id,external_id))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_background_jobs (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, company_id TEXT NOT NULL, progress_json TEXT, last_full_sync_at TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_scheduler_status (company_key TEXT PRIMARY KEY, last_tick_at TEXT NOT NULL, last_completed_at TEXT, status TEXT NOT NULL, error_code TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS integration_token_rotations (connection_id TEXT PRIMARY KEY, company_key TEXT NOT NULL, previous_refresh_encrypted TEXT NOT NULL, rotation_encrypted TEXT NOT NULL)").run();
  const scopeColumn = await db.prepare("SELECT name FROM pragma_table_info('integration_background_jobs') WHERE name='last_full_due_from'").first();
  if (!scopeColumn) {
    try {
      await db.prepare("ALTER TABLE integration_background_jobs ADD COLUMN last_full_due_from TEXT").run();
    } catch (error) {
      if (!String(error).includes("duplicate column name")) throw error;
    }
  }
}

async function readImportState(companyId: string) {
  const db = await integrationDatabase();
  const job = await db.prepare("SELECT status, run_id FROM integration_imports WHERE company_id=?").bind(companyId).first();
  if (job?.status !== "running") return job?.status ? String(job.status) : null;
  const lease = await db.prepare("SELECT owner, expires_at FROM integration_leases WHERE key=?").bind(`import:${companyId}`).first();
  return lease?.owner === job.run_id && lease.expires_at > Date.now() ? "running" : "interrupted";
}

async function claimLease(db: any, key: string, owner: string, ttl: number) {
  const row = await db.prepare("INSERT INTO integration_leases (key, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE integration_leases.expires_at < ? RETURNING owner")
    .bind(key, owner, Date.now() + ttl, Date.now()).first();
  return row?.owner === owner;
}

async function resolveIntegrationCompany(db: any, company: IntegrationCompany, create = false) {
  if (company === "w2") return getOrCreateW2Company(db);
  const result = await db.from("companies").select("id,name").ilike("name", COMPANY_NAMES[company]);
  if (result.error) throw result.error;
  if (result.data?.length > 1) throw new Error("Existem empresas com o mesmo nome. Confira o cadastro antes de conectar.");
  if (result.data?.[0]?.id) return result.data[0].id as string;
  if (!create) return null;
  const inserted = await db.from("companies").insert({ name: COMPANY_NAMES[company], status: "active",
    ...(company === "d61" ? { document: requiredEnv("CONTA_AZUL_D61_CNPJ").replace(/\D/g, "") } : {}) }).select("id").single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id as string;
}

async function requireIntegrationAdmin(db: any, userId: string) {
  const role = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (role.error) throw role.error;
  if (role.data !== true) throw new Error("Somente um administrador autorizado pode conectar a Conta Azul desta empresa.");
}

type ContaAzulTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

function requiredEnv(name: string): string {
  throw new Error(`A Conta Azul usa os dados copiados nesta réplica local (${name}).`);
}

function contaAzulClient(company: IntegrationCompany) {
  // New tenants must never inherit another company's app or development tokens.
  const prefix = company === "d61" ? "CONTA_AZUL_D61" : company === "lie-design" ? "CONTA_AZUL_LIE_DESIGN" : company === "lie" ? "CONTA_AZUL_LIE" : company === "somus" ? "CONTA_AZUL_SOMUS" : "CONTA_AZUL";
  return {
    clientId: requiredEnv(`${prefix}_CLIENT_ID`),
    clientSecret: requiredEnv(`${prefix}_CLIENT_SECRET`),
    redirectUri: requiredEnv(`${prefix}_REDIRECT_URI`),
  };
}

async function verifySomusAccount(company: IntegrationCompany, token: string) {
  if (company !== "somus" && company !== "lie" && company !== "lie-design" && company !== "d61") return;
  const expected = requiredEnv(company === "d61" ? "CONTA_AZUL_D61_CNPJ" : company === "lie-design" ? "CONTA_AZUL_LIE_DESIGN_CNPJ" : company === "lie" ? "CONTA_AZUL_LIE_CNPJ" : "CONTA_AZUL_SOMUS_CNPJ").replace(/\D/g, "");
  if (expected.length !== 14) throw new Error(`Configure um CNPJ valido para a integracao ${COMPANY_NAMES[company]}.`);
  const account = await contaAzulGet(token, "/v1/pessoas/conta-conectada");
  if (typeof account?.documento !== "string" || account.documento.replace(/\D/g, "") !== expected) {
    throw new Error(`A conta autorizada nao pertence ao CNPJ da ${COMPANY_NAMES[company]}. Conecte a conta real correta; nenhum lancamento foi importado.`);
  }
}

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function encryptionKey() {
  const secret = requiredEnv("CONTA_AZUL_TOKEN_ENCRYPTION_KEY");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptToken(value: string) {
  const [iv, payload] = value.split(".");
  if (!iv || !payload) throw new Error("Token Conta Azul inválido.");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await encryptionKey(),
    base64ToBytes(payload),
  );
  return new TextDecoder().decode(decrypted);
}

async function stateSignature(value: string) {
  const secret = requiredEnv("CONTA_AZUL_STATE_SECRET");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(signature)).replace(/=+$/g, "");
}

async function createOAuthState(userId: string, company: IntegrationCompany, companyId: string) {
  const nonce = crypto.randomUUID();
  const db = await integrationDatabase();
  await db.prepare("DELETE FROM integration_oauth_states WHERE expires_at < ?").bind(Date.now()).run();
  await db.prepare("INSERT INTO integration_oauth_states (nonce, user_id, company_key, company_id, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(nonce, userId, company, companyId, Date.now() + 15 * 60_000).run();
  return `${nonce}.${await stateSignature(nonce)}`;
}

async function consumeOAuthState(state: string, userId: string) {
  const separator = state.lastIndexOf(".");
  if (separator < 1) throw new Error("Autorização inválida. Inicie uma nova conexão.");
  const payload = state.slice(0, separator);
  const signature = state.slice(separator + 1);
  if (signature !== await stateSignature(payload)) throw new Error("Autorização inválida. Inicie uma nova conexão.");
  const db = await integrationDatabase();
  const row = await db.prepare("UPDATE integration_oauth_states SET consumed_at=? WHERE nonce=? AND user_id=? AND expires_at>? AND consumed_at IS NULL RETURNING company_key, company_id")
    .bind(Date.now(), payload, userId, Date.now()).first();
  if (!row) throw new Error("Autorização expirada, já utilizada ou de outro usuário. Inicie uma nova conexão.");
  return { company: companyKeySchema.parse(row.company_key), companyId: String(row.company_id) };
}

async function getAdminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function getOrCreateW2Company(db?: any) {
  const admin = db ?? await getAdminClient();
  // Resolve the production company first, then recover a legacy W2 company
  // that already owns the Conta Azul connection. Never use the isolated test
  // company as a fallback.
  const existing = await admin.from("companies").select("id,name").ilike("name", "%W2%");
  if (existing.error) throw existing.error;
  const candidates = (existing.data ?? []).filter((row: any) => String(row.name ?? "").trim().toLowerCase() !== "w2 test");
  const exact = candidates.find((row: any) => String(row.name ?? "").trim().toLowerCase() === W2_COMPANY_NAME.toLowerCase());
  const candidateIds = candidates.map((row: any) => row.id).filter(Boolean);
  if (candidateIds.length) {
    const connections = await admin.from("conta_azul_connections_safe").select("company_id").in("company_id", candidateIds);
    if (connections.error) throw connections.error;
    const connectedIds = new Set((connections.data ?? []).map((row: any) => row.company_id));
    if (exact?.id && connectedIds.has(exact.id)) return exact.id as string;
    const connectedLegacy = candidates.find((row: any) => connectedIds.has(row.id));
    if (connectedLegacy?.id) return connectedLegacy.id as string;
  }
  if (exact?.id) return exact.id as string;

  const created = await admin.from("companies").insert({ name: W2_COMPANY_NAME, status: "active" }).select("id").single();
  if (created.error) throw created.error;
  return created.data.id as string;
}

async function exchangeAuthorizationCode(code: string, redirectUri: string, company: IntegrationCompany) {
  const { clientId, clientSecret } = contaAzulClient(company);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const response = await fetch(`${CONTA_AZUL_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`A Conta Azul recusou a autorização (${response.status}).`);
  const token = (await response.json()) as ContaAzulTokenResponse;
  if (!token.access_token || !token.refresh_token) throw new Error("A Conta Azul não retornou os tokens necessários.");
  return token;
}

async function refreshContaAzulToken(connection: any, db?: any, company: IntegrationCompany = "w2") {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (connection.access_token_encrypted && expiresAt > Date.now() + 60_000) {
    return await decryptToken(connection.access_token_encrypted);
  }
  if (!connection.refresh_token_encrypted) {
    throw Object.assign(new Error("A autorização da Conta Azul precisa ser renovada. Reconecte esta empresa."), { code: "source_authorization_required" });
  }
  const admin = db ?? await getAdminClient();
  const leases = await integrationDatabase();
  const owner = crypto.randomUUID();
  const key = `token:${connection.id}`;
  let claimed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    claimed = await claimLease(leases, key, owner, 45_000);
    if (claimed) break;
    await sleep(1000);
  }
  if (!claimed) throw new Error("A renovação da autorização está em andamento. Tente novamente em instantes.");
  try {
    const fresh = await admin.from("conta_azul_connections").select("*").eq("id", connection.id).single();
    if (fresh.error) throw fresh.error;
    connection = fresh.data;
    // A provider rotation cannot be rolled back. Recover its encrypted journal
    // before consuming another token if the last database write was interrupted.
    const pending = await leases.prepare("SELECT * FROM integration_token_rotations WHERE connection_id=?").bind(connection.id).first();
    if (pending) {
      if (pending.company_key !== company) throw new Error("A renovação pendente não pertence a esta empresa.");
      if (pending.previous_refresh_encrypted === connection.refresh_token_encrypted) {
        const recovered = JSON.parse(await decryptToken(pending.rotation_encrypted));
        if (!recovered.access_token_encrypted || !recovered.refresh_token_encrypted || !recovered.token_expires_at) throw new Error("A renovação pendente está incompleta.");
        await persistContaAzulRotation(admin, connection, recovered);
        connection = { ...connection, ...recovered };
      }
      // Different credentials mean that persistence succeeded or a newer consent
      // superseded this journal. Never overwrite the newer authorization.
      await leases.prepare("DELETE FROM integration_token_rotations WHERE connection_id=? AND rotation_encrypted=?")
        .bind(connection.id, pending.rotation_encrypted).run();
    }
    if (connection.access_token_encrypted && new Date(connection.token_expires_at).getTime() > Date.now() + 60_000) return decryptToken(connection.access_token_encrypted);
    if (connection.connection_status === "expired") throw Object.assign(new Error("A autorização da Conta Azul precisa ser renovada. Reconecte esta empresa."), { code: "source_authorization_required" });

  const { clientId, clientSecret } = contaAzulClient(company);
  const refreshToken = await decryptToken(connection.refresh_token_encrypted);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${CONTA_AZUL_API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // Never log the provider's free-form response: it may contain credentials.
    const details = await response.json().catch(() => ({})) as { error?: string; error_subtype?: string };
    const invalidClient = details.error === "invalid_client" || details.error_subtype === "invalid_client";
    const rejectedGrant = response.status === 400 && details.error === "invalid_grant" && !invalidClient;
    const code = invalidClient ? "source_configuration_error" : rejectedGrant ? "source_authorization_required" : "source_unavailable";
    if (rejectedGrant) {
      await checkedIntegrationQuery<any>(() => admin.from("conta_azul_connections")
        .update({ connection_status: "expired" }).eq("id", connection.id)
        .eq("refresh_token_encrypted", connection.refresh_token_encrypted))
        .catch(() => console.warn(JSON.stringify({ component: "conta-azul-token", company, code: "authorization_status_write_failed" })));
    }
    const message = invalidClient ? "As credenciais da integração Conta Azul precisam ser verificadas."
      : rejectedGrant ? "A Conta Azul recusou a renovação da autorização. Reconecte esta empresa."
      : `A Conta Azul não conseguiu renovar o acesso (HTTP ${response.status}). Nova tentativa automática; os dados anteriores foram preservados.`;
    throw Object.assign(new Error(message), { code });
  }
  const token = (await response.json()) as ContaAzulTokenResponse;
  if (!token.access_token) throw new Error("A Conta Azul não retornou um novo access token.");

  // Encrypt once and retry only the database write. Repeating the OAuth request
  // would consume a refresh token that the provider has already rotated.
  const rotated = {
    access_token_encrypted: await encryptToken(token.access_token),
    refresh_token_encrypted: token.refresh_token ? await encryptToken(token.refresh_token) : connection.refresh_token_encrypted,
    token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    connection_status: "connected" as const,
  };
  const encryptedRotation = await encryptToken(JSON.stringify(rotated));
  await checkedIntegrationQuery<any>(() => leases.prepare("INSERT INTO integration_token_rotations (connection_id,company_key,previous_refresh_encrypted,rotation_encrypted) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET company_key=excluded.company_key,previous_refresh_encrypted=excluded.previous_refresh_encrypted,rotation_encrypted=excluded.rotation_encrypted")
    .bind(connection.id, company, connection.refresh_token_encrypted, encryptedRotation).run());
  await persistContaAzulRotation(admin, connection, rotated);
  await leases.prepare("DELETE FROM integration_token_rotations WHERE connection_id=? AND rotation_encrypted=?")
    .bind(connection.id, encryptedRotation).run();
  return token.access_token;
  } finally {
    await leases.prepare("DELETE FROM integration_leases WHERE key=? AND owner=?").bind(key, owner).run();
  }
}

async function persistContaAzulRotation(admin: any, connection: any, rotated: any) {
  const write = await checkedIntegrationQuery<any>(() => admin.from("conta_azul_connections").update(rotated)
    .eq("id", connection.id).eq("refresh_token_encrypted", connection.refresh_token_encrypted).select("id").maybeSingle())
    .catch(() => { throw new Error("Não foi possível salvar a autorização renovada agora. A renovação foi preservada para nova tentativa automática; os dados anteriores foram mantidos."); });
  if (!write.data) throw new Error("A conexão mudou durante a renovação. A autorização mais recente foi preservada.");
}

async function seedConnectionFromEnvironment(companyId: string, db?: any) {
  const accessToken = process.env.CONTA_AZUL_INITIAL_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.CONTA_AZUL_INITIAL_REFRESH_TOKEN?.trim();
  if (!accessToken || !refreshToken) return null;
  const admin = db ?? await getAdminClient();
  const values = {
    company_id: companyId,
    connection_status: "connected" as const,
    access_token_encrypted: await encryptToken(accessToken),
    refresh_token_encrypted: await encryptToken(refreshToken),
    token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  const current = await admin.from("conta_azul_connections_safe").select("id").eq("company_id", companyId).limit(1).maybeSingle();
  if (current.error) throw current.error;
  const result = current.data?.id
    ? await admin.from("conta_azul_connections").update(values).eq("id", current.data.id)
    : await admin.from("conta_azul_connections").insert(values);
  if (result.error) throw result.error;
  const safe = await admin.from("conta_azul_connections_safe").select("id,connection_status,last_sync_at,token_expires_at").eq("company_id", companyId).limit(1).maybeSingle();
  if (safe.error) throw safe.error;
  if (!safe.data?.id) throw new Error("A conexão Conta Azul foi gravada, mas não pôde ser confirmada.");
  return { ...values, id: safe.data.id, last_sync_at: safe.data.last_sync_at };
}

export const getContaAzulAuthorizationUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(companyInput)
  .handler(async ({ data, context }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const { clientId, redirectUri } = contaAzulClient(data.company);
    const companyId = await resolveIntegrationCompany(context.supabase, data.company, true);
    if (!companyId) throw new Error("Empresa não encontrada.");
    const state = await createOAuthState(context.userId, data.company, companyId);
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: OAUTH_SCOPE });
    return { url: `${CONTA_AZUL_AUTHORIZE}?${params.toString()}` };
  });

export const completeContaAzulAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(value))
  .handler(async ({ data, context }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const { company, companyId } = await consumeOAuthState(data.state, context.userId);
    const visible = await context.supabase.from("companies").select("id").eq("id", companyId).single();
    if (visible.error) throw visible.error;
    const { redirectUri } = contaAzulClient(company);
    const token = await exchangeAuthorizationCode(data.code, redirectUri, company);
    await verifySomusAccount(company, token.access_token!);
    const admin = context.supabase;
    const current = await admin.from("conta_azul_connections").select("id").eq("company_id", companyId).limit(1).maybeSingle();
    if (current.error) throw current.error;
    const values = {
      company_id: companyId,
      connection_status: "connected" as const,
      access_token_encrypted: await encryptToken(token.access_token!),
      refresh_token_encrypted: await encryptToken(token.refresh_token!),
      token_expires_at: new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    };
    // The CNPJ was verified above. Reauthorizing the same company must not erase
    // its successful watermark or overwrite a concurrently completed import.
    const result = current.data?.id
      ? await admin.from("conta_azul_connections").update(values).eq("id", current.data.id)
      : await admin.from("conta_azul_connections").insert({ ...values, last_sync_at: null });
    if (result.error) throw result.error;
    // A queued callback must not inherit the previous consent's blocked status.
    // Advancing this timestamp also protects against an older in-flight tick.
    try {
      const jobs = await integrationDatabase(), authorizedAt = new Date().toISOString();
      await checkedIntegrationQuery<any>(() => jobs.prepare("UPDATE integration_scheduler_status SET last_tick_at=?,status='queued',error_code=NULL WHERE company_key=? AND error_code IN ('source_authorization_required','source_configuration_error') AND last_tick_at<?")
        .bind(authorizedAt, company, authorizedAt).run());
    } catch {
      // Consent is already durable. A status cleanup failure must not ask the
      // browser to exchange the one-time authorization code again.
      console.warn(JSON.stringify({ component: "conta-azul-token", company, code: "reconnection_status_retry_pending" }));
    }
    return { company, companyName: COMPANY_NAMES[company] };
  });

async function getContaAzulConnectionStatusOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany } }) {
    await assertCompanyAccess(context, data.company);
    const admin = context.supabase;
    const companyId = await resolveIntegrationCompany(admin, data.company);
    const schedulerSecret = getRuntimeEnv()?.CONTA_AZUL_SCHEDULER_SECRET ?? process.env.CONTA_AZUL_SCHEDULER_SECRET;
    const lieScheduled = getRuntimeEnv()?.CONTA_AZUL_LIE_SCHEDULER_ENABLED ?? process.env.CONTA_AZUL_LIE_SCHEDULER_ENABLED;
    const designScheduled = getRuntimeEnv()?.CONTA_AZUL_LIE_DESIGN_SCHEDULER_ENABLED ?? process.env.CONTA_AZUL_LIE_DESIGN_SCHEDULER_ENABLED;
    const d61Scheduled = getRuntimeEnv()?.CONTA_AZUL_D61_SCHEDULER_ENABLED ?? process.env.CONTA_AZUL_D61_SCHEDULER_ENABLED;
    const server_sync_enabled = (["w2", "somus"].includes(data.company) || (data.company === "lie" && lieScheduled === "true")
      || (data.company === "lie-design" && designScheduled === "true") || (data.company === "d61" && d61Scheduled === "true")) && typeof schedulerSecret === "string" && schedulerSecret.length >= 64;
    if (!companyId) return { connection_status: "disconnected", last_sync_at: null, token_expires_at: null, transaction_count: null, import_status: null as string | null, server_sync_enabled,
      scheduler_status: null as string | null, scheduler_error: null as string | null, last_scheduler_completion_at: null as string | null };
    const result = await admin.from("conta_azul_connections_safe").select("connection_status,last_sync_at,token_expires_at").eq("company_id", companyId).limit(1).maybeSingle();
    if (result.error) throw result.error;
    let connectionStatus = result.data;
    if (!connectionStatus && data.company === "w2") {
      connectionStatus = await seedConnectionFromEnvironment(companyId, admin) ?? connectionStatus;
    }
    const transactionCount = await admin
      .from("financial_transactions")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);
    if (transactionCount.error) throw transactionCount.error;
    const scheduler = await (await integrationDatabase()).prepare("SELECT status,error_code,last_completed_at FROM integration_scheduler_status WHERE company_key=?")
      .bind(data.company).first();
    return {
      ...(connectionStatus ?? { connection_status: "disconnected", last_sync_at: null, token_expires_at: null }),
      transaction_count: transactionCount.count,
      import_status: await readImportState(companyId),
      server_sync_enabled,
      scheduler_status: scheduler?.status ? String(scheduler.status) : null,
      scheduler_error: scheduler?.error_code ? String(scheduler.error_code) : null,
      last_scheduler_completion_at: scheduler?.last_completed_at ? String(scheduler.last_completed_at) : null,
    };
  }

export const getContaAzulConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(companyInput)
  .handler(getContaAzulConnectionStatusOperation);

function firstValue(item: any, keys: string[]) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], item);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function dateValue(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso?.[1] ?? null;
}

function parseMoney(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[^\d,.-]/g, "");
  if (!text) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const normalized = lastComma > lastDot
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findNestedMoney(value: unknown, depth = 0): number | null {
  if (depth > 4 || value === null || value === undefined) return null;
  const direct = parseMoney(value);
  if (direct !== null) return direct;
  if (typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/valor|amount|total|liquido|bruto|pago/i.test(key)) {
      const found = findNestedMoney(child, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

function moneyValue(item: any) {
  const value = firstValue(item, [
    "valor.valor_liquido",
    "valor.valor_bruto",
    "valor.valor_total",
    "valor.valor_pago",
    "valor_composicao.valor_liquido",
    "valor_composicao.valor_bruto",
    "valor_composicao.valor_total",
    "valor_total",
    "valor_pago",
    "valor",
  ]);
  return findNestedMoney(value) ?? findNestedMoney(item) ?? 0;
}

function getTestDatabase() {
  const db = getRuntimeEnv<{ DB?: { prepare: (sql: string) => any; batch: (statements: any[]) => Promise<unknown> } }>()?.DB;
  if (!db) throw new Error("O banco de apoio das integrações não está disponível. Os dados financeiros existentes foram preservados.");
  return db;
}

async function fetchW2TestTransactions(admin: any) {
  const companyId = await getOrCreateW2Company(admin);
  const connection = await admin.from("conta_azul_connections").select("*").eq("company_id", companyId).limit(1).maybeSingle();
  if (connection.error) throw connection.error;
  const connectionData = connection.data ?? await seedConnectionFromEnvironment(companyId, admin);
  if (!connectionData) throw new Error("Conecte a conta W2 antes de importar para o banco de teste.");
  const accessToken = await refreshContaAzulToken(connectionData, admin);
  const [receivables, payables] = await Promise.all([
    fetchAllContaAzul(accessToken, CONTA_AZUL_RECEIVABLES),
    fetchAllContaAzul(accessToken, CONTA_AZUL_PAYABLES),
  ]);
  const incoming = [
    ...receivables.map((item) => mapTransaction(item, W2_TEST_COMPANY_ID, "revenue")),
    ...payables.map((item) => mapTransaction(item, W2_TEST_COMPANY_ID, "expense")),
  ].filter((item) => item.external_id)
    .filter((item, index, list) => list.findIndex((candidate) => `${candidate.transaction_type}:${candidate.external_id}` === `${item.transaction_type}:${item.external_id}`) === index);
  if (!incoming.length) throw new Error("A Conta Azul respondeu sem lançamentos para a W2.");
  return { admin, connectionData, receivables, payables, incoming };
}

export const syncContaAzulW2Test = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = getTestDatabase();
    const { connectionData, receivables, payables, incoming } = await fetchW2TestTransactions(context.supabase);
    const statements = incoming.map((item) => db.prepare(`
      INSERT INTO test_financial_transactions
      (id, company_id, external_id, transaction_type, description, customer_or_supplier_name,
       category_name, cost_center_name, amount, due_date, payment_date, competence_date,
       status, raw_payload, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(company_id, transaction_type, external_id) DO UPDATE SET
        description=excluded.description,
        customer_or_supplier_name=excluded.customer_or_supplier_name,
        category_name=excluded.category_name,
        cost_center_name=excluded.cost_center_name,
        amount=excluded.amount,
        due_date=excluded.due_date,
        payment_date=excluded.payment_date,
        competence_date=excluded.competence_date,
        status=excluded.status,
        raw_payload=excluded.raw_payload,
        imported_at=CURRENT_TIMESTAMP
    `).bind(
      `${item.transaction_type}:${item.external_id}`,
      W2_TEST_COMPANY_ID,
      item.external_id,
      item.transaction_type,
      item.description,
      item.customer_or_supplier_name,
      item.category_name,
      item.cost_center_name,
      item.amount,
      item.due_date,
      item.payment_date,
      item.competence_date,
      item.status,
      JSON.stringify(item),
    ));
    for (let index = 0; index < statements.length; index += 50) await db.batch(statements.slice(index, index + 50));
    await db.prepare(`INSERT INTO test_sync_runs (id, company_id, received_count, payable_count, imported_count, status) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), W2_TEST_COMPANY_ID, receivables.length, payables.length, incoming.length, "success").run();
    return { received: receivables.length, paid: payables.length, imported: incoming.length };
  });

export const getW2TestData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = getTestDatabase();
    const result = await db.prepare("SELECT * FROM test_financial_transactions WHERE company_id = ? ORDER BY competence_date DESC, imported_at DESC")
      .bind(W2_TEST_COMPANY_ID).all();
    return { financial_transactions: result.results ?? [] };
  });

const CONTA_AZUL_PAGE_DELAY_MS = 250;
const CONTA_AZUL_MAX_RETRIES = 4;
const SUPABASE_WRITE_BATCH_SIZE = 250;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => PromiseLike<{ error: unknown }>) {
  for (let index = 0; index < rows.length; index += SUPABASE_WRITE_BATCH_SIZE) {
    await checkedIntegrationQuery(() => insert(rows.slice(index, index + SUPABASE_WRITE_BATCH_SIZE)));
  }
}

// Retry only repeatable database reads/upserts, never OAuth code exchange or job advancement.
async function checkedIntegrationQuery<T extends { error: unknown }>(query: () => PromiseLike<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await query();
      if (result.error) throw result.error;
      return result;
    } catch (error) {
      if (attempt >= 2 || !isTransientIntegrationError(error)) throw new Error(integrationErrorMessage(error, "Não foi possível consultar ou salvar os dados da integração."));
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function fetchContaAzulPage(accessToken: string, path: string, page: number, updatedSince?: string, updatedUntil?: string, company: IntegrationCompany = "w2", window = 0, pageSize = 100, dueScope?: { from: string; to: string }) {
  const bounds = contaAzulSearchWindow(company, updatedSince, updatedUntil ?? new Date().toISOString(), window, dueScope);
  const filter = updatedSince ? "data_alteracao" : "data_vencimento";
  const params = new URLSearchParams({
    pagina: String(page),
    tamanho_pagina: String(pageSize),
    [`${filter}_de`]: bounds.from,
    [`${filter}_ate`]: bounds.to,
  });
  for (let attempt = 0; attempt <= CONTA_AZUL_MAX_RETRIES; attempt++) {
    await waitForContaAzulSlot();
    let response: Response;
    try {
      response = await fetch(`${CONTA_AZUL_API}${path}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      if (attempt === CONTA_AZUL_MAX_RETRIES || !isTransientIntegrationError(error)) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) {
      const result = await response.json();
      const rows = result?.itens ?? result?.items;
      const total = result?.itens_totais ?? result?.total_items;
      if (!Array.isArray(rows) || rows.length > pageSize || (total !== undefined && (!Number.isSafeInteger(total) || total < 0))) {
        throw new Error("Resposta financeira inválida da Conta Azul. A sincronização não foi confirmada.");
      }
      const receivedThroughPage = (page - 1) * pageSize + rows.length;
      if (total !== undefined && (receivedThroughPage > total || (rows.length < pageSize && receivedThroughPage < total))) {
        throw new Error("A Conta Azul retornou uma página incompleta. Os dados anteriores foram preservados.");
      }
      return { rows: rows as any[], total: total as number | undefined, hasMore: rows.length === pageSize && (total === undefined || receivedThroughPage < total), hasNextWindow: bounds.hasNextWindow };
    }

    const detail = (await response.text()).slice(0, 240);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === CONTA_AZUL_MAX_RETRIES) {
      throw new Error(`Conta Azul retornou ${response.status} ao consultar os lançamentos${detail ? `: ${detail}` : "."}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30_000)
      : 1000 * 2 ** attempt;
    await sleep(delay);
  }

  throw new Error("Não foi possível consultar a Conta Azul.");
}

async function fetchAllContaAzul(accessToken: string, path: string) {
  const items: any[] = [];
  const until = new Date().toISOString();
  let window = 0, page = 1;
  for (let steps = 0; steps < 1000; steps++) {
    if (steps) await sleep(CONTA_AZUL_PAGE_DELAY_MS);
    const result = await fetchContaAzulPage(accessToken, path, page, undefined, until, "w2", window);
    items.push(...result.rows);
    if (result.hasMore) page++;
    else if (result.hasNextWindow) { window++; page = 1; }
    else return items;
  }
  throw new Error("A paginacao da Conta Azul excedeu o limite sem confirmar o fim dos dados.");
}

function inContaAzulDueScope(company: IntegrationCompany, rows: any[]) {
  return rows.filter(row => {
    const due = contaAzulDate(row.data_vencimento ?? row.vencimento);
    if (!due && company === "somus") assertContaAzulImportPeriod(company, row);
    return !due || (due >= contaAzulFirstDueDate(company) && due <= "2100-12-31");
  });
}

async function contaAzulGet(token: string, path: string) {
  for (let attempt = 0; attempt <= CONTA_AZUL_MAX_RETRIES; attempt++) {
    await waitForContaAzulSlot();
    let response: Response;
    try {
      response = await fetch(`${CONTA_AZUL_API}${path}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt === CONTA_AZUL_MAX_RETRIES || !isTransientIntegrationError(error)) throw error;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < CONTA_AZUL_MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : 1000 * 2 ** attempt);
      continue;
    }
    if (response.status === 400 && path.startsWith("/v1/financeiro/eventos-financeiros/saldo-inicial?")) {
      const detail = await response.text();
      throw new Error(`Conta Azul: consulta de saldo inicial recusada. ${detail.slice(0, 1500)}`);
    }
    throw Object.assign(new Error(`Conta Azul retornou ${response.status} em ${path.split("?")[0]}.`), { status: response.status, apiPath: path });
  }
  throw new Error("Nao foi possivel consultar a Conta Azul.");
}

async function readW2Catalog(db: any, companyId: string, company: IntegrationCompany = "w2") {
  const result = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("raw_payload")
    .eq("company_id", companyId).eq("external_id", `${company}:conta-azul:catalog`).maybeSingle());
  if (result.error) throw result.error;
  const catalog = result.data?.raw_payload ?? { categories: [], costCenters: [], accounts: [], dre: null };
  return { ...catalog, categories: projectContaAzulDreCategories(catalog.categories ?? [], catalog.dre) };
}

async function refreshW2OpeningBalanceViewOperation({ context }: { context: IntegrationContext; data?: unknown }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const companyId = await resolveIntegrationCompany(context.supabase, "w2");
  if (!companyId) throw new Error("W2 nao encontrada.");
  const catalog = await readW2Catalog(context.supabase, companyId, "w2");
  if (!Array.isArray(catalog.openingBalances)) throw new Error("Saldos iniciais da W2 ainda nao conferidos na API.");
  const store = await integrationDatabase();
  const previous = await readContaAzulReadView(store, companyId);
  if (!previous || !("financialTransactions" in previous)) return { updated: false, reason: "no_saved_view" };
  const signature = (value: any) => (value?.openingBalances ?? []).map((row: any) => {
    const account = value.accounts?.find((a: any) => a.id === row.id_conta_financeira);
    return JSON.stringify([row.id_conta_financeira, row.data_competencia, row.tipo, row.saldo_inicial, account?.nome, account?.ativo]);
  }).sort();
  if (isDeepStrictEqual(signature(previous.catalog), signature(catalog))) return { updated: false, reason: "unchanged" };
  // Keep every confirmed installment intact; publish only the separately verified opening capital.
  const result = await saveContaAzulReadView(store, { companyId, metadata: previous.metadata,
    financialTransactions: previous.financialTransactions, catalog: { ...previous.catalog,
      accounts: catalog.accounts, openingBalances: catalog.openingBalances,
      openingBalancesThrough: catalog.openingBalancesThrough, openingBalancesVerifiedAt: catalog.verifiedAt } },
    null, previous.fullyReconciled, previous.readRevision);
  return { updated: result.published, reason: result.published ? "opening_balances_updated" : "newer_view_preserved" };
}

export const refreshW2OpeningBalanceView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company: z.literal("w2") }).parse(value))
  .handler(refreshW2OpeningBalanceViewOperation);

async function w2Connection(db: any, company: IntegrationCompany = "w2") {
  const companyId = await resolveIntegrationCompany(db, company);
  if (!companyId) throw new Error(`Conecte a conta de ${COMPANY_NAMES[company]} antes de importar.`);
  const connection = await checkedIntegrationQuery<any>(() => db.from("conta_azul_connections").select("*").eq("company_id", companyId).single());
  if (connection.error) throw connection.error;
  const token = await refreshContaAzulToken(connection.data, db, company);
  await verifySomusAccount(company, token);
  return { companyId, connection: connection.data, token };
}

async function renewImportLease(companyId: string, runId: string) {
  const db = await integrationDatabase();
  const lease = await db.prepare("UPDATE integration_leases SET expires_at=? WHERE key=? AND owner=? AND expires_at>? RETURNING owner")
    .bind(Date.now() + 15 * 60_000, `import:${companyId}`, runId, Date.now()).first();
  if (!lease) throw new Error("A sincronização expirou ou está em outra sessão. Inicie uma nova conferência.");
}

async function assertCompleteFinancialMetadata(db: any, companyId: string) {
  for (let offset = 0; offset < 100000; offset += 1000) {
    const result = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("complete:raw_payload->__somus_meta->detailComplete")
      .eq("company_id", companyId).eq("source", "conta_azul").order("id").range(offset, offset + 999).abortSignal(AbortSignal.timeout(15_000)));
    if (result.error) throw result.error;
    if (result.data.some((row: any) => row.complete !== true)) throw new Error("Há parcelas com detalhes pendentes. Os dados anteriores foram preservados; faça uma sincronização completa.");
    if (result.data.length < 1000) return;
  }
  throw new Error("A conferência dos detalhes excedeu o limite; importação não confirmada.");
}

async function beginContaAzulSyncOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const { companyId } = await w2Connection(context.supabase, data.company);
    const db = await integrationDatabase();
    const runId = crypto.randomUUID();
    if (!await claimLease(db, `import:${companyId}`, runId, 15 * 60_000)) throw new Error("Esta empresa já está sendo sincronizada em outra sessão. Aguarde a conclusão.");
    const startedAt = new Date().toISOString();
    try {
      const previous = await db.prepare("SELECT status,run_id FROM integration_imports WHERE company_id=?").bind(companyId).first();
      if (previous?.status === "completed" && !await contaAzulReadViewExists(db, companyId)) {
        try { await captureContaAzulReadView(context.supabase, companyId, data.company, String(previous.run_id), true); }
        catch { console.warn(JSON.stringify({ component: "conta-azul-read-view", company: data.company, message: "A leitura salva anterior foi preservada." })); }
      }
      await db.prepare("INSERT INTO integration_imports (company_id, run_id, status, started_at) VALUES (?, ?, 'running', ?) ON CONFLICT(company_id) DO UPDATE SET run_id=excluded.run_id, status='running', started_at=excluded.started_at, revenue_count=0, expense_count=0, revenue_done=0, expense_done=0, revenue_page=0, expense_page=0")
        .bind(companyId, runId, startedAt).run();
      await db.prepare("DELETE FROM integration_inventory_pages WHERE company_id=? AND run_id<>?").bind(companyId, runId).run();
      await db.prepare("DELETE FROM integration_inventory_checks WHERE company_id=? AND run_id<>?").bind(companyId, runId).run();
      return { runId, startedAt };
    } catch (error) {
      await db.prepare("DELETE FROM integration_leases WHERE key=? AND owner=?").bind(`import:${companyId}`, runId).run();
      throw error;
    }
  }

export const beginContaAzulSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(companyInput)
  .handler(beginContaAzulSyncOperation);

async function failContaAzulSyncOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany; runId: string } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const companyId = await resolveIntegrationCompany(context.supabase, data.company);
    if (!companyId) throw new Error("Empresa não encontrada.");
    const db = await integrationDatabase();
    await db.prepare("UPDATE integration_imports SET status='failed' WHERE company_id=? AND run_id=? AND status='running'").bind(companyId, data.runId).run();
    await db.prepare("DELETE FROM integration_leases WHERE key=? AND owner=?").bind(`import:${companyId}`, data.runId).run();
    return { failed: true };
  }

export const failContaAzulSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company: companyKeySchema, runId: z.string().uuid() }).parse(value))
  .handler(failContaAzulSyncOperation);

async function saveW2Rows(db: any, companyId: string, type: "revenue" | "expense", rows: any[], catalog: any, company: IntegrationCompany = "w2") {
  for (const row of rows) assertContaAzulImportPeriod(company, row);
  const ids = rows.map((row) => String(row.id));
  if (ids.some((id) => !id || id === "undefined" || id === "null") || new Set(ids).size !== ids.length) {
    throw new Error("Conta Azul retornou IDs ausentes ou repetidos na mesma pagina.");
  }
  const raw = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("*").eq("company_id", companyId).in("external_id", ids));
  if (raw.error) throw raw.error;
  const saved = await checkedIntegrationQuery<any>(() => db.from("financial_transactions").select("*").eq("company_id", companyId).eq("transaction_type", type).in("external_id", ids));
  if (saved.error) throw saved.error;
  const rawById = new Map<string, any>((raw.data ?? []).map((r: any) => [r.external_id, r]));
  const savedById = new Map<string, any>((saved.data ?? []).map((r: any) => [r.external_id, r]));
  if (rawById.size !== raw.data.length || savedById.size !== saved.data.length) throw new Error("Existem IDs duplicados no banco; a importacao foi interrompida.");
  const rawWrites: any[] = [], transactionWrites: any[] = [];
  const detailIds: string[] = [];
  let imported = 0, updated = 0, skipped = 0;
  let readingChanged = false;
  const now = new Date().toISOString();
  for (const row of rows) {
    const oldRaw = rawById.get(String(row.id));
    const payload = { ...row, __somus_imported_type: type };
    const previous = oldRaw?.raw_payload;
    if (!payload.__somus_detail && canReuseContaAzulDetail(previous, row)) {
      payload.__somus_detail = previous.__somus_detail;
      payload.__somus_detail_source_updated_at = previous.__somus_detail_source_updated_at;
      payload.__somus_detail_checked_at = previous.__somus_detail_checked_at;
    }
    assertContaAzulImportPeriod(company, payload);
    payload.__somus_meta = contaAzulMetadata(payload, catalog.categories);
    if (!payload.__somus_meta.detailComplete) detailIds.push(String(row.id));
    const mapped = mapTransaction(payload, companyId, type, catalog.categories);
    const old = savedById.get(mapped.external_id!);
    const changed = !old || Object.entries(mapped).some(([k, v]) => k === "amount" ? Number(old[k]) !== v : (old[k] ?? null) !== v);
    // PostgreSQL JSONB reorders object keys; that alone is not a source change.
    const metadataChanged = !isDeepStrictEqual({ ...previous?.__somus_meta, verifiedAt: null },
      { ...payload.__somus_meta, verifiedAt: null });
    if (metadataChanged || changed) readingChanged = true;
    const rawChanged = metadataChanged || previous?.data_alteracao !== row.data_alteracao
      || !previous?.__somus_meta?.active || previous?.__somus_meta?.detailComplete !== payload.__somus_meta.detailComplete
      || previous?.__somus_detail_checked_at !== payload.__somus_detail_checked_at || changed;
    if (rawChanged) rawWrites.push({ id: oldRaw?.id ?? crypto.randomUUID(), company_id: companyId,
      external_id: mapped.external_id, source: "conta_azul", raw_payload: payload,
      created_at: oldRaw?.created_at ?? now, imported_at: now });
    if (changed && payload.__somus_meta.detailComplete) transactionWrites.push({ ...mapped, id: old?.id ?? crypto.randomUUID(), created_at: old?.created_at ?? now });
    if (!old) imported++;
    else if (changed || rawChanged) updated++;
    else skipped++;
  }
  // Rechecking an unchanged event must not rebuild every financial reading.
  if (readingChanged) await markContaAzulReadChange(companyId);
  await insertInBatches(rawWrites, (batch) => db.from("financial_transactions_raw").upsert(batch, { onConflict: "id" }));
  await insertInBatches(transactionWrites, (batch) => db.from("financial_transactions").upsert(batch, { onConflict: "id" }));
  return { imported, updated, skipped, detailIds };
}

async function markContaAzulReadChange(companyId: string) {
  const jobs = await integrationDatabase();
  // The legacy table name also tracks financial changes that require publication.
  await jobs.prepare("INSERT INTO integration_catalog_changes (company_id,revision) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET revision=excluded.revision")
    .bind(companyId, crypto.randomUUID()).run();
}

async function syncContaAzulW2CatalogOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany; incremental?: boolean } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = context.supabase;
    const { companyId, token } = await w2Connection(db, data.company);
    const previousCatalog = data.incremental ? await readW2Catalog(db, companyId, data.company) : null;
    async function catalogRows(path: string, extra = "", pageSize = 1000) {
      const rows: any[] = [];
      for (let page = 1; page <= 1000; page++) {
        const response = await contaAzulGet(token, `${path}?pagina=${page}&tamanho_pagina=${pageSize}${extra}`);
        const items = Array.isArray(response) ? response : response.itens ?? response.items;
        if (!Array.isArray(items)) throw new Error(`Resposta de catalogo invalida em ${path}.`);
        rows.push(...items);
        const total = response.itens_totais ?? response.total_items;
        if (total !== undefined && (!Number.isSafeInteger(total) || total < rows.length || (items.length < pageSize && rows.length < total))) throw new Error(`Catálogo incompleto em ${path}.`);
        if (items.length < pageSize || (total !== undefined && rows.length >= total)) return rows;
      }
      throw new Error(`Paginacao de catalogo incompleta em ${path}.`);
    }
    const categories = await catalogRows("/v1/categorias", "&permite_apenas_filhos=false");
    const defaultCategories = await contaAzulGet(token, "/v1/categorias/configuracao-padrao?sugestao_padrao=false");
    if (!Array.isArray(defaultCategories) || defaultCategories.some(row => typeof row.tipo_operacao !== "string")
      || new Set(defaultCategories.map(row => row.tipo_operacao)).size !== defaultCategories.length) throw new Error("Categorias automaticas invalidas no Conta Azul.");
    const costCenters = await catalogRows("/v1/centro-de-custo", "&filtro_rapido=TODOS");
    const accounts = await catalogRows("/v1/conta-financeira", "&apenas_ativo=false");
    for (let offset = 0; offset < accounts.length; offset += 4) {
      await Promise.all(accounts.slice(offset, offset + 4).map(async account => {
        account.currentBalance = await contaAzulGet(token, `/v1/conta-financeira/${encodeURIComponent(account.id)}/saldo-atual`);
      }));
    }
    const dre = await contaAzulGet(token, "/v1/financeiro/categorias-dre");
    const openingBalancesThrough = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const importsOpeningBalances = data.company === "w2" || data.company === "lie" || data.company === "lie-design" || data.company === "d61";
    const openingData = importsOpeningBalances ? { openingBalances: [] as ReturnType<typeof validateOpeningBalances>, openingBalancesThrough } : {};
    if (importsOpeningBalances) {
      const openings: any[] = [];
      const recent = new Date(`${openingBalancesThrough}T00:00:00Z`);
      recent.setUTCDate(recent.getUTCDate() - 363);
      const knownAccounts = new Set((previousCatalog?.accounts ?? []).map((account: any) => account.id));
      const reuseHistory = data.incremental && Array.isArray(previousCatalog?.openingBalances)
        && accounts.every(account => knownAccounts.has(account.id));
      const openingFrom = reuseHistory ? [contaAzulFirstDueDate(data.company), recent.toISOString().slice(0, 10)].sort().at(-1)! : contaAzulFirstDueDate(data.company);
      for (const range of openingBalanceRanges(data.company, openingBalancesThrough, openingFrom)) {
        const query = new URLSearchParams({ data_inicio: `${range.from}T00:00:00`, data_fim: `${range.to}T23:59:59` });
        openings.push(...await catalogRows("/v1/financeiro/eventos-financeiros/saldo-inicial", `&${query}`, 100));
      }
      if (reuseHistory) {
        const returnedAccounts = new Set(openings.map(row => row.id_conta_financeira));
        openings.push(...previousCatalog.openingBalances.filter((row: any) => row.data_competencia < openingFrom && !returnedAccounts.has(row.id_conta_financeira)));
      }
      openingData.openingBalances = validateOpeningBalances(openings, accounts, data.company);
    }
    const payload = { categories: projectContaAzulDreCategories(categories, dre), defaultCategories, costCenters, accounts, dre, ...openingData, projectionVersion: 3, verifiedAt: new Date().toISOString() };
    const catalogId = `${data.company}:conta-azul:catalog`;
    const existing = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("id,created_at,raw_payload").eq("company_id", companyId).eq("external_id", catalogId).maybeSingle());
    if (existing.error) throw existing.error;
    const balanceKey = (rows: any[]) => rows.map(row => JSON.stringify([
      row.id_conta_financeira, row.data_competencia, row.tipo, row.saldo_inicial,
    ])).sort();
    const openingChanged = data.company === "w2" && !isDeepStrictEqual(
      balanceKey(existing.data?.raw_payload?.openingBalances ?? []), balanceKey(openingData.openingBalances ?? []));
    const semanticCatalog = (value: any) => ({ categories: value?.categories ?? [], defaultCategories: value?.defaultCategories ?? [], costCenters: value?.costCenters ?? [],
      accounts: value?.accounts ?? [], dre: value?.dre ?? null, openingBalances: balanceKey(value?.openingBalances ?? []) });
    const catalogChanged = existing.data?.raw_payload?.projectionVersion !== payload.projectionVersion
      || !isDeepStrictEqual(semanticCatalog(existing.data?.raw_payload), semanticCatalog(payload));
    if (catalogChanged) await markContaAzulReadChange(companyId);
    const catalogRow = { id: existing.data?.id ?? crypto.randomUUID(),
      company_id: companyId, external_id: catalogId, source: "conta_azul_catalog", raw_payload: payload,
      created_at: existing.data?.created_at ?? payload.verifiedAt, imported_at: payload.verifiedAt };
    const write = await checkedIntegrationQuery(() => db.from("financial_transactions_raw").upsert(catalogRow, { onConflict: "id" }));
    if (write.error) throw write.error;
    if (openingChanged) {
      try { await refreshW2OpeningBalanceViewOperation({ context }); }
      catch { console.warn("W2: saldos iniciais conferidos; a leitura anterior foi preservada ate a proxima publicacao."); }
    }
    return payload;
  }

export const syncContaAzulW2Catalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company: companyKeySchema.default("w2"), incremental: z.boolean().default(false) }).parse(value ?? {}))
  .handler(syncContaAzulW2CatalogOperation);

export const auditContaAzulOpeningBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company: companyKeySchema,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    page: z.number().int().min(1).max(1000).default(1),
  }).parse(value))
  .handler(async ({ context, data }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    if (!["w2", "lie", "lie-design", "d61"].includes(data.company)) throw new Error("A conferencia de saldo inicial esta habilitada somente para empresas com historico completo.");
    if (data.from < contaAzulFirstDueDate(data.company) || data.to < data.from) throw new Error("Periodo de saldo inicial invalido.");
    const { token } = await w2Connection(context.supabase, data.company);
    const query = new URLSearchParams({ pagina: String(data.page), tamanho_pagina: "100",
      data_inicio: `${data.from}T00:00:00`, data_fim: `${data.to}T23:59:59` });
    return contaAzulGet(token, `/v1/financeiro/eventos-financeiros/saldo-inicial?${query}`);
  });

async function syncContaAzulW2PageOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany; runId?: string; type: "revenue" | "expense"; page: number; window?: number; sequence?: number; updatedSince?: string; updatedUntil?: string } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const admin = context.supabase;
    const { companyId, token: accessToken } = await w2Connection(admin, data.company);
    if (data.runId) await renewImportLease(companyId, data.runId);
    const path = data.type === "revenue" ? CONTA_AZUL_RECEIVABLES : CONTA_AZUL_PAYABLES;
    const result = await fetchContaAzulPage(accessToken, path, data.page, data.updatedSince, data.updatedUntil, data.company, data.window);
    const externalIds = result.rows.map(row => z.string().uuid().parse(row?.id));
    if (new Set(externalIds).size !== externalIds.length) throw new Error("A Conta Azul repetiu parcelas na mesma página.");
    const rows = data.updatedSince ? inContaAzulDueScope(data.company, result.rows) : result.rows;
    const counts = rows.length ? await saveW2Rows(admin, companyId, data.type, rows, await readW2Catalog(admin, companyId, data.company), data.company)
      : { imported: 0, updated: 0, skipped: 0, detailIds: [] as string[] };
    if (data.runId) {
      const jobs = await integrationDatabase();
      const prefix = data.type === "revenue" ? "revenue" : "expense";
      const sequence = data.sequence ?? data.page;
      const recorded = await jobs.prepare(`UPDATE integration_imports SET ${prefix}_count=${prefix}_count+?, ${prefix}_page=?, ${prefix}_done=? WHERE company_id=? AND run_id=? AND status='running' AND ${prefix}_page=? RETURNING run_id`)
        .bind(rows.length, sequence, result.hasMore || result.hasNextWindow ? 0 : 1, companyId, data.runId, sequence - 1).first();
      if (!recorded) throw new Error("A ordem das páginas mudou. Reinicie a sincronização para conferir todos os registros.");
    }
    return { type: data.type, page: data.page, received: rows.length, reportedTotal: result.total ?? null, ...counts,
      hasMore: result.hasMore, hasNextWindow: result.hasNextWindow, externalIds };
  }

export const syncContaAzulW2Page = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({
    type: z.enum(["revenue", "expense"]),
    page: z.number().int().min(1).max(1000),
    window: z.number().int().min(0).max(150).optional(),
    sequence: z.number().int().min(1).max(10000).optional(),
    updatedSince: z.string().datetime().optional(),
    updatedUntil: z.string().datetime().optional(),
    company: companyKeySchema.default("w2"),
    runId: z.string().uuid().optional(),
  }).parse(value))
  .handler(syncContaAzulW2PageOperation);

async function completeContaAzulW2SyncOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany; runId: string; startedAt: string } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    if (new Date(data.startedAt).getTime() > Date.now() + 60000) throw new Error("Horario de sincronizacao invalido.");
    const companyId = await resolveIntegrationCompany(context.supabase, data.company);
    if (!companyId) throw new Error("Empresa não encontrada.");
    await renewImportLease(companyId, data.runId);
    const jobs = await integrationDatabase();
    const job = await jobs.prepare("SELECT * FROM integration_imports WHERE company_id=? AND run_id=?").bind(companyId, data.runId).first();
    if (!job || job.status !== "running" || !job.revenue_done || !job.expense_done || job.started_at !== data.startedAt) throw new Error("Leitura financeira incompleta; a sincronização não foi confirmada.");
    await assertCompleteFinancialMetadata(context.supabase, companyId);
    try {
      const catalogChange = await jobs.prepare("SELECT revision FROM integration_catalog_changes WHERE company_id=?").bind(companyId).first();
      if (catalogChange || !await contaAzulReadViewExists(jobs, companyId)) {
        await captureContaAzulReadView(context.supabase, companyId, data.company, data.runId, true);
        if (catalogChange) await jobs.prepare("DELETE FROM integration_catalog_changes WHERE company_id=? AND revision=?")
          .bind(companyId, catalogChange.revision).run();
      }
    }
    catch { console.warn(JSON.stringify({ component: "conta-azul-read-view", company: data.company, message: "Importacao validada; a leitura salva sera atualizada na proxima consulta." })); }
    const write = await context.supabase.from("conta_azul_connections").update({ connection_status: "connected", last_sync_at: data.startedAt }).eq("company_id", companyId);
    if (write.error) throw write.error;
    await jobs.prepare("UPDATE integration_imports SET status='completed' WHERE company_id=? AND run_id=?").bind(companyId, data.runId).run();
    await jobs.prepare("DELETE FROM integration_leases WHERE key=? AND owner=?").bind(`import:${companyId}`, data.runId).run();
    return { completed: true };
  }

export const completeContaAzulW2Sync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ startedAt: z.string().datetime(), company: companyKeySchema.default("w2"), runId: z.string().uuid() }).parse(value))
  .handler(completeContaAzulW2SyncOperation);

export const getContaAzulW2Installment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ id: z.string().uuid(), company: companyKeySchema.default("w2") }).parse(value))
  .handler(async ({ context, data }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const { token } = await w2Connection(context.supabase, data.company);
    return contaAzulGet(token, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(data.id)}`);
  });

const changedEventsInput = (value: unknown) => z.object({ company: companyKeySchema, page: z.number().int().min(1).max(1000),
  window: z.number().int().min(0).max(150).optional(),
  updatedSince: z.string().datetime(), updatedUntil: z.string().datetime() }).parse(value);

async function getContaAzulChangedEventsOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof changedEventsInput> }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  if (Date.parse(data.updatedSince) > Date.parse(data.updatedUntil)) throw new Error("Periodo de alteracoes invalido.");
  const { token } = await w2Connection(context.supabase, data.company);
  const bounds = contaAzulSearchWindow(data.company, data.updatedSince, data.updatedUntil, data.window ?? 0);
  const query = new URLSearchParams({ pagina: String(data.page), tamanho_pagina: "100",
    data_inicio: bounds.from, data_fim: bounds.to });
  const result = await contaAzulGet(token, `/v1/financeiro/eventos-financeiros/alteracoes?${query}`);
  const items = result.itens;
  if (!Array.isArray(items) || !Number.isSafeInteger(result.itens_totais) || result.itens_totais < 0) throw new Error("Resposta de alteracoes financeiras incompleta.");
  const ids = items.map((row: any) => z.string().uuid().parse(row.id));
  if (new Set(ids).size !== ids.length || (ids.length < 100 && (data.page - 1) * 100 + ids.length < result.itens_totais)) throw new Error("Paginacao de alteracoes financeiras incompleta.");
  return { ids, reportedTotal: result.itens_totais, hasMore: data.page * 100 < result.itens_totais, hasNextWindow: bounds.hasNextWindow };
}

export const getContaAzulChangedEvents = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(changedEventsInput).handler(getContaAzulChangedEventsOperation);

const syncEventsInput = (value: unknown) => z.object({ company: companyKeySchema, runId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(5) }).parse(value);

async function syncContaAzulChangedEventsOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof syncEventsInput> }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const { companyId, token } = await w2Connection(context.supabase, data.company);
  await renewImportLease(companyId, data.runId);
  const catalog = await readW2Catalog(context.supabase, companyId, data.company);
  const totals = { updated: 0, skipped: 0 };
  for (const id of [...new Set(data.ids)]) {
    let installments: any[];
    try { installments = await contaAzulGet(token, `/v1/financeiro/eventos-financeiros/${encodeURIComponent(id)}/parcelas`); }
    catch (error) { if (!contaAzulNotFound(error, `/v1/financeiro/eventos-financeiros/${encodeURIComponent(id)}/parcelas`)) throw error; installments = []; }
    if (!Array.isArray(installments)) throw new Error("Parcelas do evento financeiro incompletas.");
    const returnedIds = new Set(installments.map((row: any) => row.id));
    if (returnedIds.size !== installments.length) throw new Error("A API repetiu parcelas no evento financeiro.");
    const inScope = installments.filter((row: any) => {
      z.string().uuid().parse(row.id);
      if (row.evento?.id !== id || !contaAzulDate(row.data_vencimento)) throw new Error("Evento ou vencimento divergente na parcela alterada.");
      return row.data_vencimento.slice(0, 10) >= contaAzulFirstDueDate(data.company);
    });
    const scopedIds = new Set(inScope.map(row => row.id));
    // New installments are imported by the regular search, which also resolves contacts.
    for (let start = 0; start < inScope.length; start += 100) {
      const batch = inScope.slice(start, start + 100);
      const saved = await context.supabase.from("financial_transactions_raw").select("external_id,raw_payload")
        .eq("company_id", companyId).in("source", ["conta_azul", "conta_azul_archived"]).in("external_id", batch.map((row: any) => row.id));
      if (saved.error) throw saved.error;
      for (const type of ["revenue", "expense"] as const) {
        const rows = (saved.data ?? []).filter((row: any) => (row.raw_payload as any).__somus_imported_type === type)
          .map((row: any) => {
            const detail = batch.find((item: any) => item.id === row.external_id);
            if (detail.evento.tipo !== (type === "revenue" ? "RECEITA" : "DESPESA")) throw new Error("Tipo do evento financeiro divergente da parcela salva.");
            return refreshContaAzulSummaryFromDetail(row.raw_payload, detail);
          });
        if (rows.length) {
          const result = await saveW2Rows(context.supabase, companyId, type, rows, catalog, data.company);
          totals.updated += result.updated; totals.skipped += result.skipped;
        }
      }
    }
    const missingIds: string[] = [];
    for (let offset = 0; offset < 100000; offset += 1000) {
      const saved = await context.supabase.from("financial_transactions_raw").select("external_id")
        .eq("company_id", companyId).eq("source", "conta_azul")
        .eq("raw_payload->__somus_detail->evento->>id", id).order("id").range(offset, offset + 999);
      if (saved.error) throw saved.error;
      missingIds.push(...(saved.data ?? []).map(row => row.external_id).filter((key): key is string => Boolean(key) && !scopedIds.has(key)));
      if ((saved.data ?? []).length < 1000) break;
      if (offset === 99000) throw new Error("Conferencia de parcelas do evento incompleta.");
    }
    for (let start = 0; start < missingIds.length; start += 40) {
      const result = await quarantineContaAzulW2MissingOperation({ context, data: { company: data.company, runId: data.runId, ids: missingIds.slice(start, start + 40) } });
      totals.updated += result.archived.length;
    }
  }
  return totals;
}

export const syncContaAzulChangedEvents = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(syncEventsInput).handler(syncContaAzulChangedEventsOperation);

async function enrichContaAzulW2BatchOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany; runId?: string; ids: string[]; force?: boolean } }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = context.supabase;
    const { companyId, token } = await w2Connection(db, data.company);
    if (data.runId) await renewImportLease(companyId, data.runId);
    const catalog = await readW2Catalog(db, companyId, data.company);
    const raw = await db.from("financial_transactions_raw").select("external_id,raw_payload").eq("company_id", companyId)
      .eq("source", "conta_azul").in("external_id", data.ids);
    if (raw.error) throw raw.error;
    const rawRows = (raw.data ?? []).filter((row): row is typeof row & { external_id: string } => Boolean(row.external_id));
    if (rawRows.length !== new Set(data.ids).size) throw new Error("O lote contém parcelas que não pertencem à empresa selecionada.");
    const enriched: any[] = [], errors: { id: string; message: string }[] = [];
    let cached = 0, cursor = 0;
    async function worker() {
      while (cursor < rawRows.length) {
        const row = rawRows[cursor++];
        try {
          const payload = row.raw_payload as any;
          assertContaAzulImportPeriod(data.company, payload);
          if (!data.force && payload.__somus_detail && payload.__somus_detail_source_updated_at === payload.data_alteracao) { cached++; continue; }
          const detail = await contaAzulGet(token, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(row.external_id)}`);
          if (detail.id !== row.external_id) throw new Error("A API retornou um ID diferente da parcela solicitada.");
          const next = { ...payload, descricao: contaAzulDescriptionFromDetail(payload, detail),
            __somus_detail: detail, __somus_detail_source_updated_at: payload.data_alteracao,
            __somus_detail_checked_at: new Date().toISOString() };
          // Validate the complete model before committing any changed row.
          assertContaAzulImportPeriod(data.company, next);
          contaAzulMetadata(next, catalog.categories);
          enriched.push(next);
        } catch (error) { errors.push({ id: row.external_id, message: error instanceof Error ? error.message : "Falha ao detalhar parcela." }); }
        await sleep(150);
      }
    }
    await Promise.all(Array.from({ length: Math.min(12, rawRows.length) }, worker));
    for (const type of ["revenue", "expense"] as const) {
      const rows = enriched.filter((r) => r.__somus_imported_type === type);
      if (rows.length) await saveW2Rows(db, companyId, type, rows, catalog, data.company);
    }
    return { requested: data.ids.length, enriched: enriched.length, cached, errors };
  }

export const enrichContaAzulW2Batch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(120), force: z.boolean().optional(), company: companyKeySchema.default("w2"), runId: z.string().uuid().optional() }).parse(value))
  .handler(enrichContaAzulW2BatchOperation);

async function contaAzulReadState(context: IntegrationContext, company: IntegrationCompany) {
  await assertCompanyAccess(context, company);
  const companyId = await resolveIntegrationCompany(context.supabase, company);
  if (!companyId) return { companyId: null, status: null, revision: null, confirmedAt: null, progress: null };
  const db = await integrationDatabase();
  const job = await db.prepare("SELECT status,run_id,started_at,revenue_count,expense_count,revenue_page,expense_page FROM integration_imports WHERE company_id=?").bind(companyId).first();
  return { companyId, status: await readImportState(companyId), revision: job?.run_id ? String(job.run_id) : null,
    confirmedAt: job?.status === "completed" ? String(job.started_at) : null,
    progress: job ? { startedAt: String(job.started_at), revenue: Number(job.revenue_count), expense: Number(job.expense_count),
      revenuePage: Number(job.revenue_page), expensePage: Number(job.expense_page) } : null };
}

export const getContaAzulReadState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth]).inputValidator(companyInput)
  .handler(({ context, data }) => contaAzulReadState(context, data.company));

async function readContaAzulDetails(db: any, companyId: string, company: IntegrationCompany) {
  // Counting large JSON projections in the same query can exceed the database timeout.
  const counted = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).in("source", ["conta_azul", "conta_azul_archived"]).abortSignal(AbortSignal.timeout(15_000)));
  if (counted.error) throw counted.error;
  const total = counted.count;
  if (!Number.isSafeInteger(total) || total < 0 || total > 100000) throw new Error("Nao foi possivel confirmar a quantidade de detalhes financeiros.");
  const page = async (start: number) => {
    const result = await checkedIntegrationQuery<any>(() => db.from("financial_transactions_raw").select("external_id,source,metadata:raw_payload->__somus_meta,gross:raw_payload->__somus_detail->valor_composicao->valor_bruto,loss:raw_payload->__somus_detail->perda,reference:raw_payload->__somus_detail->evento->referencia->origem")
      .eq("company_id", companyId).in("source", ["conta_azul", "conta_azul_archived"])
      .order("id").range(start, start + 999).abortSignal(AbortSignal.timeout(15_000)));
    if (result.error) throw result.error;
    return result;
  };
  const first = await page(0);
  const metadata = [...first.data];
  for (let start = 1000; start < total; start += 4000) {
    const pages = await Promise.all(Array.from({ length: 4 }, (_, i) => start + i * 1000).filter(offset => offset < total).map(offset => page(offset)));
    for (const next of pages) metadata.push(...next.data);
  }
  if (metadata.length !== total) throw new Error("A quantidade de detalhes mudou durante a leitura; tente novamente.");
  if (metadata.some((row: any) => row.source === "conta_azul" && !row.metadata?.detailComplete)) throw new Error("Existem detalhes financeiros pendentes. Os dados salvos anteriores foram preservados.");
  const catalog = await readW2Catalog(db, companyId, company);
  return { metadata: metadata.map((row: any) => ({ external_id: row.external_id, source: row.source, metadata: row.source === "conta_azul" && row.metadata
    ? { ...reconcileContaAzulCategoryNames(row.metadata, catalog.categories), reporting: contaAzulReportingDetail({
      valor_composicao: { valor_bruto: row.gross }, perda: row.loss, evento: { referencia: { origem: row.reference } } }) } : row.metadata })), catalog };
}

export const refreshContaAzulReportingView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(companyInput)
  .handler(async ({ context, data }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    await assertCompanyAccess(context, data.company);
    const companyId = await resolveIntegrationCompany(context.supabase, data.company);
    if (!companyId) throw new Error("Empresa nao encontrada.");
    const store = await integrationDatabase(), previous = await readContaAzulReadView(store, companyId);
    if (!previous || !("financialTransactions" in previous) || !previous.fullyReconciled) throw new Error("Leitura conferida indisponivel.");
    const details = await readContaAzulDetails(context.supabase, companyId, data.company);
    const active = new Set(details.metadata.filter((row: any) => row.source === "conta_azul" && row.metadata?.active).map((row: any) => row.external_id));
    const oldMetadata = new Map(previous.metadata.map((row: any) => [row.external_id, row.metadata]));
    const expectedActive = new Set(previous.financialTransactions.filter(row => (oldMetadata.get(row.external_id) as any)?.active).map(row => row.external_id));
    const financialSignature = (metadata: any) => metadata && ({ active: metadata.active, sourceStatus: metadata.sourceStatus,
      paidAmount: metadata.paidAmount, outstandingAmount: metadata.outstandingAmount, payments: metadata.payments,
      detailComplete: metadata.detailComplete, sourceUpdatedAt: metadata.sourceUpdatedAt, account: metadata.account, note: metadata.note,
      allocations: metadata.allocations.map((row: any) => ({ categoryId: row.categoryId, costCenterId: row.costCenterId, amount: row.amount, weight: row.weight })) });
    // A catalog/reporting upgrade may run during sync only when all financial fields still match the immutable view.
    if (active.size !== expectedActive.size
      || details.metadata.some((row: any) => row.source === "conta_azul" && row.metadata?.active
        && !isDeepStrictEqual(financialSignature(row.metadata), financialSignature(oldMetadata.get(row.external_id))))
      || [...expectedActive].some(id => !active.has(id))) throw new Error("A importacao mudou; a leitura anterior foi preservada.");
    const result = await saveContaAzulReadView(store, { companyId, ...details, financialTransactions: previous.financialTransactions }, null, true, previous.readRevision);
    return { companyId, updated: result.published, financialRows: previous.financialTransactions.length, reason: result.published ? "reporting_details_updated" : "newer_view_preserved" };
  });

async function captureContaAzulReadView(db: any, companyId: string, company: IntegrationCompany, sourceRevision: string | null, fullyReconciled: boolean) {
  const details = await readContaAzulDetails(db, companyId, company);
  const counted = await checkedIntegrationQuery<any>(() => db.from("financial_transactions").select("id", { count: "exact", head: true })
    .eq("company_id", companyId).abortSignal(AbortSignal.timeout(15_000)));
  if (counted.error) throw counted.error;
  const total = counted.count;
  if (!Number.isSafeInteger(total) || total < 0 || total > 100000) throw new Error("Quantidade financeira indisponivel.");
  const readPage = async (start: number) => {
    const result = await checkedIntegrationQuery<any>(() => db.from("financial_transactions").select("*")
      .eq("company_id", companyId).order("id").range(start, start + 999).abortSignal(AbortSignal.timeout(15_000)));
    if (result.error) throw result.error;
    return result;
  };
  const first = await readPage(0), financialTransactions = [...first.data];
  for (let start = 1000; start < total; start += 4000) {
    const pages = await Promise.all(Array.from({ length: 4 }, (_, i) => start + i * 1000).filter(offset => offset < total).map(offset => readPage(offset)));
    for (const next of pages) financialTransactions.push(...next.data);
  }
  if (financialTransactions.length !== total) throw new Error("A leitura financeira mudou durante a captura.");
  if (!fullyReconciled && !financialTransactions.length) throw new Error("A primeira importacao ainda nao possui valores salvos.");
  const externalIds = financialTransactions.map(row => row.external_id).filter(Boolean);
  if (new Set(financialTransactions.map(row => row.id)).size !== financialTransactions.length || new Set(externalIds).size !== externalIds.length) throw new Error("A leitura financeira possui identificadores repetidos.");
  const byId = new Map(details.metadata.map((row: any) => [row.external_id, row]));
  if (financialTransactions.some(row => row.external_id && !byId.has(row.external_id))) throw new Error("Ha lancamentos sem detalhes na leitura salva.");
  await saveContaAzulReadView(await integrationDatabase(), { companyId, ...details, financialTransactions }, sourceRevision, fullyReconciled);
}

export const getContaAzulW2Data = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ company: companyKeySchema.default("w2"), knownRevision: z.string().uuid().optional(), knownOpeningRevision: z.string().max(500).optional(), preferSaved: z.boolean().optional(), compact: z.boolean().optional(), compression: z.literal("gzip").optional() }).parse(value ?? {}))
  .handler(async ({ context, data }) => {
    const db = context.supabase;
    const state = await contaAzulReadState(context, data.company);
    const companyId = state.companyId;
    if (["lie", "lie-design", "d61"].includes(data.company) && (!companyId || !state.status)) throw new Error(`A ${COMPANY_NAMES[data.company]} ainda nao possui uma importacao conferida. Conecte a conta de producao nas configuracoes.`);
    if (!companyId) return { companyId: null, metadata: [], catalog: null };
    const approvedOpenings = await readApprovedOpeningBalances(await integrationDatabase(), data.company, companyId);
    const openingRevision = approvedOpeningRevision(approvedOpenings);
    // An old browser snapshot must read the new opening even if API data has not changed.
    const knownRevision = (data.knownOpeningRevision ?? "") === openingRevision ? data.knownRevision : undefined;
    const withOpening = <T extends { catalog: any; metadata: any[] }>(result: T) => {
      const categories = projectContaAzulDreCategories(result.catalog?.categories ?? [], result.catalog?.dre);
      return packFinancialRead({ ...result, openingRevision,
        metadata: result.metadata.map(row => row.source === "conta_azul" && row.metadata
          ? { ...row, metadata: reconcileContaAzulCategoryNames(row.metadata, categories) } : row),
        catalog: result.catalog ? { ...result.catalog, categories, approvedOpenings } : result.catalog }, data.compact, data.compression);
    };
    // The worker publishes immutable financial revisions after validating every page.
    // Poll that pointer instead of rescanning live Supabase rows on each browser read.
    const saved = await readContaAzulReadView(await integrationDatabase(), companyId, knownRevision);
    if (saved?.fullyReconciled) return withOpening(saved);
    const importStatus = state.status;
    if (importStatus && importStatus !== "completed") {
      if (importStatus === "running") return { companyId, metadata: [], catalog: null, importPending: true };
    }
    if (importStatus && importStatus !== "completed") throw new Error(`A importação de ${COMPANY_NAMES[data.company]} ainda não foi concluída. Os últimos dados conferidos foram preservados.`);
    if (knownRevision && state.revision === knownRevision) return withOpening({ companyId, metadata: [], catalog: null, unchanged: true as const, readRevision: state.revision, confirmedAt: state.confirmedAt });
    const { metadata, catalog } = await readContaAzulDetails(db, companyId, data.company);
    const after = await contaAzulReadState(context, data.company);
    if (after.status && !["completed", "running"].includes(after.status)) throw new Error("A leitura financeira foi interrompida. Os dados anteriores foram preservados.");
    if (after.status === "running" || after.revision !== state.revision) return { companyId, metadata: [], catalog: null, importPending: true };
    return withOpening({ companyId, metadata, catalog,
      readRevision: state.revision, confirmedAt: state.confirmedAt });
  });

const missingInput = (value: unknown) => z.object({ ids: z.array(z.string().uuid()).min(1).max(40), company: companyKeySchema.default("w2"), runId: z.string().uuid().optional(), inventory: z.boolean().optional() }).parse(value);

async function quarantineContaAzulW2MissingOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof missingInput> }) {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = context.supabase;
    const { companyId, token } = await w2Connection(db, data.company);
    if (data.runId) await renewImportLease(companyId, data.runId);
    const raw = await db.from("financial_transactions_raw").select("id,external_id,source,raw_payload")
      .eq("company_id", companyId).in("source", ["conta_azul", "conta_azul_archived"]).in("external_id", data.ids);
    if (raw.error) throw raw.error;
    const archived: string[] = [], retained: string[] = [];
    for (const row of raw.data ?? []) {
      if (!row.external_id) continue;
      try {
        const detail = await contaAzulGet(token, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(row.external_id)}`);
        if (detail.id !== row.external_id) throw new Error("ID divergente na confirmacao da parcela ausente.");
        const payload = row.raw_payload as any;
        const due = contaAzulDate(detail.data_vencimento);
        if (!due) throw new Error("Vencimento invalido na confirmacao da parcela ausente.");
        if (due >= contaAzulFirstDueDate(data.company)) {
          const type = payload.__somus_imported_type;
          if (!["revenue", "expense"].includes(type)) throw new Error("Tipo financeiro ausente na parcela salva.");
          await saveW2Rows(db, companyId, type, [refreshContaAzulSummaryFromDetail(payload, detail)], await readW2Catalog(db, companyId, data.company), data.company);
        } else {
          await archiveMissingRow(db, companyId, row, "Vencimento alterado para fora do periodo autorizado");
          archived.push(row.external_id);
        }
        if (due >= contaAzulFirstDueDate(data.company)) retained.push(row.external_id);
      } catch (error) {
        if (!contaAzulNotFound(error, `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(row.external_id)}`)) throw error;
        await archiveMissingRow(db, companyId, row, "Parcela ausente na conta autorizada: API de detalhe retornou 404");
        archived.push(row.external_id);
      }
      if (data.runId && data.inventory) {
        const store = await integrationDatabase();
        await store.prepare("INSERT INTO integration_inventory_checks(company_id,run_id,external_id) VALUES(?,?,?) ON CONFLICT DO NOTHING")
          .bind(companyId, data.runId, row.external_id).run();
      }
    }
    return { archived, retained };
}

async function archiveMissingRow(db: any, companyId: string, row: any, reason: string) {
  if (row.source === "conta_azul_archived" && row.raw_payload?.__somus_meta?.active === false) return;
  const payload = row.raw_payload;
  const next = { ...payload, __somus_meta: { ...(payload.__somus_meta ?? {}), active: false },
    __somus_archive_reason: reason, __somus_archived_at: new Date().toISOString() };
  await markContaAzulReadChange(companyId);
  const write = await db.from("financial_transactions_raw").update({ source: "conta_azul_archived", raw_payload: next })
    .eq("company_id", companyId).eq("id", row.id);
  if (write.error) throw write.error;
}

export const quarantineContaAzulW2Missing = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(missingInput).handler(quarantineContaAzulW2MissingOperation);

function contaAzulNotFound(error: unknown, path: string) {
  return error instanceof Error && (error as any).status === 404 && (error as any).apiPath === path;
}

const inventoryRunInput = (value: unknown) => z.object({ company: companyKeySchema, runId: z.string().uuid() }).parse(value);
const inventoryPageInput = (value: unknown) => z.object({ company: companyKeySchema, runId: z.string().uuid(),
  type: z.enum(["revenue", "expense"]), page: z.number().int().min(1).max(100),
  window: z.number().int().min(0).max(150).optional() }).parse(value);

async function getContaAzulInventoryStatusOperation({ context, data }: { context: IntegrationContext; data: { company: IntegrationCompany } }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const companyId = await resolveIntegrationCompany(context.supabase, data.company);
  const store = await integrationDatabase();
  const row = await store.prepare("SELECT checked_at FROM integration_inventory_status WHERE company_id=?").bind(companyId).first();
  return { checkedAt: row?.checked_at ? String(row.checked_at) : null };
}

export const getContaAzulInventoryStatus = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator(companyInput).handler(getContaAzulInventoryStatusOperation);

async function scanContaAzulInventoryPageOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof inventoryPageInput> }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const { companyId, token } = await w2Connection(context.supabase, data.company);
  await renewImportLease(companyId, data.runId);
  const store = await integrationDatabase();
  const scopeRow = await store.prepare("SELECT ids_json FROM integration_inventory_pages WHERE company_id=? AND run_id=? AND kind='scope' AND page=0")
    .bind(companyId, data.runId).first();
  let scope: { from: string; to: string };
  if (scopeRow) {
    scope = JSON.parse(scopeRow.ids_json);
  } else {
    const [first, last] = await Promise.all([true, false].map(ascending => context.supabase.from("financial_transactions")
      .select("due_date").eq("company_id", companyId).gte("due_date", contaAzulFirstDueDate(data.company))
      .lte("due_date", "2100-12-31").order("due_date", { ascending }).limit(1).maybeSingle()));
    if (first.error || last.error) throw first.error ?? last.error;
    const from = first.data?.due_date ?? new Date().toISOString().slice(0, 10);
    scope = { from, to: last.data?.due_date ?? from };
    await store.prepare("INSERT INTO integration_inventory_pages(company_id,run_id,kind,page,total,ids_json) VALUES(?,?,'scope',0,0,?)")
      .bind(companyId, data.runId, JSON.stringify(scope)).run();
  }
  const path = data.type === "revenue" ? CONTA_AZUL_RECEIVABLES : CONTA_AZUL_PAYABLES;
  const result = await fetchContaAzulPage(token, path, data.page, undefined, undefined, data.company, data.window, CONTA_AZUL_INVENTORY_PAGE_SIZE, scope);
  const { rows, total } = result;
  if (total === undefined || total > 100000) throw new Error("Total do inventario financeiro indisponivel.");
  for (const row of rows) assertContaAzulImportPeriod(data.company, row);
  const ids = rows.map(row => z.string().uuid().parse(row.id));
  if (new Set(ids).size !== ids.length) throw new Error("Inventario financeiro com parcelas repetidas.");
  await store.prepare("INSERT INTO integration_inventory_pages(company_id,run_id,kind,page,total,ids_json) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,run_id,kind,page) DO UPDATE SET total=excluded.total,ids_json=excluded.ids_json")
    .bind(companyId, data.runId, `${data.type}:${data.window ?? 0}`, data.page, total, JSON.stringify(ids)).run();
  return { count: ids.length, hasMore: result.hasMore, hasNextWindow: result.hasNextWindow };
}

export const scanContaAzulInventoryPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(inventoryPageInput).handler(scanContaAzulInventoryPageOperation);

async function completeInventoryIds(companyId: string, runId: string, company: IntegrationCompany) {
  const store = await integrationDatabase();
  const result = await store.prepare("SELECT kind,page,total,ids_json FROM integration_inventory_pages WHERE company_id=? AND run_id=? ORDER BY kind,page").bind(companyId, runId).all();
  const scopeRow = result.results.find((row: any) => row.kind === "scope");
  if (!scopeRow) throw new Error("Inventario financeiro incompleto; nenhuma exclusao foi presumida.");
  const scope = JSON.parse(scopeRow.ids_json);
  const source = new Set<string>();
  for (const type of ["revenue", "expense"]) {
    for (let window = 0; ; window++) {
      const pages = result.results.filter((row: any) => row.kind === `${type}:${window}`);
      const total = pages[0]?.total;
      if (!Number.isSafeInteger(total) || pages.length !== Math.max(1, Math.ceil(total / CONTA_AZUL_INVENTORY_PAGE_SIZE))) throw new Error("Inventario financeiro incompleto; nenhuma exclusao foi presumida.");
      for (const [index, page] of pages.entries()) {
        if (page.page !== index + 1 || page.total !== total) throw new Error("O total ou a ordem do inventario mudou; tente novamente.");
        const ids = z.array(z.string().uuid()).parse(JSON.parse(page.ids_json));
        if (ids.length !== Math.min(CONTA_AZUL_INVENTORY_PAGE_SIZE, total - index * CONTA_AZUL_INVENTORY_PAGE_SIZE)) throw new Error("Pagina incompleta no inventario financeiro.");
        for (const id of ids) {
          if (source.has(id)) throw new Error("A API repetiu parcelas no inventario.");
          source.add(id);
        }
      }
      if (!contaAzulSearchWindow(company, undefined, "", window, scope).hasNextWindow) break;
    }
  }
  return source;
}

async function getContaAzulInventoryCandidatesOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof inventoryRunInput> }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const companyId = await resolveIntegrationCompany(context.supabase, data.company);
  if (!companyId) throw new Error("Empresa nao encontrada.");
  await renewImportLease(companyId, data.runId);
  const source = await completeInventoryIds(companyId, data.runId, data.company);
  const store = await integrationDatabase();
  const verified = await store.prepare("SELECT external_id FROM integration_inventory_checks WHERE company_id=? AND run_id=?").bind(companyId, data.runId).all();
  const checked = new Set(verified.results.map((row: any) => row.external_id));
  const candidates: string[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const rows = await context.supabase.from("financial_transactions_raw").select("external_id,source")
      .eq("company_id", companyId).in("source", ["conta_azul", "conta_azul_archived"]).order("id").range(start, start + 999);
    if (rows.error) throw rows.error;
    for (const row of rows.data ?? []) if (row.external_id && !checked.has(row.external_id) && (row.source === "conta_azul" ? !source.has(row.external_id) : source.has(row.external_id))) candidates.push(row.external_id);
    if ((rows.data ?? []).length < 1000) return { ids: candidates };
  }
  throw new Error("A leitura dos IDs salvos nao foi concluida.");
}

export const getContaAzulInventoryCandidates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(inventoryRunInput).handler(getContaAzulInventoryCandidatesOperation);

async function completeContaAzulInventoryOperation({ context, data }: { context: IntegrationContext; data: ReturnType<typeof inventoryRunInput> }) {
  await requireIntegrationAdmin(context.supabase, context.userId);
  const companyId = await resolveIntegrationCompany(context.supabase, data.company);
  if (!companyId) throw new Error("Empresa nao encontrada.");
  await renewImportLease(companyId, data.runId);
  const candidates = await getContaAzulInventoryCandidatesOperation({ context, data });
  if (candidates.ids.length) throw new Error("Existem parcelas ausentes ainda nao confirmadas; o inventario nao foi concluido.");
  const store = await integrationDatabase();
  await store.prepare("INSERT INTO integration_inventory_status(company_id,checked_at) VALUES(?,?) ON CONFLICT(company_id) DO UPDATE SET checked_at=excluded.checked_at")
    .bind(companyId, new Date().toISOString()).run();
  return { completed: true };
}

export const completeContaAzulInventory = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(inventoryRunInput).handler(completeContaAzulInventoryOperation);

export const auditContaAzulW2Page = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({
    type: z.enum(["revenue", "expense"]),
    page: z.number().int().min(1).max(1000),
    window: z.number().int().min(0).max(150).optional(),
    companyId: z.string().uuid(),
    company: companyKeySchema.default("w2"),
  }).parse(value))
  .handler(async ({ context, data }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = context.supabase;
    // Resolve only existing, user-visible rows. Audits never create companies
    // or write financial records; only OAuth renewal may update credentials.
    const company = await db.from("companies").select("id,name").eq("id", data.companyId).single();
    if (company.error) throw company.error;
    const correctCompany = data.company === "w2" ? /w2/i.test(company.data.name)
      : company.data.name.trim().toLowerCase() === COMPANY_NAMES[data.company].toLowerCase();
    if (!correctCompany || /test/i.test(company.data.name)) throw new Error(`Selecione ${COMPANY_NAMES[data.company]} de producao.`);
    const connection = await db.from("conta_azul_connections").select("*").eq("company_id", data.companyId).single();
    if (connection.error) throw connection.error;
    const token = await refreshContaAzulToken(connection.data, db, data.company);
    await verifySomusAccount(data.company, token);
    const path = data.type === "revenue" ? CONTA_AZUL_RECEIVABLES : CONTA_AZUL_PAYABLES;
    const result = await fetchContaAzulPage(token, path, data.page, undefined, undefined, data.company, data.window);
    const rows = result.rows;
    for (const row of rows) assertContaAzulImportPeriod(data.company, row);
    const catalog = await readW2Catalog(db, data.companyId, data.company);
    const incoming = rows.map((row) => mapTransaction(row, data.companyId, data.type, catalog.categories));
    const ids = [...new Set(incoming.map((row) => row.external_id).filter((id): id is string => Boolean(id)))];
    const existing = ids.length
      ? await db.from("financial_transactions").select("*").eq("company_id", data.companyId).eq("transaction_type", data.type).in("external_id", ids)
      : { data: [], error: null };
    if (existing.error) throw existing.error;
    const byId = new Map((existing.data ?? []).map((row: any) => [row.external_id, row]));
    const raw = ids.length ? await db.from("financial_transactions_raw")
      .select("external_id,raw_payload").eq("company_id", data.companyId).in("external_id", ids)
      : { data: [], error: null };
    if (raw.error) throw raw.error;
    const rawById = new Map((raw.data ?? []).map((r: any) => [r.external_id, r.raw_payload]));
    const missing: string[] = [];
    const changed: string[] = [];
    const mismatchFields: Record<string, number> = {};
    const fieldDifferences: { id: string; field: string; expected: string | number | null; actual: string | number | null }[] = [];
    for (const row of incoming) {
      if (!row.external_id) continue;
      const saved = byId.get(row.external_id) as any;
      if (!saved) { missing.push(row.external_id); continue; }
      let differs = false;
      for (const key of Object.keys(row) as (keyof typeof row)[]) {
        // The search endpoint has no payment dates; only installment baixas do.
        if (key === "payment_date") continue;
        const same = key === "amount"
          ? Math.round(Number(saved[key]) * 100) === Math.round(row.amount * 100)
          : (saved[key] ?? null) === (row[key] ?? null);
        if (!same) {
          differs = true; mismatchFields[key] = (mismatchFields[key] ?? 0) + 1;
          fieldDifferences.push({ id: row.external_id, field: key, expected: row[key] ?? null, actual: saved[key] ?? null });
        }
      }
      const payload = rawById.get(row.external_id) as any;
      const original = rows.find((r: any) => String(r.id) === row.external_id);
      const expected = contaAzulMetadata(original);
      const actual = payload?.__somus_meta;
      for (const key of ["paidAmount", "outstandingAmount", "sourceStatus"] as const) {
        const same = actual && (key === "sourceStatus" ? actual[key] === expected[key]
          : Math.round(actual[key] * 100) === Math.round(expected[key] * 100));
        if (!same) {
          differs = true; mismatchFields[key] = (mismatchFields[key] ?? 0) + 1;
          fieldDifferences.push({ id: row.external_id, field: key, expected: expected[key], actual: actual?.[key] ?? null });
        }
      }
      if (differs) changed.push(row.external_id);
    }
    return {
      type: data.type, page: data.page, received: rows.length,
      reportedTotal: result.total ?? null,
      externalIds: ids, missingIds: missing, changedIds: changed, mismatchFields, fieldDifferences,
      withoutId: incoming.filter((row) => !row.external_id).length,
      withoutCategory: incoming.filter((row) => !row.category_name).length,
      zeroAmount: incoming.filter((row) => row.amount === 0).length,
      totalsCents: rows.reduce((total, row) => {
        const source = contaAzulMetadata(row);
        total.amount += Math.round(Number(row.total ?? row.valor ?? row.amount ?? 0) * 100);
        total.paid += Math.round(source.paidAmount * 100);
        total.open += Math.round(source.outstandingAmount * 100);
        return total;
      }, { amount: 0, paid: 0, open: 0 }),
      hasMore: result.hasMore, hasNextWindow: result.hasNextWindow,
      checkedAt: new Date().toISOString(),
    };
  });

export const syncContaAzulW2 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireIntegrationAdmin(context.supabase, context.userId);
    const db = context.supabase;
    const { companyId, connection, token } = await w2Connection(db);
    const catalog = await readW2Catalog(db, companyId);
    const totals = { received: 0, paid: 0, imported: 0, updated: 0, skipped: 0 };
    for (const type of ["revenue", "expense"] as const) {
      const path = type === "revenue" ? CONTA_AZUL_RECEIVABLES : CONTA_AZUL_PAYABLES;
      const allRows = await fetchAllContaAzul(token, path);
      for (let start = 0; start < allRows.length; start += 100) {
        const rows = allRows.slice(start, start + 100);
        const counts = await saveW2Rows(db, companyId, type, rows, catalog);
        totals[type === "revenue" ? "received" : "paid"] += rows.length;
        for (const key of ["imported", "updated", "skipped"] as const) totals[key] += counts[key];
      }
    }
    const write = await db.from("conta_azul_connections").update({ connection_status: "connected", last_sync_at: new Date().toISOString() }).eq("id", connection.id);
    if (write.error) throw write.error;
    return totals;
  });

// Server-only callers reuse the authenticated import operations, not the public RPC transport.
export const contaAzulBackgroundOperations = {
  getContaAzulConnectionStatus: getContaAzulConnectionStatusOperation,
  beginContaAzulSync: beginContaAzulSyncOperation,
  failContaAzulSync: failContaAzulSyncOperation,
  syncContaAzulW2Catalog: syncContaAzulW2CatalogOperation,
  syncContaAzulW2Page: syncContaAzulW2PageOperation,
  completeContaAzulW2Sync: completeContaAzulW2SyncOperation,
  enrichContaAzulW2Batch: enrichContaAzulW2BatchOperation,
  getContaAzulChangedEvents: getContaAzulChangedEventsOperation,
  syncContaAzulChangedEvents: syncContaAzulChangedEventsOperation,
  quarantineContaAzulW2Missing: quarantineContaAzulW2MissingOperation,
  getContaAzulInventoryStatus: getContaAzulInventoryStatusOperation,
  scanContaAzulInventoryPage: scanContaAzulInventoryPageOperation,
  getContaAzulInventoryCandidates: getContaAzulInventoryCandidatesOperation,
  completeContaAzulInventory: completeContaAzulInventoryOperation,
};
export const backgroundIntegrationSecurity = { integrationDatabase, claimLease, encryptToken, decryptToken, requireIntegrationAdmin, resolveIntegrationCompany };
