import { KPI_BY_YEAR, TRANSACTIONS_BY_YEAR, type MonthlyKpi, type Transaction } from "@/data/mock";
import { monthsForFilters, type FiltersState } from "@/context/FiltersContext";
import { monthOverlapsRange, parseLocalDate } from "@/lib/date";
import { approvedDreCategory, classifyTransaction, isPrincipalLoanCategory } from "@/lib/dre-classify";
import { matchesTransaction, transactionsForBasis, projectTransaction, txDate, filterSelectionKey, selectedDateRanges, selectedYears, selectedMonths } from "./filter-options";
export { txDate } from "./filter-options";

let sourceArrays: Transaction[][] = [];
let allTransactions: Transaction[] = [];
let cashTransactions: Transaction[] | null = null;
let cashWithOpenTransactions: Transaction[] | null = null;
let accrualTransactions: Transaction[] | null = null;
const transactionCache = new Map<string, Transaction[]>();
const monthlyCache = new Map<string, MonthlyKpi[]>();

export const SOURCE_DRE_LINES: Record<string, keyof MonthlyKpi> = {
  RECEITA_VENDA_PRODUTOS_SERVICOS: "grossRevenue", RECEITA_FRETES_ENTREGAS: "grossRevenue",
  RECEITAS_RENDIMENTOS_FINANCEIROS: "financialIncome", IMPOSTOS_SOBRE_VENDAS: "taxes",
  COMISSOES_SOBRE_VENDAS: "commissions", DESCONTOS_INCONDICIONAIS: "discounts",
  CUSTO_SERVICOS_PRESTADOS: "operationalCosts", DESPESAS_ADMINISTRATIVAS: "adminExpenses",
  DESPESAS_COMERCIAIS: "commercialExpenses", DESPESAS_OPERACIONAIS_NIVEL_2: "operationalExpenses",
  DESPESSAS_FINANCEIRAS: "financialExpense", DESPESAS_FINANCEIRAS: "financialExpense",
  OUTRAS_RECEITAS_NAO_OPERACIONAIS: "otherIncome", OUTRAS_DESPESAS_NAO_OPERACIONAIS: "otherExpense",
  INVESTIMENTOS_IMOBILIZADO: "investments", EMPRESTIMOS_DIVIDAS: "debts",
};

export function resolveDreAllocation(type: Transaction["type"], allocation: { category: string; dreEntry?: string | null }, company?: Transaction["company"]): keyof MonthlyKpi | undefined {
  if (company === "manual-test" && allocation.dreEntry) {
    if (allocation.dreEntry === "MANUAL_CAPITAL_RECEIPTS") return "capitalReceipts";
    if (allocation.dreEntry === "MANUAL_CAPITAL_WITHDRAWALS") return "capitalWithdrawals";
    if (allocation.dreEntry === "EMPRESTIMOS_DIVIDAS") return type === "revenue" ? "loanReceipts" : "debts";
    return SOURCE_DRE_LINES[allocation.dreEntry];
  }
  const approved = approvedDreCategory(type, allocation.category, company);
  // Withdrawals move below profit once, into the owner-requested capital group.
  if (approved === "capitalWithdrawals" || approved === "capitalReceipts") return approved;
  // Principal financing affects the management result, never operating profit.
  if (allocation.dreEntry === "EMPRESTIMOS_DIVIDAS" || isPrincipalLoanCategory(allocation.category)) {
    return type === "revenue" ? "loanReceipts" : "debts";
  }
  return allocation.dreEntry ? SOURCE_DRE_LINES[allocation.dreEntry] : approved;
}

function filterKey(f: FiltersState) {
  const current = Object.values(TRANSACTIONS_BY_YEAR);
  // Loads replace year arrays atomically; a new load invalidates every filter.
  if (current.length !== sourceArrays.length || current.some((rows, i) => rows !== sourceArrays[i])) {
    sourceArrays = current;
    allTransactions = current.flat();
    cashTransactions = null;
    cashWithOpenTransactions = null;
    accrualTransactions = null;
    transactionCache.clear();
    monthlyCache.clear();
  }
  return filterSelectionKey(f);
}

