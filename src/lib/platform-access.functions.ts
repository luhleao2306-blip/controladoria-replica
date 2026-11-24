import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { companyKey, type PlatformAccess } from "./platform-access";
import { z } from "zod";
import { MANUAL_COMPANY_ID, MANUAL_COMPANY_KEY, MANUAL_COMPANY_NAME } from "./manual-company";

const accessSchema = z.object({ isAdmin: z.boolean(), securityReady: z.boolean(), companies: z.array(z.object({
  id: z.string().uuid(), name: z.string(), key: z.enum(["w2", "somus", "d61", "lie", "lie-design"]),
  document: z.string().nullable().optional(),
})) });

export async function readPlatformAccess(context: { supabase: any; userId: string }): Promise<PlatformAccess> {
  // Both reads remain subject to this user's RLS, but need not wait for one
  // another over the network. Capture rejection for the legacy RPC fallback.
  const manualRequest = Promise.resolve().then(() => context.supabase.from("companies")
    .select("id,name,document").eq("id", MANUAL_COMPANY_ID).maybeSingle())
    .catch(error => ({ data: null, error }));
  const result = await context.supabase.rpc("platform_access");
  if (!result.error) {
    const parsed = accessSchema.safeParse(result.data);
    if (!parsed.success) throw new Error("O cadastro de acessos precisa ser conferido pelo administrador.");
    // Existing RLS memberships decide who may see this non-Conta-Azul company too.
    const manual = await manualRequest;
    if (manual.error) throw new Error("Nao foi possivel conferir o acesso a empresa manual.");
    if (manual.data && manual.data.name !== MANUAL_COMPANY_NAME) throw new Error("Cadastro da empresa manual divergente.");
    return { ...parsed.data, companies: [...parsed.data.companies, ...(manual.data ? [{ ...manual.data, key: MANUAL_COMPANY_KEY }] : [])] };
  }
  // Until the migration is applied, only the existing administrator may enter.
  if (result.error.code !== "PGRST202" && result.error.code !== "42883") throw new Error("Nao foi possivel conferir seu acesso. Tente novamente.");
  const role = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (role.error || role.data !== true) return { isAdmin: false, companies: [], securityReady: false };
  const companies = await context.supabase.from("companies").select("id,name,document");
  if (companies.error) throw new Error("Nao foi possivel conferir as empresas autorizadas.");
  return { isAdmin: true, securityReady: false, companies: (companies.data ?? []).flatMap((c: {id:string;name:string;document?:string|null}) => {
    const key = c.id === MANUAL_COMPANY_ID && c.name === MANUAL_COMPANY_NAME ? MANUAL_COMPANY_KEY : companyKey(c.name);
    return key ? [{ ...c, key }] : [];
  }) };
}

export async function assertCompanyAccess(context: { supabase: any; userId: string }, company: string) {
  const access = await readPlatformAccess(context);
  if (!access.isAdmin && !access.companies.some(c => c.key === company)) throw new Error("Empresa nao autorizada para este usuario.");
  return access;
}

export const getPlatformAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(({ context }) => readPlatformAccess(context));
