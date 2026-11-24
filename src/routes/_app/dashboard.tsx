import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CurrentCashBalance } from "@/components/common/CurrentCashBalance";
import { CategorySort } from "@/components/common/CategorySort";
import { compareCategories, type CategoryOrder } from "@/lib/dre-details";
import { Activity, BarChart3, Download, TrendingUp, Wallet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/common/KpiCard";
import { ChartCard, MultiBarChart } from "@/components/common/FinancialChart";
import { DataTable, type Column } from "@/components/common/DataTable";
import { useFilters } from "@/context/FiltersContext";
import { getAggregateKpis, getMonthlyKpis, getTransactions, getVariation, groupByCategory } from "@/lib/finance";
import { formatBRL, formatPercent, MONTHS_PT } from "@/lib/format";
import { financialAmountClass } from "@/lib/financial-semantics";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard financeiro - Modblue" }] }),
  component: DashboardPage,
});

type CategoryRow = { category: string; revenue: number; expense: number; result: number };

function DashboardPage() {
  const filters = useFilters();
  const [order, setOrder] = useState<CategoryOrder>("amount-desc");
  const aggregate = getAggregateKpis(filters);
  const monthly = getMonthlyKpis(filters);
  const rows = useMemo(() => {
    const txs = getTransactions(filters);
    const categories = new Map<string, CategoryRow>();
    for (const type of ["revenue", "expense"] as const) {
      for (const { name, amount } of groupByCategory(txs.filter((t) => t.type === type))) {
        const row = categories.get(name) ?? { category: name, revenue: 0, expense: 0, result: 0 };
        row[type] += amount;
        row.result = row.revenue - row.expense;
        categories.set(name, row);
      }
    }
    return [...categories.values()].sort((a, b) => compareCategories(
      { category: a.category, total: a.revenue + a.expense }, { category: b.category, total: b.revenue + b.expense }, order));
  }, [filters, order]);

  const chart = monthly.map((k) => ({
    period: `${MONTHS_PT[k.monthIndex]} ${k.year}`,
    revenue: k.grossRevenue + k.financialIncome + (k.otherIncome ?? 0),
    expense: k.taxes + k.commissions + (k.discounts ?? 0) + k.operationalCosts
      + k.operationalExpenses + k.adminExpenses + k.commercialExpenses
      + k.financialExpense + (k.otherExpense ?? 0),
    result: k.netProfit,
  }));
  const grossProfit = aggregate ? monthly.reduce((sum, k) => sum + k.grossProfit, 0) : null;
  const columns: Column<CategoryRow>[] = [
    { key: "category", header: "Categoria", cell: (r) => r.category },
    { key: "revenue", header: "Receitas", className: "text-right", cell: (r) => <span className={financialAmountClass(r.revenue)}>{formatBRL(r.revenue)}</span> },
    { key: "expense", header: "Despesas", className: "text-right", cell: (r) => <span className={financialAmountClass(r.expense)}>{formatBRL(r.expense)}</span> },
    { key: "result", header: "Movimento líquido", className: "text-right", cell: (r) => <span className={financialAmountClass(r.result, "result")}>{formatBRL(r.result)}</span> },
  ];

  function exportCategories() {
    const csvValue = (value: string | number) => typeof value === "number" ? value.toFixed(2)
      : `"${(/^[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    const content = [
      ["Categoria", "Receitas", "Despesas", "Movimento liquido"],
      ...rows.map((r) => [r.category, r.revenue, r.expense, r.result]),
    ].map((row) => row.map(csvValue).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `somus-${filters.company}-${filters.year || "todos"}-categorias.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Dashboard" description={`${filters.periodLabel} · ${filters.basis === "cash" ? "Caixa" : "Competência"}`} />
        <Button onClick={exportCategories} disabled={!rows.length}>
          <Download className="mr-2 h-4 w-4" />Exportar categorias
        </Button>
      </div>
      <CurrentCashBalance />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita Bruta" value={aggregate?.grossRevenue ?? null} variation={getVariation(filters, "grossRevenue")} icon={TrendingUp} />
        <KpiCard label="Lucro Bruto" value={grossProfit} variation={getVariation(filters, "grossProfit")} icon={BarChart3} />
        <KpiCard label="EBITDA" value={aggregate?.ebitda ?? null} variation={getVariation(filters, "ebitda")} icon={Activity} />
        <KpiCard label="Lucro Líquido" value={aggregate?.netProfit ?? null} variation={getVariation(filters, "netProfit")} icon={Wallet} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Margem Líquida" value={aggregate?.netMargin ?? null} formatValue={formatPercent} />
        <KpiCard label="Margem EBITDA" value={aggregate && aggregate.netRevenue > 0 ? aggregate.ebitda / aggregate.netRevenue : null} formatValue={formatPercent} />
      </div>
      <ChartCard title="Evolução da DRE">
        <MultiBarChart data={chart} xKey="period" series={[
          { key: "revenue", name: "Receitas da DRE", color: "var(--chart-1)", direction: "higher" },
          { key: "expense", name: "Deduções e despesas da DRE", color: "var(--chart-2)", direction: "lower" },
          { key: "result", name: "Lucro líquido", color: "var(--chart-3)", direction: "higher" },
        ]} />
      </ChartCard>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Lançamentos por categoria</h2><CategorySort value={order} onChange={setOrder} /></div>
        <DataTable columns={columns} rows={rows} emptyTitle="Sem lançamentos no período selecionado" />
      </section>
    </div>
  );
}