function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

export function getMonthlyKpis(f: FiltersState): MonthlyKpi[] {
  const cacheKey = filterKey(f);
  const cached = monthlyCache.get(cacheKey);
  if (cached) return cached;
  const hasCustomRange = Boolean(f.customStart || f.customEnd);

  // Sempre derivamos dos lançamentos para que empresa, categoria, centro de custo
  // e a base de cálculo (Caixa x Competência) reflitam em todos os painéis.
  const deriveFromTx = true;

  if (deriveFromTx) {
    const txs = getTransactions(f);

    const buckets = new Map<string, MonthlyKpi>();
    const key = (y: number, m: number) => `${y}-${m}`;
    const companies = f.companies ?? (f.company === "all" ? [] : [f.company]);
    if (!txs.length && companies.length === 1 && companies[0] === "manual-test") {
      const ranges = selectedDateRanges(f), currentYear = new Date().getFullYear();
      const starts = ranges.map(range => Number(range.start?.slice(0, 4))).filter(Boolean);
      const ends = ranges.map(range => Number(range.end?.slice(0, 4))).filter(Boolean);
      const first = starts.length ? Math.min(...starts) : currentYear, last = ends.length ? Math.max(...ends) : currentYear;
      const years = ranges.length ? Array.from({ length: Math.min(301, Math.max(0, last - first + 1)) }, (_, i) => first + i)
        : selectedYears(f).length ? selectedYears(f) : [currentYear];
      for (const year of years) for (const month of monthsForFilters(f)) {
        if (ranges.length && !ranges.some(range => monthOverlapsRange(year, month, range.start, range.end))) continue;
        buckets.set(key(year, month), { year, monthIndex: month, monthLabel: "", grossRevenue: 0, taxes: 0, commissions: 0,
          netRevenue: 0, operationalCosts: 0, commercialExpenses: 0, adminExpenses: 0, operationalExpenses: 0, financialIncome: 0,
          financialExpense: 0, grossProfit: 0, ebitda: 0, netProfit: 0, netMargin: 0, cashIn: 0, cashOut: 0, cashBalance: 0,
          accountsReceivable: 0, accountsPayable: 0 });
      }
    }
    for (const t of txs) {
      const dateStr = txDate(t, f.basis);
      const d = parseLocalDate(dateStr);
      if (!d) continue;
      const y = d.getFullYear();
      const m = d.getMonth();
      const k = key(y, m);
      let bucket = buckets.get(k);
      if (!bucket) {
        bucket = {
          year: y, monthIndex: m, monthLabel: "",
          grossRevenue: 0, taxes: 0, commissions: 0, netRevenue: 0,
          operationalCosts: 0, commercialExpenses: 0, adminExpenses: 0, operationalExpenses: 0,
          financialIncome: 0, financialExpense: 0, grossProfit: 0, ebitda: 0,
          netProfit: 0, netMargin: 0, cashIn: 0, cashOut: 0, cashBalance: 0,
          accountsReceivable: 0, accountsPayable: 0,
        };
        buckets.set(k, bucket);
      }
      if (t.source) {
        for (const allocation of t.source.allocations) {
          const line = resolveDreAllocation(t.type, allocation, t.company);
          if (line) (bucket as any)[line] = Number(bucket[line] ?? 0) + allocation.amount;
          else bucket.unclassified = (bucket.unclassified ?? 0) + (t.type === "revenue" ? 1 : -1) * allocation.amount;
        }
        if (t.type === "revenue") {
          bucket.cashIn += t.source.paidAmount;
          bucket.accountsReceivable += t.source.outstandingAmount;
        } else {
          bucket.cashOut += t.source.paidAmount;
          bucket.accountsPayable += t.source.outstandingAmount;
        }
        continue;
      }
      const category = t.category || "Sem categoria";
      const line = approvedDreCategory(t.type, category, t.company) ?? classifyTransaction(t.type, category);
      if (t.type === "revenue") {
        if (line === "loanReceipts") bucket.loanReceipts = (bucket.loanReceipts ?? 0) + t.amount;
        else if (line === "capitalReceipts") bucket.capitalReceipts = (bucket.capitalReceipts ?? 0) + t.amount;
        else if (line === "financialIncome") bucket.financialIncome += t.amount;
        else if (line === "taxes") bucket.taxes += t.amount;
        else if (line === "commissions") bucket.commissions += t.amount;
        else bucket.grossRevenue += t.amount;

        if (t.status === "Pago") bucket.cashIn += t.amount;
        else bucket.accountsReceivable += t.amount;
      } else {
        if (line === "debts") bucket.debts = (bucket.debts ?? 0) + t.amount;
        else if (line === "capitalWithdrawals") bucket.capitalWithdrawals = (bucket.capitalWithdrawals ?? 0) + t.amount;
        else if (line === "investments") bucket.investments = (bucket.investments ?? 0) + t.amount;
        else if (line === "taxes") bucket.taxes += t.amount;
        else if (line === "commissions") bucket.commissions += t.amount;
        else if (line === "operationalCosts") bucket.operationalCosts += t.amount;
        else if (line === "commercialExpenses") bucket.commercialExpenses += t.amount;
        else if (line === "adminExpenses") bucket.adminExpenses += t.amount;
        else if (line === "financialExpense") bucket.financialExpense += t.amount;
        else bucket.operationalExpenses += t.amount;
        if (t.status === "Pago") bucket.cashOut += t.amount;
        else bucket.accountsPayable += t.amount;
      }


    }
    const arr = [...buckets.values()].sort((a, b) => a.year - b.year || a.monthIndex - b.monthIndex);
    let balance = 0;
    for (const m of arr) {
      m.netRevenue = m.grossRevenue - m.taxes - m.commissions - (m.discounts ?? 0);
      m.grossProfit = m.netRevenue - m.operationalCosts;
      m.ebitda = m.grossProfit - m.commercialExpenses - m.adminExpenses - m.operationalExpenses;
      m.netProfit = m.ebitda + m.financialIncome - m.financialExpense + (m.otherIncome ?? 0) - (m.otherExpense ?? 0);
      m.loanMovement = (m.loanReceipts ?? 0) - (m.debts ?? 0);
      m.shareholderMovement = (m.capitalReceipts ?? 0) - (m.capitalWithdrawals ?? 0);
      m.result = m.netProfit + m.loanMovement + m.shareholderMovement - (m.investments ?? 0);
      m.netMargin = m.netRevenue > 0 ? m.netProfit / m.netRevenue : 0;
      balance += m.cashIn - m.cashOut;
      m.cashBalance = balance;
    }
    return remember(monthlyCache, cacheKey, arr);
  }

  // Fast path — combined KPIs when no company/category/cost-center filter.
  const allYears = f.year === 0;
  const source = hasCustomRange || allYears
    ? Object.values(KPI_BY_YEAR).flat()
    : (KPI_BY_YEAR[f.year] ?? []);
  const months = hasCustomRange
    ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    : monthsForFilters(f);

  return source.filter((k) => {
    if (!months.includes(k.monthIndex)) return false;
    if (hasCustomRange && !monthOverlapsRange(k.year, k.monthIndex, f.customStart, f.customEnd)) return false;
    return true;
  });
}

