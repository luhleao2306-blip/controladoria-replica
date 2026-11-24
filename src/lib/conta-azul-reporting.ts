import type { Transaction } from "@/data/mock";
import type { ContaAzulAllocation, ContaAzulPayment } from "./conta-azul-model";
import { CONTA_AZUL_OPERATION_DRE } from "./conta-azul-model";

const money = (value: number) => Math.round(value * 100) / 100;
const LABELS: Record<string, string> = {
  JUROS_RECEBIDOS: "Juros recebidos", JUROS_PAGOS: "Juros pagos", MULTAS_RECEBIDAS: "Multas recebidas", MULTAS_PAGAS: "Multas pagas",
  DESCONTOS_FINANCEIROS_OBTIDOS: "Descontos financeiros obtidos", DESCONTOS_FINANCEIROS_CONCEDIDOS: "Descontos financeiros concedidos",
  TARIFAS: "Tarifas", PERDAS: "Perdas", COMPOSICAO_DIVERGENTE: "Diferença na composição da baixa",
};

export function scaleReportingAllocations(rows: ContaAzulAllocation[], total: number) {
  const base = rows.reduce((sum, row) => sum + row.amount, 0);
  const weight = rows.reduce((sum, row) => sum + (row.weight || 0), 0);
  let assigned = 0;
  return rows.map((row, i) => {
    const amount = i === rows.length - 1 ? Math.round(total * 100) - assigned
      : Math.round(total * 100 * (base ? row.amount / base : weight ? (row.weight || 0) / weight : 0));
    assigned += amount;
    return { ...row, amount: amount / 100 };
  });
}

function component(t: Transaction, operation: string, signedAmount: number, date: string, suffix: string, account: string | null, cash: boolean, payment?: ContaAzulPayment): Transaction {
  const amount = Math.abs(money(signedAmount)), category = t.source!.operationCategories?.[operation];
  const label = category?.category ?? LABELS[operation] ?? operation;
  // A missing cached catalog must not turn a known settlement operation into an unclassified amount.
  const dreEntry = category?.dreEntry || CONTA_AZUL_OPERATION_DRE[operation] || null;
  const warnings = category || dreEntry ? t.source!.warnings : [...t.source!.warnings, `Categoria automática não configurada na origem: ${label}`];
  return { ...t, id: `${t.id}:${suffix}:${operation}`, date, competencyDate: date, paymentDate: cash ? date : undefined, dueDate: date,
    type: signedAmount >= 0 ? "revenue" : "expense", amount, category: label, costCenter: "Não alocado",
    status: cash ? "Pago" : "Pendente", description: `${t.description || t.party} · ${label}`,
    source: { ...t.source!, reportingComponent: operation, sourceStatus: cash ? "RECEBIDO" : t.source!.sourceStatus,
      paidAmount: cash ? amount : 0, outstandingAmount: 0, account, payments: payment ? [payment] : [], warnings,
      allocations: [{ ...(category ?? { category: label, categoryId: null, costCenter: null, costCenterId: null, weight: 0,
        dreEntry: null }), dreEntry, amount }] } };
}

function paymentComponents(t: Transaction, p: ContaAzulPayment) {
  const direction = t.type === "revenue" ? 1 : -1;
  const operations: [string, number][] = [
    [t.type === "revenue" ? "JUROS_RECEBIDOS" : "JUROS_PAGOS", p.interest || 0],
    [t.type === "revenue" ? "MULTAS_RECEBIDAS" : "MULTAS_PAGAS", p.fine || 0],
    [t.type === "revenue" ? "DESCONTOS_FINANCEIROS_CONCEDIDOS" : "DESCONTOS_FINANCEIROS_OBTIDOS", -(p.discount || 0)],
    ["TARIFAS", -(p.fee || 0)],
  ];
  const gross = Number.isFinite(p.gross) ? p.gross : money(p.amount - operations.reduce((sum, [, value]) => sum + value, 0));
  const difference = money(p.amount - gross - operations.reduce((sum, [, value]) => sum + value, 0));
  if (difference) operations.push(["COMPOSICAO_DIVERGENTE", difference]);
  return { gross, rows: operations.filter(([, value]) => money(value) !== 0).map(([operation, value]) =>
    component(t, operation, direction * value, p.date, `payment:${p.id}`, p.account, true, p)) };
}

export function projectContaAzulReporting(t: Transaction, basis: "cash" | "accrual", includeOpenCash: boolean): Transaction[] | null {
  const source = t.source;
  if (!source?.reporting || source.origin === "initial_balance" || source.reportingComponent) return null;
  if (!source.active) return [];
  const settled = source.payments.map(payment => ({ payment, ...paymentComponents(t, payment) }));
  if (basis === "cash") {
    const rows = settled.flatMap(({ payment: p, gross, rows }): Transaction[] => [
      ...(gross ? [{ ...t, id: `${t.id}:payment:${p.id}`, date: p.date, paymentDate: p.date, amount: gross, status: "Pago" as const,
        source: { ...source, paidAmount: gross, outstandingAmount: 0, account: p.account,
          allocations: scaleReportingAllocations(source.allocations, gross), payments: [p] } }] : []), ...rows,
    ]);
    if (includeOpenCash && source.outstandingAmount > 0 && !["PERDIDO", "CANCELADO", "RENEGOCIADO"].includes(source.sourceStatus)) {
      rows.push({ ...t, id: `${t.id}:outstanding`, date: t.dueDate || t.date, paymentDate: undefined, amount: source.outstandingAmount,
        status: t.status === "Atrasado" ? "Atrasado" : "Pendente", source: { ...source, paidAmount: 0, payments: [],
          allocations: scaleReportingAllocations(source.allocations, source.outstandingAmount) } });
    }
    return rows;
  }
  const loss = source.reporting.loss;
  const financialLoss = t.type === "revenue" && source.sourceStatus === "PERDIDO" && loss && source.reporting.sourceOrigin === "LANCAMENTO_FINANCEIRO";
  const gross = source.reporting.grossAmount ?? t.amount;
  // The provider retains sales revenue at competence, but direct financial losses move to the loss date.
  const principal = financialLoss ? money(Math.max(0, gross - loss.amount)) : gross;
  const primary = { ...t, amount: principal, source: { ...source, allocations: scaleReportingAllocations(source.allocations, principal) } };
  return [
    ...(["CANCELADO", "RENEGOCIADO"].includes(source.sourceStatus) ? [] : principal ? [primary] : []),
    ...settled.flatMap(({ rows }) => rows),
    ...(financialLoss ? [component(t, "PERDAS", -loss.amount, loss.date, "loss", source.account, false)] : []),
  ];
}
