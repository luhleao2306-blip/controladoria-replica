import type { FiltersState } from "@/context/FiltersContext";
import { TRANSACTIONS_BY_YEAR, type Transaction } from "@/data/mock";
import { dateIsInRange, parseLocalDate } from "./date";
import { projectContaAzulReporting, scaleReportingAllocations as scaleAllocations } from "./conta-azul-reporting";

export function resetCompanyFilters(current: FiltersState, defaults: FiltersState): FiltersState {
  return { ...defaults, company: current.company, ...(current.companies ? { companies: current.companies } : {}) };
}

export const selectedCompanies = (f: Pick<FiltersState, "company" | "companies">) => f.companies ?? (f.company === "all" ? [] : [f.company]);
export const selectedYears = (f: Pick<FiltersState, "year" | "years">) => f.years ?? (f.year === 0 ? [] : [f.year]);
export const selectedMonths = (f: Pick<FiltersState, "month" | "months">) => f.months ?? (f.month === "all" ? [] : [f.month]);
export const selectedQuarters = (f: Pick<FiltersState, "quarter" | "quarters">) => f.quarters ?? (f.quarter === "all" ? [] : [f.quarter]);
export const selectedBases = (f: Pick<FiltersState, "basis" | "bases">) => f.bases ? (f.bases.length ? f.bases : ["accrual", "cash"] as const) : [f.basis];
export const selectedCategories = (f: Pick<FiltersState, "category" | "categories">) => f.categories ?? (f.category === "all" ? [] : [f.category]);
export const selectedCostCenters = (f: Pick<FiltersState, "costCenter" | "costCenters">) => f.costCenters ?? (f.costCenter === "all" ? [] : [f.costCenter]);
export const selectedPayments = (f: Pick<FiltersState, "payment" | "payments">) => f.payments ?? (f.payment === "all" ? [] : [f.payment]);
export const selectedFinancialAccounts = (f: Pick<FiltersState, "financialAccount" | "financialAccounts">) => f.financialAccounts ?? (!f.financialAccount || f.financialAccount === "all" ? [] : [f.financialAccount]);
export const selectedDateRanges = (f: Pick<FiltersState, "customStart" | "customEnd" | "dateRanges">) => [
  { start: f.customStart, end: f.customEnd }, ...(f.dateRanges ?? []),
].filter(range => range.start || range.end);

export function filterSelectionKey(f: FiltersState) {
  return JSON.stringify([selectedCompanies(f), selectedYears(f), selectedMonths(f), selectedQuarters(f),
    selectedBases(f), f.basis, selectedCategories(f), selectedCostCenters(f), selectedPayments(f),
    selectedFinancialAccounts(f), selectedDateRanges(f), Boolean(f.includeOpenCash)]);
}

let currentArrays: Transaction[][] = [];
let currentRows: Transaction[] = [];
let currentCash: Transaction[] | null = null;
let currentCashWithOpen: Transaction[] | null = null;
let currentAccrual: Transaction[] | null = null;
function rowsForBasis(basis: FiltersState["basis"], includeOpenCash = false) {
  const arrays = Object.values(TRANSACTIONS_BY_YEAR);
  if (arrays.length !== currentArrays.length || arrays.some((a, i) => a !== currentArrays[i])) {
    currentArrays = arrays; currentRows = arrays.flat(); currentCash = null; currentCashWithOpen = null; currentAccrual = null;
  }
  if (basis === "cash" && includeOpenCash) return currentCashWithOpen ??= transactionsForBasis(currentRows, basis, true);
  return basis === "cash" ? (currentCash ??= transactionsForBasis(currentRows, basis)) : (currentAccrual ??= transactionsForBasis(currentRows, basis));
}

export function txDate(t: Transaction, basis: FiltersState["basis"]): string {
  return (basis === "cash" ? t.paymentDate || t.date : t.competencyDate || t.date) || t.date;
}

