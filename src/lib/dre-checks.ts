import type { AccountingBasis, MonthlyKpi, Transaction } from "@/data/mock";
import { approvedDreCategory, classifyTransaction } from "./dre-classify";
import type { DreGroup } from "./dre-details";
import { resolveDreAllocation, SOURCE_DRE_LINES } from "./finance";
import { txDate } from "./filter-options";

export type DreIssue = {
  key: string; title: string; message: string; category: string; company: string;
  lines: string[]; excluded: boolean; transactions: Transaction[];
};

const rowFor = (line: string) => ["loanReceipts", "debts"].includes(line) ? "loanMovement"
  : ["capitalReceipts", "capitalWithdrawals"].includes(line) ? "shareholderMovement" : line;
const positive = new Set(["grossRevenue", "financialIncome", "otherIncome", "loanReceipts", "capitalReceipts",
  "netRevenue", "grossProfit", "ebitda", "netProfit", "loanMovement", "shareholderMovement", "unclassified", "result"]);
const missing = (name?: string) => !name?.trim() || /^(nao informado na origem|descricao nao informada.*|sem categoria)$/i
  .test(name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

export function inspectDre(transactions: Transaction[], data: MonthlyKpi[], basis: AccountingBasis, groupsFor: (line: string) => DreGroup[]) {
  const issues = new Map<string, DreIssue>();
  const ids = new Set<string>();
  const add = (code: string, title: string, message: string, category: string, lines: string[], t?: Transaction, excluded = false) => {
    const key = JSON.stringify([code, category, t?.company ?? "", lines, message]);
    const issue = issues.get(key) ?? { key, title, message, category, company: t?.company ?? "", lines, excluded, transactions: [] };
    if (t && !issue.transactions.some(row => row.company === t.company && row.id === t.id)) issue.transactions.push(t);
    issues.set(key, issue);
  };
  for (const t of transactions) {
    const allocations = t.source?.allocations ?? [{ category: t.category, amount: t.amount,
      dreEntry: undefined }];
    const lines = [...new Set(allocations.map(a => t.source ? resolveDreAllocation(t.type, a, t.company)
      : approvedDreCategory(t.type, a.category, t.company) ?? classifyTransaction(t.type, a.category)).map(line => rowFor(line ?? "unclassified")))];
    const affected = [...new Set([...lines, "result"])];
    const id = JSON.stringify([t.company, t.id]);
    if (ids.has(id)) add("duplicate", "Possível duplicidade", "O mesmo identificador aparece mais de uma vez neste recorte.", t.category, affected, t);
    ids.add(id);
    if (!Number.isFinite(t.amount) || allocations.some(a => !Number.isFinite(a.amount))) {
      add("invalid-amount", "Valor inválido", "Há um valor financeiro inválido; confira o lançamento na origem.", t.category, affected, t);
    } else if (Math.round(allocations.reduce((sum, a) => sum + a.amount, 0) * 100) !== Math.round(t.amount * 100)) {
      add("allocation", "Diferença no rateio", "A soma das categorias não corresponde ao valor deste lançamento.", t.category, affected, t);
    }
    for (const a of allocations) {
      if (t.source && !resolveDreAllocation(t.type, a, t.company)) add("unclassified", "Categoria sem grupo de DRE",
        a.dreEntry ? `Grupo não reconhecido: ${a.dreEntry}. Confira a categoria na origem.` : "A origem não informou um grupo de DRE. Esta parcela não entra no Resultado até a classificação ser conferida.",
        a.category || "Categoria não informada", ["unclassified", "result"], t, true);
      if (missing(a.category)) add("category", "Categoria não informada", "O lançamento está sem nome de categoria na origem.", "Categoria não informada", affected, t);
    }
    if (t.source && !t.source.detailComplete) add("details", "Detalhes incompletos", "O detalhamento da origem ainda não foi confirmado.", t.category, affected, t);
    for (const warning of t.source?.warnings ?? []) add(`source:${warning}`, "Atenção na origem", warning, t.category, affected, t);
  }
  const lines = [...new Set([...Object.values(SOURCE_DRE_LINES), "loanReceipts", "capitalReceipts", "capitalWithdrawals",
    "netRevenue", "grossProfit", "ebitda", "netProfit", "loanMovement", "shareholderMovement", "unclassified", "result"])];
  for (const line of lines) {
    const groups = groupsFor(line);
    for (const month of data) {
      const period = `${month.year}-${String(month.monthIndex + 1).padStart(2, "0")}`;
      const detail = groups.reduce((sum, group) => sum + group.entries.filter(e => e.month === period)
        .reduce((value, e) => value + Math.round(e.amount * 100), 0), 0);
      const expected = (positive.has(line) ? 1 : -1) * Math.round(Number(month[line as keyof MonthlyKpi] ?? 0) * 100);
      if (detail !== expected) add(`closure:${period}`, "Total diferente do detalhamento",
        `O total de ${period} não fecha com os lançamentos. É necessário conferir antes de usar o resultado.`, "Conferência de totais", [rowFor(line), "result"]);
    }
  }
  // Invalid dates must not disappear from a supplied recorte without a warning.
  for (const t of transactions) if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate(t, basis))) add("date", "Data inválida",
    "A data do lançamento precisa ser conferida na origem.", t.category, ["result"], t);
  return [...issues.values()];
}
