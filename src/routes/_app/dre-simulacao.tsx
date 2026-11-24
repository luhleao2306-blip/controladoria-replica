import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layers, PanelsTopLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DreSimulation } from "@/components/common/DreSimulation";
import { ConsolidatedDreSimulation } from "@/components/common/ConsolidatedDreSimulation";
import { cn } from "@/lib/utils";
import { useFilters } from "@/context/FiltersContext";
import { useAppUserId } from "@/context/AppUserContext";
import { filterSelectionKey, selectedCompanies } from "@/lib/filter-options";
import { getMonthlyKpis, getTransactions } from "@/lib/finance";
import type { Simulation } from "@/lib/dre-simulation";

export const Route = createFileRoute("/_app/dre-simulacao")({
  head: () => ({ meta: [{ title: "DRE Simulação - Modblue Controladoria" }] }), component: DreSimulationPage,
});

function DreSimulationPage() {
  const filters = useFilters(), userId = useAppUserId();
  const [drafts, setDrafts] = useState(new Map<string, Simulation>());
  const [mode, setMode] = useState<"consolidated" | "separate">("consolidated");
  const scopes = useMemo(() => {
    const selected = selectedCompanies(filters);
    return filters.companyOptions.filter(company => !selected.length || selected.includes(company.id)).map(company => {
      const scope = { ...filters, company: company.id, companies: [company.id] };
      const key = `${userId}:${filterSelectionKey(scope)}`;
      return { company, scope, key, data: getMonthlyKpis(scope), transactions: getTransactions(scope),
        onDraft: (draft: Simulation) => setDrafts(previous => previous.get(key) === draft ? previous : new Map(previous).set(key, draft)) };
    });
  }, [filters, userId]);
  const consolidated = scopes.length > 1 && mode === "consolidated";
  const simulations = scopes.flatMap(scope => drafts.get(scope.key) ? [drafts.get(scope.key)!] : []);
  return <>
    <PageHeader title="DRE Simulação" description={`${filters.periodLabel} · ${filters.basis === "cash" ? "Caixa: pagamentos e abertos por vencimento" : "Competência"}`} />
    {scopes.length > 1 && <div role="group" aria-label="Visualização das empresas" className="mb-5 inline-flex max-w-full flex-wrap rounded-md border border-border p-1">
      {([{ value: "consolidated", label: "Consolidado", icon: Layers }, { value: "separate", label: "Por empresa", icon: PanelsTopLeft }] as const).map(option =>
        <button key={option.value} type="button" aria-pressed={mode === option.value} onClick={() => setMode(option.value)} className={cn("inline-flex items-center gap-2 rounded px-3 py-2 text-sm", mode === option.value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}><option.icon size={16} />{option.label}</button>)}
    </div>}
    {consolidated && simulations.length === scopes.length && <ConsolidatedDreSimulation simulations={simulations} onSeparate={() => setMode("separate")} />}
    <div className="space-y-10">{scopes.map(({ company, scope, key, data, transactions, onDraft }) =>
      <DreSimulation key={key} company={company} filters={scope} initial={drafts.get(key)} hidden={consolidated}
        data={data} transactions={transactions} onDraft={onDraft} />)}</div>
  </>;
}