export function transactionsForBasis(rows: Transaction[], basis: FiltersState["basis"], includeOpenCash = false): Transaction[] {
  return rows.flatMap((t): Transaction[] => {
    const reporting = projectContaAzulReporting(t, basis, includeOpenCash);
    if (reporting) return reporting;
    if (basis !== "cash") return [t];
    if (t.source?.origin === "initial_balance") return [t];
    if (!t.source) return [includeOpenCash && t.status !== "Pago"
      ? { ...t, date: t.dueDate || t.date, paymentDate: undefined } : t];
    const payments: Transaction[] = t.source.payments.map((p) => ({
    ...t, id: `${t.id}:payment:${p.id}`, date: p.date, paymentDate: p.date, amount: p.amount, status: "Pago" as const,
    source: { ...t.source!, paidAmount: p.amount, outstandingAmount: 0, account: p.account,
      allocations: scaleAllocations(t.source!.allocations, p.amount), payments: [p] },
    }));
    if (includeOpenCash && t.source.active && t.source.outstandingAmount > 0) {
      // Only the unpaid remainder is projected; settlements keep their actual dates.
      const amount = t.source.outstandingAmount;
      payments.push({ ...t, id: `${t.id}:outstanding`, date: t.dueDate || t.date, paymentDate: undefined,
        amount, status: t.status === "Atrasado" ? "Atrasado" : "Pendente",
        source: { ...t.source, paidAmount: 0, outstandingAmount: amount, payments: [],
          allocations: scaleAllocations(t.source.allocations, amount) } });
    }
    return payments;
  });
}

export function projectTransaction(t: Transaction, f: FiltersState): Transaction {
  const categories = selectedCategories(f), centers = selectedCostCenters(f);
  if (!t.source || (!categories.length && !centers.length)) return t;
  const matches = (a: NonNullable<Transaction["source"]>["allocations"][number]) =>
    (!categories.length || categories.includes(a.category)) &&
    (!centers.length || centers.includes(a.costCenter || "Nao informado na origem"));
  const selected = t.source.allocations.filter(matches);
  const amount = selected.reduce((sum, a) => sum + a.amount, 0);
  return { ...t, amount, category: [...new Set(selected.map((a) => a.category))].join("; "),
    costCenter: [...new Set(selected.map((a) => a.costCenter || "Nao informado na origem"))].join("; "),
    source: { ...t.source, allocations: selected,
      paidAmount: scaleAllocations(t.source.allocations, t.source.paidAmount).filter(matches).reduce((sum, a) => sum + a.amount, 0),
      outstandingAmount: scaleAllocations(t.source.allocations, t.source.outstandingAmount).filter(matches).reduce((sum, a) => sum + a.amount, 0) } };
}

export function matchesTransaction(t: Transaction, f: FiltersState): boolean {
  const companies = selectedCompanies(f);
  if (companies.length && !companies.includes(t.company)) return false;
  const accounts = selectedFinancialAccounts(f);
  if (accounts.length && !accounts.includes(t.source?.account ?? "")) return false;
  const date = txDate(t, f.basis);
  const ranges = selectedDateRanges(f);
  if (ranges.length) {
    if (!ranges.some(range => dateIsInRange(date, range.start, range.end))) return false;
  } else {
    const parsed = parseLocalDate(date);
    const years = selectedYears(f), months = selectedMonths(f);
    if (!parsed || (years.length && !years.includes(parsed.getFullYear()))) return false;
    const month = parsed.getMonth() + 1;
    if (months.length && !months.includes(month)) return false;
    const quarters = selectedQuarters(f);
    if (!months.length && quarters.length && !quarters.some(quarter => quarter === Math.ceil(month / 3))) return false;
  }
  const categories = selectedCategories(f), centers = selectedCostCenters(f);
  if (t.source) {
    if (!t.source.allocations.some((a) =>
      (!categories.length || categories.includes(a.category)) &&
      (!centers.length || centers.includes(a.costCenter || "Nao informado na origem")))) return false;
  } else {
    if (centers.length && !centers.includes(t.costCenter)) return false;
    if (categories.length && !categories.includes(t.category)) return false;
  }
  const payments = selectedPayments(f);
  if (payments.length && !payments.some(payment => payment === "paid" ? t.status === "Pago"
    : t.source ? t.source.outstandingAmount > 0 : t.status !== "Pago")) return false;
  return true;
}

