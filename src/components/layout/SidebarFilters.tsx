import { useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { getFilterOptions } from "@/lib/filter-options";
import { selectedCompanies, selectedYears, selectedMonths, selectedQuarters, selectedCategories, selectedCostCenters, selectedPayments, selectedFinancialAccounts } from "@/lib/filter-options";
import { MultiSelect } from "@/components/common/MultiSelect";
import { ChevronLeft, ChevronRight, Filter, RotateCcw, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFilters } from "@/context/FiltersContext";
import {
  type CompanyId,
} from "@/data/mock";
import { MONTHS_PT } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SidebarFilters() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);
  const filters = useFilters();
  const {
    basis,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    resetFilters,
    activeFilterCount,
  } = filters;
  const path = useRouterState({ select: (state) => state.location.pathname });
  const type = path === "/receitas" ? "revenue" : path === "/despesas" ? "expense" : undefined;
  const options = getFilterOptions(filters, type);
  const withSelected = (available: string[], selected: string[]) => [...new Set([...available, ...selected])].sort((a,b) => a.localeCompare(b, "pt-BR"))
    .map(value => ({ value, label: value }));

  return (
    <aside
      className={cn(
        "shrink-0 border-b border-border bg-sidebar lg:sticky lg:top-20 lg:h-[calc(100dvh-5rem)] lg:border-b-0 lg:border-r lg:border-border",
        collapsed ? "lg:w-20" : "lg:w-80",
      )}
    >
      <div className={cn("px-4 py-2 lg:h-full lg:overflow-y-auto lg:p-4", collapsed ? "lg:space-y-4" : "space-y-4")}>
        <div className="flex items-center justify-between">
            <div className={cn("flex items-center gap-2", collapsed && "lg:hidden")}>
              <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
              <p className="text-xs font-semibold text-muted-foreground">
                Filtros {collapsed && <span className="ml-2 tabular-nums">{activeFilterCount} ativos</span>}
              </p>
            </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg hover:bg-accent text-muted-foreground"
            aria-label={collapsed ? "Abrir filtros" : "Recolher filtros"}
            title={collapsed ? "Abrir filtros" : "Recolher filtros"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </Button>
        </div>

        {collapsed ? (
          <div className="hidden flex-col items-center gap-4 lg:flex">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
              <Filter size={18} />
            </div>
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground border border-border">
              {activeFilterCount}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                <span className="text-[10px] font-bold text-primary">{activeFilterCount} Ativos</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-7 text-[10px] font-bold tracking-wider text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="mr-2 h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>

            <div className="space-y-5">
              <FilterField label="Empresas">
                <MultiSelect label="Empresas" values={selectedCompanies(filters)} onChange={values => filters.setCompanies(values as Exclude<CompanyId, "all">[])} options={filters.companyOptions.map(c => ({ value: c.id, label: c.name }))} allLabel="Todas as autorizadas" />
              </FilterField>

              <div className="grid grid-cols-2 gap-4">
                <FilterField label="Ano Fiscal">
                  <MultiSelect label="Anos" values={selectedYears(filters).map(String)} onChange={values => filters.setYears(values.map(Number))} options={[...new Set([...options.years, ...selectedYears(filters)])].sort((a,b) => b-a).map(y => ({ value: String(y), label: String(y) }))} allLabel="Todos os anos" />
                </FilterField>

                <FilterField label="Mês">
                  <MultiSelect label="Meses" values={selectedMonths(filters).map(String)} onChange={values => filters.setMonths(values.map(Number))} options={MONTHS_PT.map((m,i) => ({ value: String(i+1), label: m, disabled: options.months[i] === 0 }))} allLabel="Todos os meses" />
                </FilterField>
              </div>

              <FilterField label="Base de Cálculo">
                <MultiSelect label="Base de Cálculo" disabled={filters.basisLocked} values={filters.bases ?? [basis]} onChange={values => filters.setBases(values as ("cash" | "accrual")[])} allLabel="Ambas as bases" options={[
                  { value: "accrual", label: "Competência (DRE)" }, { value: "cash", label: "Caixa (Fluxo)" },
                ]} />
              </FilterField>

              <FilterField label="Categoria Financeira">
                <MultiSelect label="Categoria Financeira" values={selectedCategories(filters)} onChange={filters.setCategories} allLabel="Todas as Categorias" options={withSelected(options.categories, selectedCategories(filters))} />
              </FilterField>
              
              <FilterField label="Centro de custo">
                <MultiSelect label="Centro de custo" values={selectedCostCenters(filters)} onChange={filters.setCostCenters} allLabel="Todos os centros" options={withSelected(options.costCenters, selectedCostCenters(filters))} />
              </FilterField>
              <FilterField label="Trimestre">
                <MultiSelect label="Trimestre" values={selectedQuarters(filters).map(String)} onChange={values => filters.setQuarters(values.map(Number) as (1 | 2 | 3 | 4)[])} allLabel="Todos os trimestres" options={[1,2,3,4].map(q => ({ value: String(q), label: `${q}º trimestre` }))} />
              </FilterField>
              <div className="grid grid-cols-1 gap-3">
                <FilterField label="Data inicial"><Input type="date" aria-label="Data inicial" aria-invalid={Boolean(filters.dateError)} aria-describedby={filters.dateError ? "filter-date-error" : undefined} value={customStart} onInput={(e) => setCustomStart(e.currentTarget.value)} onChange={(e) => setCustomStart(e.target.value)} /></FilterField>
                <FilterField label="Data final"><Input type="date" aria-label="Data final" aria-invalid={Boolean(filters.dateError)} aria-describedby={filters.dateError ? "filter-date-error" : undefined} value={customEnd} min={customStart || undefined} onInput={(e) => setCustomEnd(e.currentTarget.value)} onChange={(e) => setCustomEnd(e.target.value)} /></FilterField>
                {(filters.dateRanges ?? []).map((range, index) => <div key={index} className="space-y-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between"><Label className="text-xs text-muted-foreground">Período {index + 2}</Label><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remover período ${index + 2}`} title="Remover período" onClick={() => filters.setDateRanges(filters.dateRanges!.filter((_, i) => i !== index))}><X size={14} /></Button></div>
                  <Input type="date" aria-label={`Data inicial do período ${index + 2}`} value={range.start} onInput={event => filters.setDateRanges(filters.dateRanges!.map((r,i) => i === index ? { ...r, start: event.currentTarget.value } : r))} onChange={event => filters.setDateRanges(filters.dateRanges!.map((r,i) => i === index ? { ...r, start: event.target.value } : r))} />
                  <Input type="date" aria-label={`Data final do período ${index + 2}`} min={range.start || undefined} value={range.end} onInput={event => filters.setDateRanges(filters.dateRanges!.map((r,i) => i === index ? { ...r, end: event.currentTarget.value } : r))} onChange={event => filters.setDateRanges(filters.dateRanges!.map((r,i) => i === index ? { ...r, end: event.target.value } : r))} />
                </div>)}
                {filters.dateError && <p id="filter-date-error" role="alert" className="text-xs text-destructive">{filters.dateError}</p>}
                <Button variant="ghost" size="sm" disabled={(filters.dateRanges?.length ?? 0) >= 50} onClick={() => filters.setDateRanges([...(filters.dateRanges ?? []), { start: "", end: "" }])}><Plus className="mr-2 h-3.5 w-3.5" /> Adicionar período</Button>
                {(customStart || customEnd || filters.dateRanges?.length) ? <Button variant="ghost" size="sm" onClick={() => { setCustomStart(""); setCustomEnd(""); filters.setDateRanges([]); }}><RotateCcw className="h-3.5 w-3.5" /> Limpar datas</Button> : null}
              </div>
              {(options.accounts.length > 0 || selectedFinancialAccounts(filters).length > 0) && <FilterField label="Conta financeira">
                <MultiSelect label="Conta financeira" values={selectedFinancialAccounts(filters)} onChange={filters.setFinancialAccounts} allLabel="Todas as contas" options={withSelected(options.accounts, selectedFinancialAccounts(filters))} />
              </FilterField>}
              <FilterField label="Situação">
                <MultiSelect label="Situação" values={selectedPayments(filters)} onChange={values => filters.setPayments(values as ("paid" | "open")[])} allLabel="Todas" options={[
                  { value: "paid", label: "Pago / Liquidado", disabled: options.paid === 0 },
                  { value: "open", label: "Em aberto / Em atraso", disabled: options.open === 0 },
                ]} />
              </FilterField>

            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="ml-1 text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
