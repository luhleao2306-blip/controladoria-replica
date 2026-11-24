import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRuntimeEnv } from "./runtime-env";

export type Collaborator = {
  companyIds: string[];
  userId: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string | null;
  lastSignInAt: string | null;
};

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error("Nao foi possivel verificar as permissoes.");
  if (!isAdmin) throw new Error("Apenas administradores podem gerenciar colaboradores.");
}

export const getCollaboratorAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (error) throw new Error("Nao foi possivel verificar as permissoes.");
    return { isAdmin: Boolean(data), configured: Boolean(getRuntimeEnv()?.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) };
  });

export const listCollaborators = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Collaborator[]> => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const users = [];
    for (let page = 1; ; page++) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      users.push(...list.users);
      if (list.users.length < 200) break;
    }

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("users_profiles")
      .select("user_id, full_name, role");
    const { data: roles, error: roleError } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: memberships, error: membershipError } = await (supabaseAdmin as any).from("user_company_access").select("user_id, company_id");
    if (membershipError) throw new Error("A protecao de clientes ainda precisa ser ativada no banco.");
    if (profileError || roleError) throw new Error("Nao foi possivel consultar os perfis e permissoes.");

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const roleMap = new Map((roles ?? []).map((r) => [r.user_id, r.role as string]));

    return users.map((u) => ({
      userId: u.id,
      email: u.email ?? "",
      fullName: profileMap.get(u.id)?.full_name ?? "",
      role: (roles ?? []).some(r => r.user_id === u.id && r.role === "admin") ? "admin" : roleMap.get(u.id) ?? "viewer",
      companyIds: (memberships ?? []).filter((m: any) => m.user_id === u.id).map((m: any) => m.company_id),
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
    }));
  });

export const updateCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; fullName: string; role: string; companyIds: string[] }) => {
    const allowed = ["admin", "controller", "viewer"];
    if (!input.userId) throw new Error("Colaborador inválido.");
    if (!allowed.includes(input.role)) throw new Error("Perfil inválido.");
    if (!Array.isArray(input.companyIds) || input.companyIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("Empresas invalidas.");
    return { userId: input.userId, fullName: input.fullName.trim(), role: input.role, companyIds: [...new Set(input.companyIds)] };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context as any);
    if (data.userId === context.userId && data.role !== "admin") throw new Error("Voce nao pode remover o proprio acesso administrativo.");
    const { error } = await (context.supabase as any).rpc("admin_set_collaborator", {
      _user_id: data.userId, _full_name: data.fullName, _role: data.role, _company_ids: data.companyIds,
    });
    if (error) throw new Error("Nao foi possivel salvar os acessos. Nenhuma permissao foi alterada.");
    return { ok: true };
  });

export const deleteCollaborator = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!input.userId) throw new Error("Colaborador inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context as any);
    if (data.userId === (context as any).userId) {
      throw new Error("Você não pode excluir a sua própria conta.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
