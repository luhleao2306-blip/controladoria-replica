import type { MonthlyKpi } from "@/data/mock";

export type DreRow = { label: string; key: keyof MonthlyKpi; negative?: boolean; emphasis?: "subtotal" | "total" };
export const DRE_ROWS: DreRow[] = [
  { label: "Receita Bruta", key: "grossRevenue" },
  { label: "(-) Impostos sobre vendas", key: "taxes", negative: true },
  { label: "(-) Comissões sobre vendas", key: "commissions", negative: true },
  { label: "(-) Descontos incondicionais", key: "discounts", negative: true },
  { label: "(=) Receita Líquida", key: "netRevenue", emphasis: "subtotal" },
  { label: "(-) Custo dos serviços prestados", key: "operationalCosts", negative: true },
  { label: "(=) Lucro Bruto", key: "grossProfit", emphasis: "subtotal" },
  { label: "(-) Despesas Comerciais", key: "commercialExpenses", negative: true },
  { label: "(-) Despesas Administrativas", key: "adminExpenses", negative: true },
  { label: "(-) Despesas Operacionais", key: "operationalExpenses", negative: true },
  { label: "(=) EBITDA", key: "ebitda", emphasis: "subtotal" },
  { label: "(-) Despesas Financeiras", key: "financialExpense", negative: true },
  { label: "(+) Receitas Financeiras", key: "financialIncome" },
  { label: "(+) Outras receitas nao operacionais", key: "otherIncome" },
  { label: "(-) Outras despesas nao operacionais", key: "otherExpense", negative: true },
  { label: "(=) Lucro Líquido", key: "netProfit", emphasis: "total" },
  { label: "Empréstimos (entradas e saídas)", key: "loanMovement" },
  { label: "Sócios (aportes e retiradas)", key: "shareholderMovement" },
  { label: "(-) Investimentos", key: "investments", negative: true },
  { label: "Sem classificação DRE", key: "unclassified" },
  { label: "(=) Resultado", key: "result", emphasis: "total" },
];

export const DRE_BUCKETS = ["grossRevenue", "taxes", "commissions", "discounts", "operationalCosts", "commercialExpenses",
  "adminExpenses", "operationalExpenses", "financialExpense", "financialIncome", "otherIncome", "otherExpense",
  "loanReceipts", "debts", "capitalReceipts", "capitalWithdrawals", "investments", "unclassified"] as const;
export type DreBucket = typeof DRE_BUCKETS[number];
const netRevenue = ["grossRevenue", "taxes", "commissions", "discounts"];
const grossProfit = [...netRevenue, "operationalCosts"];
const ebitda = [...grossProfit, "commercialExpenses", "adminExpenses", "operationalExpenses"];
const netProfit = [...ebitda, "financialIncome", "financialExpense", "otherIncome", "otherExpense"];
export const DRE_COMPONENTS: Record<string, readonly string[]> = {
  netRevenue, grossProfit, ebitda, netProfit,
  loanMovement: ["loanReceipts", "debts"], shareholderMovement: ["capitalReceipts", "capitalWithdrawals"],
  result: [...netProfit, "loanReceipts", "debts", "capitalReceipts", "capitalWithdrawals", "investments"],
};
export const DRE_BUCKET_LABELS: Record<DreBucket, string> = Object.fromEntries(DRE_BUCKETS.map(bucket => [bucket,
  DRE_ROWS.find(row => row.key === bucket)?.label ?? ({ loanReceipts: "(+) Empréstimos recebidos", debts: "(-) Empréstimos e dívidas",
    capitalReceipts: "(+) Aportes", capitalWithdrawals: "(-) Retiradas de sócios" } as Record<string, string>)[bucket],
])) as Record<DreBucket, string>;