export function getTransactions(f: FiltersState): Transaction[] {
  const cacheKey = filterKey(f);
  const cached = transactionCache.get(cacheKey);
  if (cached) return cached;
  const rows = f.basis === "cash" ? f.includeOpenCash
    ? (cashWithOpenTransactions ??= transactionsForBasis(allTransactions, "cash", true))
    : (cashTransactions ??= transactionsForBasis(allTransactions, "cash")) : (accrualTransactions ??= transactionsForBasis(allTransactions, "accrual"));
  return remember(transactionCache, cacheKey, rows
    .filter((t) => matchesTransaction(t, f)).map((t) => projectTransaction(t, f)));
}


/** Aggregates monthly KPIs for the period covered by current filters. */
export function getAggregateKpis(f: FiltersState) {
  const ks = getMonthlyKpis(f);
  if (ks.length === 0) return null;
  const sum = (sel: (k: MonthlyKpi) => number) => ks.reduce((a, b) => a + sel(b), 0);
  const grossRevenue = sum((k) => k.grossRevenue);
  const netRevenue = sum((k) => k.netRevenue);
  const operationalCosts = sum((k) => k.operationalCosts);
  const operationalExpenses = sum(
    (k) => k.operationalExpenses + k.commercialExpenses + k.adminExpenses,
  );
  const ebitda = sum((k) => k.ebitda);
  const netProfit = sum((k) => k.netProfit);
  const last = ks[ks.length - 1];
  const cashBalance = last?.cashBalance ?? 0;
  const accountsReceivable = sum((k) => k.accountsReceivable);
  const accountsPayable = sum((k) => k.accountsPayable);

  return {
    grossRevenue,
    netRevenue,
    operationalCosts,
    operationalExpenses,
    ebitda,
    netProfit,
    netMargin: netRevenue > 0 ? netProfit / netRevenue : 0,
    cashBalance,
    accountsReceivable,
    accountsPayable,
  };
}