function relaxSecondary(rows: Transaction[], f: FiltersState): FiltersState | null {
  const combinations: ("category" | "costCenter" | "payment" | "financialAccount")[][] = [
    ["category"], ["costCenter"], ["payment"],
    ["category", "costCenter"], ["category", "payment"], ["costCenter", "payment"],
    ["category", "costCenter", "payment"],
    ["financialAccount"], ["category", "costCenter", "payment", "financialAccount"],
  ];
  for (const fields of combinations) {
    const candidate = { ...f };
    for (const field of fields) {
      candidate[field] = "all";
      if (field === "category") candidate.categories = [];
      if (field === "costCenter") candidate.costCenters = [];
      if (field === "payment") candidate.payments = [];
      if (field === "financialAccount") candidate.financialAccounts = [];
    }
    if (rows.some((t) => matchesTransaction(t, candidate))) return candidate;
  }
  return null;
}

export function reconcileFilterChange(f: FiltersState, field: keyof FiltersState, value: FiltersState[keyof FiltersState]): FiltersState {
  const next = { ...f, [field]: value };
  if (field === "years") next.year = next.years?.length === 1 ? next.years[0] : 0;
  if (field === "months") next.month = next.months?.length === 1 ? next.months[0] : "all";
  if (field === "companies") next.company = next.companies?.length === 1 ? next.companies[0] : "all";
  if (field === "quarters") next.quarter = next.quarters?.length === 1 ? next.quarters[0] : "all";
  if (field === "bases") next.basis = next.bases?.[0] ?? "accrual";
  if (field === "categories") next.category = next.categories?.length === 1 ? next.categories[0] : "all";
  if (field === "costCenters") next.costCenter = next.costCenters?.length === 1 ? next.costCenters[0] : "all";
  if (field === "payments") next.payment = next.payments?.length === 1 ? next.payments[0] : "all";
  if (field === "financialAccounts") next.financialAccount = next.financialAccounts?.length === 1 ? next.financialAccounts[0] : "all";
  if (field === "year") next.years = next.year ? [next.year] : [];
  if (field === "month") next.months = next.month === "all" ? [] : [next.month];
  if (field === "company") next.companies = next.company === "all" ? [] : [next.company];
  if (field === "quarter") next.quarters = next.quarter === "all" ? [] : [next.quarter];
  if (field === "basis") next.bases = [next.basis];
  if (field === "category") next.categories = next.category === "all" ? [] : [next.category];
  if (field === "costCenter") next.costCenters = next.costCenter === "all" ? [] : [next.costCenter];
  if (field === "payment") next.payments = next.payment === "all" ? [] : [next.payment];
  if (field === "financialAccount") next.financialAccounts = !next.financialAccount || next.financialAccount === "all" ? [] : [next.financialAccount];
  if (["year", "years", "month", "months", "quarter", "quarters"].includes(field)) {
    next.customStart = "";
    next.customEnd = "";
    next.dateRanges = [];
  }
  if (["month", "months"].includes(field)) { next.quarter = "all"; next.quarters = []; }
  if (["quarter", "quarters"].includes(field)) { next.month = "all"; next.months = []; }
  if (!["company", "companies", "year", "years", "month", "months", "quarter", "quarters", "basis", "bases"].includes(field)) return next;
  const rows = rowsForBasis(next.basis, next.includeOpenCash);
  if (selectedBases(next).some(basis => rowsForBasis(basis, next.includeOpenCash).some(t => matchesTransaction(t, { ...next, basis })))) return next;
  // Keep the requested company/period; only remove incompatible secondary filters.
  const relaxed = relaxSecondary(rows, next);
  if (relaxed) return relaxed;
  if (["company", "year", "basis"].includes(field)) {
    const fullYear = { ...next, month: "all" as const, months: [], quarter: "all" as const, quarters: [] };
    if (rows.some((t) => matchesTransaction(t, fullYear))) return fullYear;
    return relaxSecondary(rows, fullYear) ?? next;
  }
  return next;
}

