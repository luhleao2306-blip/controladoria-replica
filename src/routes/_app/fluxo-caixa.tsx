import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { ChartCard, MultiBarChart } from "@/components/common/FinancialChart";
import { EmptyState } from "@/components/common/EmptyState";
import { useFilters } from "@/context/FiltersContext";
import { getMonthlyKpis } from "@/lib/finance";
import { CurrentCashBalance, useCurrentCash } from "@/components/common/CurrentCashBalance";
import { DataTable, type Column } from "@/components/common/DataTable";
import { MONTHS_PT, formatBRL } from "@/lib/format";
import { ArrowDownCircle, ArrowUpCircle, Wallet, TrendingUp, Calendar } from "lucide-react";
import { financialAmountClass, financialOutcome } from "@/lib/financial-semantics";

export const Route = createFileRoute("/_app/fluxo-caixa")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa — Modblue Controladoria" },
      { name: "description", content: "Visão mensal de entradas, saídas e saldo acumulado." },
    ],
  }),
  component: FluxoCaixaPage,
});

function FluxoCaixaPage() {
  const filters = useFilters();
  const cash = useCurrentCash();
  const accounts = cash.accounts.map(account => ({ ...account,
    nome: `${filters.companyOptions.find(c => c.id === account.company)?.name ?? account.company} · ${account.nome}` }));
  const all = getMonthlyKpis({ ...filters, basis: "cash" });
  const period = all;

  if (all.length === 0 && accounts.length === 0) {
    return (
      <>
        <PageHeader title="Fluxo de Caixa" />
        <CurrentCashBalance />
        <EmptyState />
      </>
    );
  }

  const data = all.map((k) => ({
    month: `${MONTHS_PT[k.monthIndex]}/${k.year}`,
    Entradas: k.cashIn,
    Saídas: k.cashOut,
    "Saldo acumulado": k.cashBalance,
  }));

  const first = period[0];
  const initialBalance = first ? first.cashBalance - (first.cashIn - first.cashOut) : 0;
  const totalIn = period.reduce((a, b) => a + b.cashIn, 0);
  const totalOut = period.reduce((a, b) => a + b.cashOut, 0);
  const finalBalance = period[period.length - 1]?.cashBalance ?? 0;
  const projected30 = finalBalance + (totalIn - totalOut) / Math.max(1, period.length);
  const accountColumns: Column<(typeof accounts)[number]>[] = [
    { key: "name", header: "Conta financeira", cell: (account) => account.nome },
    { key: "balance", header: cash.accounts.some(account => account.company === "manual-test") ? "Saldo atual das contas" : "Saldo atual na Conta Azul", className: "text-right", cell: (account) =>
      !Number.isFinite(account.currentBalance?.saldo_atual) ? "Nao retornado pela API" : <span className={financialAmountClass(account.currentBalance!.saldo_atual, "result")}>{formatBRL(account.currentBalance!.saldo_atual!)}</span> },
  ];

  return (
    <>
      <PageHeader title="Fluxo de Caixa" description="Entradas e saídas por data efetiva de pagamento." />
      <CurrentCashBalance />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Entradas" value={totalIn} icon={ArrowDownCircle} tone="positive" />
        <KpiCard label="Saídas" value={totalOut} icon={ArrowUpCircle} tone="critical" direction="lower" />
        <KpiCard label="Movimento liquido do periodo" value={finalBalance} icon={TrendingUp} tone={financialOutcome(finalBalance)} />
      </div>

      <div className="mt-6">
        {accounts.length > 0 && <section className="mb-6">
          <h2 className="mb-3 font-semibold">Contas financeiras ativas · saldo atual</h2>
          <DataTable columns={accountColumns} rows={accounts} />
        </section>}
        <ChartCard title="Fluxo mensal" subtitle="Entradas, Saídas e Saldo acumulado">
          <MultiBarChart
            data={data}
            xKey="month"
            series={[
              { key: "Entradas", name: "Entradas", color: "var(--chart-1)", direction: "higher" },
              { key: "Saídas", name: "Saídas", color: "var(--chart-2)", direction: "lower" },
              { key: "Saldo acumulado", name: "Saldo acumulado", color: "var(--chart-3)", direction: "higher" },
            ]}
          />
        </ChartCard>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border/60 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-xs tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 sticky left-0 bg-secondary/60">Linha</th>
              {all.map((k) => (<th key={`${k.year}-${k.monthIndex}`} className="text-right px-3 py-3">{MONTHS_PT[k.monthIndex]}/{k.year}</th>))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border/60">
              <td className="px-4 py-2 sticky left-0 bg-card">Entradas</td>
              {all.map((k) => (<td key={`${k.year}-${k.monthIndex}`} className={`px-3 py-2 text-right tabular-nums ${financialAmountClass(k.cashIn)}`}>{formatBRL(k.cashIn)}</td>))}
            </tr>
            <tr className="border-t border-border/60">
              <td className="px-4 py-2 sticky left-0 bg-card">Saídas</td>
              {all.map((k) => (<td key={`${k.year}-${k.monthIndex}`} className={`px-3 py-2 text-right tabular-nums ${financialAmountClass(-k.cashOut)}`}>{formatBRL(-k.cashOut)}</td>))}
            </tr>
            <tr className="border-t border-border/60 bg-primary/5 font-medium">
              <td className="px-4 py-2 sticky left-0 bg-primary/5">Saldo do mês</td>
              {all.map((k) => (<td key={`${k.year}-${k.monthIndex}`} className={`px-3 py-2 text-right tabular-nums ${financialAmountClass(k.cashIn - k.cashOut, "result")}`}>{formatBRL(k.cashIn - k.cashOut)}</td>))}
            </tr>
            <tr className="border-t border-border/60 bg-primary/10 font-semibold">
              <td className="px-4 py-2 sticky left-0 bg-primary/10">Saldo acumulado</td>
              {all.map((k) => (<td key={`${k.year}-${k.monthIndex}`} className={`px-3 py-2 text-right tabular-nums ${financialAmountClass(k.cashBalance, "result")}`}>{formatBRL(k.cashBalance)}</td>))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