/** Variation vs same range, previous period (previous month if month filter, otherwise previous year). */
export function getVariation(f: FiltersState, metric: keyof MonthlyKpi | "totalOperationalExpenses"): number | null {
  const value = (k: MonthlyKpi) => metric === "totalOperationalExpenses"
    ? k.operationalExpenses + k.commercialExpenses + k.adminExpenses : Number(k[metric] ?? 0);
  const current = getMonthlyKpis(f);
  if (current.length === 0) return null;
  const cur = current.reduce((a, b) => a + value(b), 0);

  if (selectedYears(f).length !== 1 || selectedMonths(f).length > 1 || (f.quarters?.length ?? 0) > 1 || selectedDateRanges(f).length) return null;
  let previousFilters: FiltersState;
  if (f.month !== "all") {
    const prevMonth = f.month === 1 ? 12 : f.month - 1;
    const prevYear = f.month === 1 ? f.year - 1 : f.year;
    previousFilters = { ...f, year: prevYear, years: [prevYear], month: prevMonth, months: [prevMonth] };
  } else {
    previousFilters = { ...f, year: f.year - 1, years: [f.year - 1] };
  }
  const previous = getMonthlyKpis(previousFilters);
  if (previous.length === 0) return null;
  const prev = previous.reduce((total, month) => total + value(month), 0);
  if (!prev) return null;
  return (cur - prev) / Math.abs(prev);
}

export function topByAmount(items: Transaction[], n = 5) {
  const map = new Map<string, number>();
  for (const t of items) map.set(t.party, (map.get(t.party) ?? 0) + t.amount);
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

export function groupByCategory(items: Transaction[]) {
  const map = new Map<string, number>();
  for (const t of items) {
    if (t.source) for (const a of t.source.allocations) map.set(a.category, (map.get(a.category) ?? 0) + a.amount);
    else map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function groupByCostCenter(items: Transaction[]) {
  const amounts = new Map<string, number>();
  for (const t of items) {
    const rows = t.source?.allocations ?? [{ costCenter: t.costCenter, amount: t.amount }];
    for (const a of rows) {
      const name = a.costCenter || "Nao informado na origem";
      amounts.set(name, (amounts.get(name) ?? 0) + a.amount);
    }
  }
  return [...amounts].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}
