import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { createManualTestCompany } from "@/lib/manual-finance.functions";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/StatusBadge";
import { InviteManager } from "@/components/settings/InviteManager";
import { CollaboratorsManager } from "@/components/settings/CollaboratorsManager";
import { OperationalSettings } from "@/components/settings/OperationalSettings";
import { ContaAzulIntegration } from "@/components/settings/ContaAzulIntegration";

import { Building2, Link2, Target, Mail } from "lucide-react";
import { usePlatformAccess } from "@/context/PlatformAccessContext";

export const Route = createFileRoute("/_app/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Modblue Controladoria" },
      { name: "description", content: "Empresas, integrações, metas, regras de alerta e usuários." },
    ],
  }),
  component: ConfiguracoesPage,
});

function Section({ icon: Icon, title, description, children }: {
  icon: React.ElementType; title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <Card className="p-6 rounded-2xl shadow-sm border-border/60">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

function ConfiguracoesPage() {
  const access = usePlatformAccess();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Configurações" description="Gestão de empresas, integrações, orçamento e alertas." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section icon={Building2} title="Empresas" description="Unidades operacionais e CNPJ.">
          <ul className="space-y-2 text-sm">
            {access.companies.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2">
                <div><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.document || "Documento não informado"}</p></div>
                <StatusBadge tone="positive">Ativa</StatusBadge>
              </li>
            ))}
          </ul>
          {access.companies.some(company => company.key === "manual-test") ? <Link to="/lancamentos" className="mt-3 inline-flex rounded-md border px-3 py-2 text-sm">Lançamentos manuais</Link>
            : access.isAdmin && <button type="button" disabled={creating} className="mt-3 rounded-md border px-3 py-2 text-sm" onClick={async () => {
              setCreating(true); try { await createManualTestCompany(); toast.success("Empresa Teste criada sem lancamentos. Atualize a pagina para selecionar."); }
              catch (reason) { toast.error(reason instanceof Error ? reason.message : "Nao foi possivel criar"); } finally { setCreating(false); }
            }}>{creating ? "Criando..." : "Criar Empresa Teste manual"}</button>}
        </Section>

        {access.isAdmin && <Section icon={Link2} title="Integração Conta Azul">
          <ContaAzulIntegration />
        </Section>}

        <Section icon={Target} title="Metas, orcamento e alertas" description="Metas mensais da empresa selecionada.">
          <OperationalSettings />
        </Section>

        <Section icon={Mail} title="Relatorios por e-mail">
          <StatusBadge tone="neutral">Nao configurado</StatusBadge>
          <p className="mt-3 text-sm text-muted-foreground">Nenhum envio automatico esta ativo.</p>
        </Section>

        {access.isAdmin && access.securityReady && <InviteManager />}

        {access.isAdmin && <div className="lg:col-span-2">
          <CollaboratorsManager />
        </div>}
      </div>

    </>
  );
}
