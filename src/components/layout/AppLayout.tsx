import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Header } from "./Header";
import { SidebarFilters } from "./SidebarFilters";
import { DashboardTabs } from "./DashboardTabs";
import { BasisFiltersProvider, FiltersProvider, useFilters } from "@/context/FiltersContext";
import { hasConfirmedCompanyData, isCompanyDataAwaitingRead, useLiveSyncStatus } from "@/data/live-sync";
import { AppUserProvider } from "@/context/AppUserContext";
import { Toaster } from "@/components/ui/sonner";
import { ContentBoundary } from "./ContentBoundary";
import { selectedCompanies, selectedBases } from "@/lib/filter-options";

function SourceNotice() {
  const filters = useFilters();
  const sync = useLiveSyncStatus();
  const companies = selectedCompanies(filters);
  const messages = (companies.length ? companies : filters.companyOptions.map(c => c.id)).map(company => sync.sourceErrors[company]);
  return <>{messages.filter(Boolean).map(message => <p role="status" key={message} className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{message}</p>)}
    {sync.status === "error" && <p role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm">Atualizacao indisponivel. Exibindo a ultima leitura concluida, sem substituir valores por zero.</p>}</>;
}

function FilteredContent({ children, financial }: { children: ReactNode; financial: boolean }) {
  const filters = useFilters();
  const { dateError } = filters;
  const companies = selectedCompanies(filters);
  const scope = companies.length ? companies : filters.companyOptions.map(c => c.id);
  const sync = useLiveSyncStatus();
  if (financial && dateError) return <section role="alert" className="border-l-2 border-destructive p-4">
    <h1 className="text-xl font-semibold">Intervalo de datas invalido</h1>
    <p className="mt-2 text-sm text-muted-foreground">{dateError}</p>
  </section>;
  if (financial && scope.some(company => isCompanyDataAwaitingRead(company))) return <section role="status" aria-live="polite" className="py-8">
    <h1 className="text-xl font-semibold">Carregando dados da empresa</h1>
    <p className="mt-2 text-sm text-muted-foreground">Aguardando a leitura confirmada dos lançamentos.</p>
  </section>;
  if (financial && scope.some(company => (sync.sourceErrors[company] || sync.status === "error") && !hasConfirmedCompanyData(company))) return <section role="alert" className="border-l-2 border-amber-500 p-4">
    <h1 className="text-xl font-semibold">Dados aguardando conferência</h1>
    <p className="mt-2 text-sm text-muted-foreground">Ainda não há uma leitura confirmada desta empresa. Os valores não serão apresentados como zero.</p>
  </section>;
  return children;
}

function CompanySurface({ children }: { children: ReactNode }) {
  const { company } = useFilters();
  return <div data-company={company} className="relative min-h-screen bg-background text-foreground">{children}</div>;
}

function BasisViews({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const filters = useFilters();
  const bases = selectedBases(filters);
  if (!enabled || bases.length === 1 || filters.basisLocked) return children;
  return <div className="space-y-10">{bases.map(basis => <section key={basis} aria-label={basis === "cash" ? "Visao Caixa" : "Visao Competencia"} className="min-w-0 border-t border-border pt-4">
    <h2 className="mb-4 text-sm font-semibold text-primary">{basis === "cash" ? "Caixa (Fluxo)" : "Competência (DRE)"}</h2>
    <BasisFiltersProvider basis={basis}><ContentBoundary>{children}</ContentBoundary></BasisFiltersProvider>
  </section>)}</div>;
}

export function AppLayout({ children, userId, dataVersion }: { children: ReactNode; userId: string; dataVersion: number }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const transactionType = path === "/receitas" ? "revenue" : path === "/despesas" ? "expense" : undefined;
  return (
    <AppUserProvider value={userId}>
    <FiltersProvider key={userId} userId={userId} transactionType={transactionType} dataVersion={dataVersion} cashOnly={path === "/fluxo-caixa"} includeOpenCash={path === "/dre" || path === "/dre-simulacao"}>
      <CompanySurface>
        <div className="relative z-10">
          <Header />
          <div className="flex flex-col lg:flex-row">
            <SidebarFilters />
            <div className="flex-1 min-w-0">
              <DashboardTabs />
              <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6">
                <SourceNotice />
                <ContentBoundary><FilteredContent financial={path !== "/configuracoes" && path !== "/lancamentos"}><BasisViews enabled={path !== "/configuracoes" && path !== "/lancamentos"}>{children}</BasisViews></FilteredContent></ContentBoundary>
              </main>

            </div>
          </div>
        </div>
        <Toaster richColors position="top-right" />
      </CompanySurface>
    </FiltersProvider>
    </AppUserProvider>
  );
}
