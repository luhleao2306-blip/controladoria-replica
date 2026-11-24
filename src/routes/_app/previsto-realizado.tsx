import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DataTable, type Column } from "@/components/common/DataTable";
import { StatusBadge, type Tone } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { useFilters } from "@/context/FiltersContext";
import { getTransactions } from "@/lib/finance";
import { formatBRL, formatPercent } from "@/lib/format";
import { financialClass } from "@/lib/financial-semantics";

export const Route = createFileRoute("/_app/previsto-realizado")({
  head: () => ({
    meta: [
      { title: "Previsto x Realizado — Modblue Controladoria" },
      { name: "description", content: "Compare o previsto (a receber/a pagar) com o realizado (liquidado)." },
    ],
  }),
  component: PrevistoRealizadoPage,
});

type Row = {
  category: string;
  isRevenue: boolean;
  planned: number;   // previsto = tudo (realizado + pendente)
  realized: number;  // realizado = liquidado (Pago)
  diff: number;
  diffPct: number;
};

function statusOf(r: Row): { tone: Tone; label: string } {
  const good = r.isRevenue ? r.diffPct >= -0.03 : r.diffPct <= 0.03;
  const bad = r.isRevenue ? r.diffPct < -0.1 : r.diffPct > 0.1;
  if (bad) return { tone: "critical", label: "Crítico" };
  if (!good) return { tone: "warning", label: "Atenção" };
  return { tone: "positive", label: "Dentro do planejado" };
}

function PrevistoRealizadoPage() {
  const filters = useFilters();
  const txs = useMemo(() => getTransactions(filters), [filters]);

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    for (const t of txs) {
      const isRevenue = t.type === "revenue";
      const allocations = t.source?.allocations ?? [{ category: t.category, amount: t.amount }];
      const paid = t.source?.paidAmount ?? (t.status === "Pago" ? t.amount : 0);
      let assignedCents = 0;
      for (const [index, allocation] of allocations.entries()) {
        const key = `${isRevenue ? "R" : "D"}::${allocation.category}`;
        let r = map.get(key);
        if (!r) {
          r = { category: `${isRevenue ? "Receita" : "Despesa"} — ${allocation.category}`, isRevenue, planned: 0, realized: 0, diff: 0, diffPct: 0 };
          map.set(key, r);
        }
        const cents = index === allocations.length - 1 ? Math.round(paid * 100) - assignedCents
          : Math.round(paid * 100 * (t.amount ? allocation.amount / t.amount : 0));
        assignedCents += cents;
        r.planned += allocation.amount;
        r.realized += cents / 100;
      }
    }
    const arr = [...map.values()];
    for (const r of arr) {
      r.diff = r.realized - r.planned;
      r.diffPct = r.diff / Math.max(1, r.planned);
    }
    return arr.sort((a, b) => b.planned - a.planned);
  }, [txs]);

  const revenuePlanned = rows.filter((r) => r.isRevenue).reduce((a, b) => a + b.planned, 0);
  const revenueRealized = rows.filter((r) => r.isRevenue).reduce((a, b) => a + b.realized, 0);
  const expensePlanned = rows.filter((r) => !r.isRevenue).reduce((a, b) => a + b.planned, 0);
  const expenseRealized = rows.filter((r) => !r.isRevenue).reduce((a, b) => a + b.realized, 0);

  const revPct = revenuePlanned > 0 ? Math.min(150, (revenueRealized / revenuePlanned) * 100) : 0;
  const expPct = expensePlanned > 0 ? Math.min(150, (expenseRealized / expensePlanned) * 100) : 0;

  const cols: Column<Row>[] = [
    { key: "cat", header: "Categoria", cell: (r) => r.category },
    { key: "plan", header: "Previsto", className: "text-right", cell: (r) => <span className="tabular-nums">{formatBRL(r.planned)}</span> },
    { key: "real", header: "Realizado", className: "text-right", cell: (r) => <span className="tabular-nums">{formatBRL(r.realized)}</span> },
    { key: "diff", header: "Diferença R$", className: "text-right", cell: (r) =>
      <span className={"tabular-nums " + financialClass(r.diff, r.isRevenue ? "higher" : "lower")}>{formatBRL(r.diff)}</span> },
    { key: "diffp", header: "Diferença %", className: "text-right", cell: (r) =>
      <span className={"tabular-nums " + financialClass(r.diffPct, r.isRevenue ? "higher" : "lower")}>{formatPercent(r.diffPct)}</span> },
    { key: "status", header: "Status", cell: (r) => {
      const s = statusOf(r); return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
    }},
  ];

  return (
    <>
      <PageHeader title="Previsto x Realizado" description="Previsto = total do período (liquidado + pendente). Realizado = liquidado." />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-5 rounded-2xl shadow-sm border-border/60">
          <p className="text-xs tracking-wide text-muted-foreground">Receita realizada x prevista</p>
          <p className="mt-2 text-2xl font-semibold">{formatBRL(revenueRealized)} <span className="text-sm font-normal text-muted-foreground">/ {formatBRL(revenuePlanned)}</span></p>
          <Progress value={revPct} className="mt-3 h-3" />
          <p className="mt-2 text-xs text-muted-foreground">{revPct.toFixed(1)}% do previsto</p>
        </Card>
        <Card className="p-5 rounded-2xl shadow-sm border-border/60">
          <p className="text-xs tracking-wide text-muted-foreground">Despesas realizadas x previstas</p>
          <p className="mt-2 text-2xl font-semibold">{formatBRL(expenseRealized)} <span className="text-sm font-normal text-muted-foreground">/ {formatBRL(expensePlanned)}</span></p>
          <Progress value={expPct} className="mt-3 h-3" />
          <p className="mt-2 text-xs text-muted-foreground">{expPct.toFixed(1)}% do previsto</p>
        </Card>
      </div>
      {rows.length === 0 ? <EmptyState title="Sem dados no período" description="Ajuste os filtros ou aguarde sincronização." /> : <DataTable columns={cols} rows={rows} />}
    </>
  );
}
