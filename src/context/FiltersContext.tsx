import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { COMPANY_OPTIONS, type AccountingBasis, type CompanyId, type Transaction } from "@/data/mock";
import { reconcileFilterChange, resetCompanyFilters, scopeFiltersToType, selectedCompanies, selectedMonths, selectedYears, selectedQuarters, selectedCategories, selectedCostCenters, selectedPayments, selectedFinancialAccounts, selectedDateRanges, selectedBases } from "@/lib/filter-options";
import { dateRangeError } from "@/lib/date";
import { usePlatformAccess } from "./PlatformAccessContext";

export type Quarter = 1 | 2 | 3 | 4 | "all";

export type PaymentStatusFilter = "all" | "paid" | "open";

export type FiltersState = {
  years?: number[];
  months?: number[];
  companies?: Exclude<CompanyId, "all">[];
  quarters?: (1 | 2 | 3 | 4)[];
  bases?: AccountingBasis[];
  categories?: string[];
  costCenters?: string[];
  payments?: ("paid" | "open")[];
  financialAccounts?: string[];
  dateRanges?: { start: string; end: string }[];
  year: number;
  quarter: Quarter;
  month: number | "all"; // 1-12 or all
  basis: AccountingBasis;
  company: CompanyId;
  customStart: string;
  customEnd: string;
  costCenter: string;
  category: string;
  payment: PaymentStatusFilter;
  financialAccount?: string;
  includeOpenCash?: boolean;
};

type Ctx = FiltersState & {
  companyOptions: { id: Exclude<CompanyId, "all">; name: string }[];
  setYears: (values: number[]) => void;
  setMonths: (values: number[]) => void;
  setCompanies: (values: Exclude<CompanyId, "all">[]) => void;
  setQuarters: (values: (1 | 2 | 3 | 4)[]) => void;
  setBases: (values: AccountingBasis[]) => void;
  setCategories: (values: string[]) => void;
  setCostCenters: (values: string[]) => void;
  setPayments: (values: ("paid" | "open")[]) => void;
  setFinancialAccounts: (values: string[]) => void;
  setDateRanges: (values: { start: string; end: string }[]) => void;
  periodLabel: string;
  setYear: (y: number) => void;
  setQuarter: (q: Quarter) => void;
  setMonth: (m: number | "all") => void;
  setBasis: (b: AccountingBasis) => void;
  setCompany: (c: CompanyId) => void;
  setCustomStart: (date: string) => void;
  setCustomEnd: (date: string) => void;
  setCostCenter: (costCenter: string) => void;
  setCategory: (category: string) => void;
  setPayment: (p: PaymentStatusFilter) => void;
  setFinancialAccount: (account: string) => void;
  resetFilters: () => void;
  activeFilterCount: number;
  companyLabel: string;
  basisLocked: boolean;
  dateError: string | null;
};

const FiltersContext = createContext<Ctx | null>(null);

export const DEFAULT_FILTERS: FiltersState = {
  year: new Date().getFullYear(),
  quarter: "all",
  month: "all",
  basis: "accrual",
  // The connected Conta Azul account belongs to W2; start scoped to it so
  // month filters never combine the W2 view with unrelated companies.
  company: "w2",
  customStart: "",
  customEnd: "",
  costCenter: "all",
  category: "all",
  payment: "all",
  financialAccount: "all",
};

const savedFiltersSchema = z.object({
  years: z.array(z.number().int().min(1900).max(2200)).max(301).optional(),
  months: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  companies: z.array(z.enum(["w2", "d61", "somus", "lie", "lie-design", "manual-test"])).max(6).optional(),
  quarters: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).max(4).optional(),
  bases: z.array(z.enum(["cash", "accrual"])).max(2).optional(),
  categories: z.array(z.string()).max(1000).optional(),
  costCenters: z.array(z.string()).max(1000).optional(),
  payments: z.array(z.enum(["paid", "open"])).max(2).optional(),
  financialAccounts: z.array(z.string()).max(1000).optional(),
  dateRanges: z.array(z.object({ start: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/), end: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/) })).max(50).optional(),
  year: z.union([z.literal(0), z.number().int().min(1900).max(2200)]),
  quarter: z.union([z.literal("all"), z.number().int().min(1).max(4)]),
  month: z.union([z.literal("all"), z.number().int().min(1).max(12)]),
  basis: z.enum(["cash", "accrual"]),
  company: z.enum(["all", "w2", "d61", "somus", "lie", "lie-design", "manual-test"]),
  customStart: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  customEnd: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  costCenter: z.string(), category: z.string(),
  payment: z.enum(["all", "paid", "open"]),
  financialAccount: z.string().default("all"),
});

