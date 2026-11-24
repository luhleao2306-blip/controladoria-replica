import { z } from "zod";
import type { AlertEvent, Transaction } from "@/data/mock";

const money = z.number().finite().min(0).max(1e12).nullable();
export const operationalSettingsSchema = z.object({
  revenueTarget: money, expenseBudget: money, minMargin: z.number().finite().min(0).max(100).nullable(),
  rules: z.object({ revenue: z.boolean(), expense: z.boolean(), margin: z.boolean(), overdue: z.boolean() }),
});
export type OperationalSettings = z.infer<typeof operationalSettingsSchema>;
export const EMPTY_SETTINGS: OperationalSettings = {
  revenueTarget: null, expenseBudget: null, minMargin: null,
  rules: { revenue: true, expense: true, margin: true, overdue: true },
};

export function buildFinancialAlerts(txs: Transaction[], agg: { netRevenue: number; operationalExpenses: number; netMargin: number; netProfit: number } | null, settings: OperationalSettings,
  scope: string, today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())): AlertEvent[] {
  if (!txs.length) return [];
  const alerts: AlertEvent[] = [];
  const add = (kind: string, title: string, description: string, impact: number, recommendation: string, fingerprint: string) => {
    // The fingerprint reopens a reviewed alert when its underlying values change.
    let hash = 2166136261;
    for (const char of fingerprint) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    alerts.push({ id: `${scope}:${kind}:${hash >>> 0}`, title, description,
      severity: kind === "overdue-expense" ? "high" : "medium", financialImpact: impact,
      recommendation, createdAt: today, status: "open" });
  };
  if (settings.rules.overdue) for (const type of ["revenue", "expense"] as const) {
    const overdue = txs.filter(t => t.type === type && (t.dueDate ?? t.date) < today &&
      !/PERDIDO|LOST|CANCEL/i.test(t.source?.sourceStatus ?? "") &&
      (t.source?.outstandingAmount ?? (t.status === "Pago" ? 0 : t.amount)) > 0);
    const total = overdue.reduce((sum, t) => sum + Math.round((t.source?.outstandingAmount ?? t.amount) * 100), 0) / 100;
    if (overdue.length) add(`overdue-${type}`, type === "revenue" ? "Recebimentos vencidos" : "Pagamentos vencidos",
      `${overdue.length} lancamentos vencidos com saldo em aberto no recorte selecionado.`, type === "revenue" ? total : -total,
      "Conferir vencimentos e saldos em aberto na origem.", overdue.map(t => `${t.id}:${t.source?.outstandingAmount ?? t.amount}`).sort().join("|"));
  }
  // Monthly goals cannot be compared to arbitrary multi-month or category cuts.
  if (agg) {
    if (settings.rules.revenue && settings.revenueTarget !== null && agg.netRevenue < settings.revenueTarget)
      add("revenue-target", "Receita abaixo da meta", "Receita liquida inferior a meta mensal cadastrada.", agg.netRevenue - settings.revenueTarget,
        "Revisar a receita do mes.", `${agg.netRevenue}:${settings.revenueTarget}`);
    if (settings.rules.expense && settings.expenseBudget !== null && agg.operationalExpenses > settings.expenseBudget)
      add("expense-budget", "Despesa acima do orcamento", "Despesas operacionais superiores ao orcamento mensal cadastrado.", settings.expenseBudget - agg.operationalExpenses,
        "Revisar despesas operacionais do mes.", `${agg.operationalExpenses}:${settings.expenseBudget}`);
    if (settings.rules.margin && settings.minMargin !== null && agg.netMargin * 100 < settings.minMargin)
      add("margin", "Margem abaixo do minimo", "Margem liquida inferior ao percentual cadastrado.", agg.netProfit,
        "Conferir a DRE do mes.", `${agg.netProfit}:${agg.netRevenue}:${settings.minMargin}`);
  }
  return alerts;
}
