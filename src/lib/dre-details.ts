import type { AccountingBasis, MonthlyKpi, Transaction } from "@/data/mock";
import { approvedDreCategory, classifyTransaction } from "./dre-classify";
import { resolveDreAllocation } from "./finance";
import { txDate } from "./filter-options";
import { DRE_COMPONENTS as COMPONENTS } from "./dre-rows";

const POSITIVE = new Set(["grossRevenue", "financialIncome", "otherIncome", "loanReceipts", "capitalReceipts"]);
export type DreEntry = { transaction: Transaction; date: string; month: string; amount: number };
export type DreGroup = { key: string; category: string; bucket: string; values: number[]; total: number; entries: DreEntry[] };
export type CategoryOrder = "amount-desc" | "amount-asc" | "code-asc" | "code-desc";
const categoryCollator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
export function compareCategories(a: { category: string; total: number }, b: { category: string; total: number }, order: CategoryOrder) {
  const name = categoryCollator.compare(a.category, b.category) || a.category.localeCompare(b.category, "pt-BR");
  if (order === "code-asc") return name;
  if (order === "code-desc") return -name;
  return (order === "amount-asc" ? 1 : -1) * (Math.abs(a.total) - Math.abs(b.total)) || name;
}

export function buildDreDetails(transactions: Transaction[], data: MonthlyKpi[], basis: AccountingBasis, order: CategoryOrder = "amount-desc") {
  const months = data.map((k) => `${k.year}-${String(k.monthIndex + 1).padStart(2, "0")}`);
  const groups = new Map<string, { category: string; bucket: string; entries: Map<string, DreEntry> }>();
  for (const transaction of transactions) {
    const date = txDate(transaction, basis);
    const month = date.slice(0, 7);
    if (!months.includes(month)) continue;
    const allocations = transaction.source ? transaction.source.allocations.map((a) => ({
      ...a, bucket: resolveDreAllocation(transaction.type, a, transaction.company) ?? "unclassified",
    })) : [{ category: transaction.category, amount: transaction.amount,
      bucket: approvedDreCategory(transaction.type, transaction.category, transaction.company) ?? classifyTransaction(transaction.type, transaction.category) }];
    for (const allocation of allocations) {
      if (!allocation.bucket) continue;
      const category = allocation.category || "Nao informado na origem";
      const key = JSON.stringify([allocation.bucket, category, allocation.bucket === "unclassified" ? transaction.type : null]);
      const group = groups.get(key) ?? { category, bucket: allocation.bucket, entries: new Map<string, DreEntry>() };
      groups.set(key, group);
      const entryKey = JSON.stringify([transaction.company, transaction.id, month]);
      const entry = group.entries.get(entryKey) ?? { transaction, date, month, amount: 0 };
      // Cost-center splits of one transaction must not create duplicate entries.
      const positive = group.bucket === "unclassified" ? transaction.type === "revenue" : POSITIVE.has(group.bucket);
      entry.amount = (Math.round(entry.amount * 100) + (positive ? 1 : -1) * Math.round(allocation.amount * 100)) / 100;
      group.entries.set(entryKey, entry);
    }
  }
  const result: DreGroup[] = [...groups].map(([key, group]) => {
    const entries = [...group.entries.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.date.localeCompare(b.date));
    const values = months.map((month) => entries.filter((e) => e.month === month).reduce((sum, e) => sum + Math.round(e.amount * 100), 0) / 100);
    return { key, category: group.category, bucket: group.bucket, entries, values, total: values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100 };
  });
  return (line: string) => result.filter((g) => (COMPONENTS[line] ?? [line]).includes(g.bucket))
    .sort((a, b) => compareCategories(a, b, order));
}
