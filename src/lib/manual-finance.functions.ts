import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRuntimeEnv } from "./runtime-env";
import { readPlatformAccess } from "./platform-access.functions";
import { MANUAL_COMPANY_ID, MANUAL_COMPANY_KEY, MANUAL_COMPANY_NAME } from "./manual-company";
import { applyManualChange, emptyManualDocument, manualChangeContent, manualChangeSchema, manualSnapshot, type ManualDocument } from "./manual-finance";

async function database() {
  const db = getRuntimeEnv()?.DB;
  if (!db) throw new Error("Banco de lancamentos indisponivel");
  await db.prepare("CREATE TABLE IF NOT EXISTS manual_financial_documents (company_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  return db;
}
async function authorize(context: { supabase: any; userId: string }, write = false) {
  const access = await readPlatformAccess(context);
  const company = access.companies.find(company => company.key === MANUAL_COMPANY_KEY && company.id === MANUAL_COMPANY_ID);
  if (!company || (!access.securityReady && !access.isAdmin)) throw new Error("Empresa manual nao autorizada");
  const controller = access.isAdmin ? true : await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "controller" }).then((r: any) => !r.error && r.data === true);
  if (write && !controller) throw new Error("Seu perfil pode consultar, mas nao editar lancamentos");
  return { company, canWrite: controller };
}
async function read(db: any): Promise<ManualDocument> {
  const row = await db.prepare("SELECT revision, payload FROM manual_financial_documents WHERE company_id=?").bind(MANUAL_COMPANY_ID).first();
  if (!row) return emptyManualDocument();
  const document = JSON.parse(row.payload) as ManualDocument;
  if (document.revision !== row.revision || !Array.isArray(document.entries)) throw new Error("Cadastro manual precisa de conferencia");
  return document;
}

export const createManualTestCompany = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (role.error || role.data !== true) throw new Error("Somente administradores podem criar a empresa teste");
    const existing = await context.supabase.from("companies").select("id,name").eq("id", MANUAL_COMPANY_ID).maybeSingle();
    if (existing.error) throw new Error("Nao foi possivel conferir o cadastro da empresa");
    if (existing.data && existing.data.name !== MANUAL_COMPANY_NAME) throw new Error("Identificador ja utilizado por outra empresa");
    if (!existing.data) {
      const result = await context.supabase.from("companies").upsert({ id: MANUAL_COMPANY_ID, name: MANUAL_COMPANY_NAME, status: "active" }, { onConflict: "id", ignoreDuplicates: true });
      if (result.error) throw new Error("Nao foi possivel criar a empresa teste");
    }
    // Never clear or seed an existing company's financial records.
    await database();
    return { id: MANUAL_COMPANY_ID, key: MANUAL_COMPANY_KEY, name: MANUAL_COMPANY_NAME };
  });

export const getManualCompanyData = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.literal(MANUAL_COMPANY_ID) }).strict().parse(input))
  .handler(async ({ context }) => {
    const access = await authorize(context), document = await read(await database());
    const confirmedAt = new Date().toISOString();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { company: access.company, canWrite: access.canWrite, revision: document.revision, entries: document.entries,
      confirmedAt, snapshot: manualSnapshot(document, today, confirmedAt) };
  });

export const changeManualCompanyData = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => manualChangeSchema.parse(input))
  .handler(async ({ context, data }) => {
    await authorize(context, true);
    const db = await database(), previous = await read(db), at = new Date().toISOString();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(manualChangeContent(data)));
    const fingerprint = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const result = applyManualChange(previous, data, context.userId, at, fingerprint);
    if (result.repeated) return { revision: previous.revision, saved: 0, skipped: result.skipped };
    const serialized = JSON.stringify(result.document);
    const updated = previous.revision === 0
      ? await db.prepare("INSERT INTO manual_financial_documents(company_id,revision,payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(company_id) DO NOTHING")
        .bind(MANUAL_COMPANY_ID, result.document.revision, serialized, at).run()
      : await db.prepare("UPDATE manual_financial_documents SET revision=?,payload=?,updated_at=? WHERE company_id=? AND revision=?")
        .bind(result.document.revision, serialized, at, MANUAL_COMPANY_ID, previous.revision).run();
    if (updated.meta.changes !== 1) throw new Error("Outro usuario alterou os dados. Recarregue esta tela antes de salvar.");
    return { revision: result.document.revision, saved: result.saved, skipped: result.skipped };
  });