type FilterOptions = { years: number[]; categories: string[]; costCenters: string[]; accounts: string[]; months: number[]; paid: number; open: number };

export function getFilterOptions(f: FiltersState, type?: Transaction["type"]): FilterOptions {
  const bases = selectedBases(f);
  if (bases.length > 1) {
    const views = bases.map(basis => getFilterOptions({ ...f, basis, bases: [basis] }, type));
    const names = (key: "categories" | "costCenters" | "accounts") => [...new Set(views.flatMap(view => view[key]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return { years: [...new Set(views.flatMap(view => view.years))].sort((a,b) => b-a),
      categories: names("categories"), costCenters: names("costCenters"), accounts: names("accounts"),
      months: Array.from({ length: 12 }, (_, i) => Math.max(...views.map(view => view.months[i]))),
      paid: Math.max(...views.map(view => view.paid)), open: Math.max(...views.map(view => view.open)) };
  }
  const rows = rowsForBasis(f.basis, f.includeOpenCash).filter((t) => !type || t.type === type);
  const count = (filters: FiltersState) => rows.filter((t) => matchesTransaction(t, filters)).length;
  const period = { ...f, category: "all", categories: [], costCenter: "all", costCenters: [], payment: "all" as const, payments: [] };
  const scoped = rows.filter((t) => matchesTransaction(t, { ...period, year: 0, years: [], month: "all", months: [], quarter: "all", quarters: [], customStart: "", customEnd: "", dateRanges: [] }));
  const years = [...new Set(scoped.map((t) => parseLocalDate(txDate(t, f.basis))?.getFullYear()).filter((year): year is number => year !== undefined))].sort((a, b) => b - a);
  const centers = selectedCostCenters(f), selected = selectedCategories(f);
  const categories = [...new Set(rows.filter((t) => matchesTransaction(t, { ...f, category: "all", categories: [] }))
    .flatMap((t) => t.source ? t.source.allocations
      .filter(a => !centers.length || centers.includes(a.costCenter || "Nao informado na origem"))
      .map((a) => a.category) : [t.category]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const costCenters = [...new Set(rows.filter((t) => matchesTransaction(t, { ...f, costCenter: "all", costCenters: [] }))
    .flatMap((t) => t.source ? t.source.allocations
      .filter(a => !selected.length || selected.includes(a.category))
      .map((a) => a.costCenter || "Nao informado na origem") : [t.costCenter]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const accounts = [...new Set(rows.filter((t) => matchesTransaction(t, { ...f, financialAccount: "all", financialAccounts: [] }))
    .map((t) => t.source?.account).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const months = Array<number>(12).fill(0);
  const monthlyFilters = { ...period, month: "all" as const, months: [], quarter: "all" as const, quarters: [], customStart: "", customEnd: "", dateRanges: [] };
  for (const row of rows) {
    if (!matchesTransaction(row, monthlyFilters)) continue;
    const month = parseLocalDate(txDate(row, f.basis))?.getMonth();
    if (month !== undefined) months[month]++;
  }
  return {
    years,
    categories,
    costCenters,
    accounts,
    months,
    paid: count({ ...f, payment: "paid", payments: ["paid"] }),
    open: count({ ...f, payment: "open", payments: ["open"] }),
  };
}

export function scopeFiltersToType(f: FiltersState, type?: Transaction["type"]): FiltersState {
  if (!type) return f;
  if (selectedBases(f).some(basis => rowsForBasis(basis, f.includeOpenCash).some(t => t.type === type && matchesTransaction(t, { ...f, basis })))) return f;
  const rows = rowsForBasis(f.basis, f.includeOpenCash).filter((t) => t.type === type);
  if (rows.some((t) => matchesTransaction(t, f))) return f;
  return relaxSecondary(rows, f) ?? f;
}