function readFilters(key: string): FiltersState {
  try {
    const parsed = savedFiltersSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    if (parsed.success) return parsed.data as FiltersState;
  } catch { /* Storage may be disabled in private browsers. */ }
  return DEFAULT_FILTERS;
}

export function FiltersProvider({ children, userId, transactionType, dataVersion = 0, cashOnly = false, includeOpenCash = false }: { children: ReactNode; userId: string; transactionType?: Transaction["type"]; dataVersion?: number; cashOnly?: boolean; includeOpenCash?: boolean }) {
  const access = usePlatformAccess();
  const companyOptions = useMemo(() => [...new Map(access.companies.map(c => [c.key, { id: c.key, name: c.name }])).values()], [access.companies]);
  const storageKey = `somus:filters:v1:${userId}`;
  const [stored, setFilters] = useState(() => readFilters(storageKey));
  // This projection belongs to the current module, not the saved user preference.
  const viewState = stored.includeOpenCash === includeOpenCash ? stored : { ...stored, includeOpenCash };
  const requested = selectedCompanies(viewState);
  const permitted = requested.filter(key => companyOptions.some(c => c.id === key));
  const scoped = requested.length && permitted.length !== requested.length ? { ...viewState,
    companies: permitted.length ? permitted : companyOptions.map(c => c.id),
    company: permitted.length === 1 ? permitted[0] : companyOptions.length === 1 ? companyOptions[0].id : "all" as const } : viewState;
  const typedState = scopeFiltersToType(scoped, transactionType);
  const state = cashOnly && (typedState.basis !== "cash" || selectedBases(typedState).length !== 1) ? reconcileFilterChange(typedState, "basis", "cash") : typedState;
  const { year, quarter, month, basis, company, customStart, customEnd, costCenter, category, payment, financialAccount = "all" } = state;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ years: state.years, months: state.months, companies: state.companies,
        quarters: state.quarters, bases: state.bases, categories: state.categories, costCenters: state.costCenters,
        payments: state.payments, financialAccounts: state.financialAccounts, dateRanges: state.dateRanges, year, quarter, month, basis, company,
        customStart, customEnd, costCenter, category, payment, financialAccount }));
    } catch { /* Filtering still works when browser storage is unavailable. */ }
    if (state !== stored) setFilters(state);
  }, [storageKey, year, quarter, month, basis, company, customStart, customEnd, costCenter, category, payment, financialAccount, state, stored]);

  const resetFilters = () => {
    setFilters((previous) => resetCompanyFilters(previous, DEFAULT_FILTERS));
  };
  const update = (field: keyof FiltersState, value: FiltersState[keyof FiltersState]) =>
    setFilters((previous) => scopeFiltersToType(reconcileFilterChange({ ...previous, includeOpenCash }, field, value), transactionType));

  const activeFilterCount = [
    selectedYears(state).length !== 1 || selectedYears(state)[0] !== DEFAULT_FILTERS.year,
    selectedQuarters(state).length > 0,
    selectedMonths(state).length > 0,
    selectedBases(state).length !== 1 || basis !== DEFAULT_FILTERS.basis,
    selectedCompanies(state).length !== 1 || selectedCompanies(state)[0] !== DEFAULT_FILTERS.company,
    Boolean(customStart),
    Boolean(customEnd) || Boolean(state.dateRanges?.some(range => range.start || range.end)),
    selectedCostCenters(state).length > 0,
    selectedCategories(state).length > 0,
    selectedPayments(state).length > 0,
    selectedFinancialAccounts(state).length > 0,
  ].filter(Boolean).length;

  const value = useMemo<Ctx>(
    () => ({
      companyOptions,
      years: state.years, months: state.months, companies: state.companies,
      quarters: state.quarters, bases: state.bases, categories: state.categories, costCenters: state.costCenters,
      payments: state.payments, financialAccounts: state.financialAccounts, dateRanges: state.dateRanges,
      setYears: (values) => update("years", [...new Set(values)].sort((a, b) => a - b)),
      setMonths: (values) => update("months", [...new Set(values)].sort((a, b) => a - b)),
      setCompanies: (values) => update("companies", [...new Set(values)].sort()),
      setQuarters: (values) => update("quarters", [...new Set(values)].sort()),
      setBases: (values) => update("bases", cashOnly ? ["cash"] : [...new Set(values)].sort()),
      setCategories: (values) => update("categories", [...new Set(values)].sort()),
      setCostCenters: (values) => update("costCenters", [...new Set(values)].sort()),
      setPayments: (values) => update("payments", [...new Set(values)].sort()),
      setFinancialAccounts: (values) => update("financialAccounts", [...new Set(values)].sort()),
      setDateRanges: (values) => update("dateRanges", values),
      periodLabel: selectedDateRanges(state).length ? selectedDateRanges(state).map(range => `${range.start ? range.start.split("-").reverse().join("/") : "Inicio"} a ${range.end ? range.end.split("-").reverse().join("/") : "Hoje"}`).join("; ")
        : `${selectedYears(state).join(", ") || "Todos os anos"} · ${selectedMonths(state).map(m => new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(2026, m - 1, 1))).join(", ") || (selectedQuarters(state).length ? selectedQuarters(state).map(q => `${q}º trimestre`).join(", ") : "Todos os meses")}`,
      year,
      quarter,
      month,
      basis,
      company,
      customStart,
      customEnd,
      costCenter,
      category,
      payment,
      financialAccount,
      includeOpenCash,
      setYear: (value) => update("year", value),
      setQuarter: (value) => update("quarter", value),
      setMonth: (value) => update("month", value),
      setBasis: (value) => update("basis", cashOnly ? "cash" : value),
      setCompany: (value) => update("company", value),
      setCustomStart: (value) => update("customStart", value),
      setCustomEnd: (value) => update("customEnd", value),
      setCostCenter: (value) => update("costCenter", value),
      setCategory: (value) => update("category", value),
      setPayment: (value) => update("payment", value),
      setFinancialAccount: (value) => update("financialAccount", value),
      resetFilters,
      activeFilterCount,
      basisLocked: cashOnly,
      dateError: [dateRangeError(customStart, customEnd), ...(state.dateRanges ?? []).map(range => dateRangeError(range.start, range.end))].find(Boolean) ?? null,
      companyLabel: selectedCompanies(state).map(id => COMPANY_OPTIONS.find(c => c.id === id)?.name ?? id).join(", ") || "Todas as empresas",
    }),
    [
      year,
      quarter,
      month,
      basis,
      company,
      customStart,
      customEnd,
      costCenter,
      category,
      payment,
      financialAccount,
      activeFilterCount,
      transactionType,
      dataVersion,
      cashOnly,
      includeOpenCash,
      state.years, state.months, state.companies,
      state.quarters, state.bases, state.categories, state.costCenters, state.payments, state.financialAccounts, state.dateRanges,
      companyOptions,
    ],
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error("useFilters must be used inside FiltersProvider");
  return ctx;
}

export function BasisFiltersProvider({ basis, children }: { basis: AccountingBasis; children: ReactNode }) {
  const filters = useFilters();
  const value = useMemo(() => ({ ...filters, basis, bases: [basis] }), [filters, basis]);
  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export function monthsForFilters(f: Pick<FiltersState, "quarter" | "quarters" | "month" | "months">): number[] {
  if (f.months?.length) return f.months.map(month => month - 1);
  if (f.month !== "all") return [f.month - 1];
  const quarters = selectedQuarters(f);
  if (!quarters.length) return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  return quarters.flatMap(quarter => { const start = (quarter - 1) * 3; return [start, start + 1, start + 2]; });
}
