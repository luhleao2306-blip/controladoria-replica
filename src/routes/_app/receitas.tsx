import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { searchTransactions } from "@/lib/ledger";
import { LedgerToolbar } from "@/components/common/LedgerToolbar";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChartCard, HorizontalBarsChart, DonutChart } from "@/components/common/FinancialChart";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge, type Tone } from "@/components/common/StatusBadge";
import { useFilters } from "@/context/FiltersContext";
import { getTransactions, groupByCategory, groupByCostCenter, topByAmount, txDate } from "@/lib/finance";
import { formatBRL, formatDate } from "@/lib/format";
import type { Transaction } from "@/data/mock";
import { TransactionDetails, transactionStatus } from "@/components/common/TransactionDetails";
import { financialAmountClass } from "@/lib/financial-semantics";
import { filterSelectionKey } from "@/lib/filter-options";

export const Route = createFileRoute("/_app/receitas")({
  head: () => ({
    meta: [
      { title: "Receitas — Modblue Controladoria" },
      { name: "description", content: "Análise de receita por cliente, categoria e centro de custo." },
    ],
  }),
  component: ReceitasPage,
});

const STATUS_TONE: Record<Transaction["status"], Tone> = {
  Pago: "positive", Pendente: "warning", Atrasado: "critical",
};

function ReceitasPage() {
  const filters = useFilters();
  const [query, setQuery] = useState("");
  const txs = searchTransactions(getTransactions(filters).filter((t) => t.type === "revenue"), query);
  const resetKey = JSON.stringify([filterSelectionKey(filters), query]);

  const counts = new Map<string, number>();
  txs.forEach((t) => counts.set(t.party, (counts.get(t.party) ?? 0) + 1));
  const recurring = topByAmount(txs.filter((t) => (counts.get(t.party) ?? 0) > 2), 5);
  const newClients = topByAmount(txs.filter((t) => (counts.get(t.party) ?? 0) <= 2), 5);
  const byCostCenter = groupByCostCenter(txs);
  const byService = groupByCategory(txs);

  const cols: Column<Transaction>[] = [
    { key: "description", header: "Descricao", cell: (t) => t.description || t.party },
    { key: "party", header: "Cliente", cell: (t) => t.party },
    { key: "cat", header: "Categoria", cell: (t) => t.category },
    { key: "cc", header: "Centro de custo", cell: (t) => t.costCenter },
    { key: "amt", header: "Valor", className: "whitespace-nowrap text-right", cell: (t) => <span className={`tabular-nums ${financialAmountClass(t.amount)}`}>{formatBRL(t.amount)}</span> },
    { key: "paid", header: "Recebido", className: "whitespace-nowrap text-right", cell: (t) => {
      const value = t.source?.paidAmount ?? (t.status === "Pago" ? t.amount : 0); return <span className={financialAmountClass(value)}>{formatBRL(value)}</span>;
    } },
    { key: "open", header: "Em aberto", className: "whitespace-nowrap text-right", cell: (t) => {
      const value = t.source?.outstandingAmount ?? (t.status === "Pago" ? 0 : t.amount); return <span className={financialAmountClass(value)}>{formatBRL(value)}</span>;
    } },
    { key: "date", header: filters.basis === "cash" ? "Pagamento" : "Competência", className: "whitespace-nowrap", cell: (t) => formatDate(txDate(t, filters.basis)) },
    { key: "status", header: "Status", cell: (t) => <StatusBadge tone={STATUS_TONE[t.status]}>{transactionStatus(t)}</StatusBadge> },
    { key: "details", header: "Detalhes", cell: (t) => <TransactionDetails transaction={t} /> },
  ];

  return (
    <div className="space-y-6">
        <PageHeader title="Receitas" description="Análise de receita por cliente, categoria e centro de custo." />
        <LedgerToolbar rows={txs} query={query} onQueryChange={setQuery} type="revenue" scope={`${filters.company}-${filters.year || "todos"}`} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Clientes com 3+ lançamentos"><HorizontalBarsChart data={recurring} direction="higher" /></ChartCard>
          <ChartCard title="Clientes com até 2 lançamentos"><HorizontalBarsChart data={newClients} direction="higher" /></ChartCard>
          <ChartCard title="Receita por centro de custo"><HorizontalBarsChart data={byCostCenter} direction="higher" /></ChartCard>
          <ChartCard title="Receita por tipo de serviço"><DonutChart data={byService} direction="higher" /></ChartCard>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Detalhamento de Receitas</h2>
          <DataTable columns={cols} rows={txs} rowKey={(row) => row.id} resetKey={resetKey} emptyTitle={query ? "Nenhum lançamento encontrado" : "Sem receitas no período"} />
        </section>
    </div>
  );
}
