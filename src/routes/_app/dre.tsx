import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { DreTable } from "@/components/common/DreTable";
import { EmptyState } from "@/components/common/EmptyState";
import { useFilters } from "@/context/FiltersContext";
import { getMonthlyKpis, getTransactions } from "@/lib/finance";

export const Route = createFileRoute("/_app/dre")({
  head: () => ({
    meta: [
      { title: "DRE — Modblue Controladoria" },
      { name: "description", content: "Demonstração de Resultados do Exercício mensal." },
    ],
  }),
  component: DrePage,
});

function DrePage() {
  const filters = useFilters();
  const data = getMonthlyKpis(filters);
  const transactions = getTransactions(filters);
  return (
    <>
      <PageHeader title="DRE" description={`${filters.companyLabel} • ${filters.periodLabel} • ${filters.basis === "cash" ? "Caixa: pagamentos e abertos por vencimento" : "Competência"} • ${filters.payment === "paid" ? "Pago / Liquidado" : filters.payment === "open" ? "Em aberto" : "Todas as situações"}`} />
      {data.length === 0 ? <EmptyState /> : <DreTable data={data} transactions={transactions} basis={filters.basis} />}
    </>
  );
}
