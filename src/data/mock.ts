import { MONTHS_PT } from "@/lib/format";
import type { ContaAzulMetadata } from "@/lib/conta-azul-model";

// Estruturas preenchidas em runtime pelos dados reais do banco externo.

export type CompanyId = "all" | "w2" | "d61" | "somus" | "lie" | "lie-design" | "manual-test";
export type AccountingBasis = "cash" | "accrual";

export const COMPANIES: { id: Exclude<CompanyId, "all">; name: string }[] = [
  { id: "w2", name: "W2 Publicidade" },
  { id: "d61", name: "D61" },
  { id: "somus", name: "Somus" },
  { id: "lie", name: "LIE ARQUITETURA" },
  { id: "lie-design", name: "Liê Design" },
  { id: "manual-test", name: "Empresa Teste" },
];

export const COMPANY_OPTIONS: { id: CompanyId; name: string }[] = [
  { id: "all", name: "Todas as empresas" },
  ...COMPANIES,
];

export const CLIENTS: string[] = [];
export const SUPPLIERS: string[] = [];
export const SERVICE_TYPES = [] as const;
export const EXPENSE_CATEGORIES = [] as const;
export const COST_CENTERS = ["Não alocado", "Tributária", "Ocupação", "Pessoal"] as string[];

export type MonthlyKpi = {
  year: number; monthIndex: number; monthLabel: string;
  grossRevenue: number; taxes: number; commissions: number; netRevenue: number;
  operationalCosts: number; commercialExpenses: number; adminExpenses: number; operationalExpenses: number;
  financialIncome: number; financialExpense: number; grossProfit: number; ebitda: number;
  netProfit: number; netMargin: number; cashIn: number; cashOut: number; cashBalance: number;
  accountsReceivable: number; accountsPayable: number;
  otherIncome?: number; otherExpense?: number; investments?: number; debts?: number; discounts?: number;
  loanReceipts?: number; capitalReceipts?: number; capitalWithdrawals?: number;
  loanMovement?: number; shareholderMovement?: number; unclassified?: number; result?: number;
};

function emptyYear(year: number): MonthlyKpi[] {
  return MONTHS_PT.map((monthLabel, monthIndex) => ({
    year, monthIndex, monthLabel,
    grossRevenue: 0, taxes: 0, commissions: 0, netRevenue: 0,
    operationalCosts: 0, commercialExpenses: 0, adminExpenses: 0, operationalExpenses: 0,
    financialIncome: 0, financialExpense: 0, grossProfit: 0, ebitda: 0,
    netProfit: 0, netMargin: 0, cashIn: 0, cashOut: 0, cashBalance: 0,
    accountsReceivable: 0, accountsPayable: 0,
  }));
}

export const KPI_BY_YEAR: Record<number, MonthlyKpi[]> = {
  2023: emptyYear(2023),
  2024: emptyYear(2024),
  2025: emptyYear(2025),
  2026: emptyYear(2026),
  2027: emptyYear(2027),
};

export const YEARS = [2023, 2024, 2025, 2026, 2027] as const;

export type Transaction = { 
  id: string; 
  date: string; 
  competencyDate?: string;
  paymentDate?: string;
  dueDate?: string;
  description?: string;
  source?: ContaAzulMetadata;
  type: "revenue" | "expense"; 
  party: string; 
  category: string; 
  costCenter: string; 
  amount: number; 
  status: "Pago" | "Pendente" | "Atrasado"; 
  company: Exclude<CompanyId, "all">; 
};

export const TRANSACTIONS_BY_YEAR: Record<number, Transaction[]> = {
  2023: [],
  2024: [],
  2025: [],
  2026: [],
};

export type AlertEvent = { id: string; title: string; description: string; severity: "low" | "medium" | "high" | "critical"; financialImpact: number; recommendation: string; createdAt: string; status: "open" | "in_review" | "resolved"; };

export const ALERTS: AlertEvent[] = [];

export const TARGETS_2025: { category: string; planned: number; realized: number }[] = [];
