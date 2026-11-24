// Classificação de categorias para as linhas do DRE.
// Baseada no plano de contas vindo do Conta Azul,
// ex.: "03.02.01. Simples Nacional", "01.01.01. Serviço recorrente".

export type DreLine =
  | "grossRevenue"
  | "financialIncome"
  | "taxes"
  | "commissions"
  | "operationalCosts"
  | "commercialExpenses"
  | "adminExpenses"
  | "operationalExpenses"
  | "financialExpense"
  | "loanReceipts"
  | "capitalReceipts"
  | "capitalWithdrawals"
  | "investments"
  | "debts";

function normalize(category: string | null | undefined) {
  return (category ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** "03.02.01. Simples Nacional" -> ["03","02","01"] */
function codeParts(category: string): string[] {
  const match = category.match(/^\s*(\d{1,2})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?/);
  if (!match) return [];
  return [match[1], match[2], match[3]]
    .filter((p): p is string => Boolean(p))
    .map((p) => p.padStart(2, "0"));
}

function group(category: string, depth: 1 | 2 | 3) {
  const parts = codeParts(category);
  if (parts.length < depth) return null;
  return parts.slice(0, depth).join(".");
}

const TAX_WORDS =
  /(imposto|tributo|simples nacional|\biss\b|\bicms\b|\bpis\b|cofins|irpj|csll|\bdas\b|taxa fiscaliza|retenc)/;
const COMMISSION_WORDS = /comiss/;
const FINANCIAL_EXPENSE_WORDS = /(tarifa banc|juros|emprestimo|financiamento|iof|cartoes|cartao)/;
const FINANCIAL_INCOME_WORDS = /(rendiment|juros recebid|aplicacao financeira|aporte)/;
const COMMERCIAL_WORDS = /(marketing|trafego|publicidade|relacionamento|comercial|prospec)/;
const ADMIN_WORDS =
  /(salario|pro labore|folha|fgts|inss|beneficio|estagio|freela|contabilidade|treinamento|curso|confraterniza|socios|rescisao|admissao|vale transporte|sindicato|junta comercial)/;
const OPERATIONAL_COST_WORDS = /(custo|producao|hospedagem|sistema operacional|terceirizacao|revenda)/;

export function isPrincipalLoanCategory(category: string | null | undefined) {
  const c = normalize(category);
  return /\b(emprestimo|emprestimos|financiamento|financiamentos)\b/.test(c)
    && !/\b(juros|tarifa|tarifas|iof|multa|multas|encargo|encargos)\b/.test(c);
}

export function isShareholderWithdrawal(category: string | null | undefined) {
  const name = normalize(category).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  return /^retiradas?\s+(?:de\s+)?socios$/.test(name);
}

// Common capital rules and owner-approved company-specific category fallbacks.
export function approvedDreCategory(type: "revenue" | "expense", category: string, company?: string): DreLine | undefined {
  const name = normalize(category).replace(/^\d+(?:\.\d+)*\.?\s*/, "");
  if (name === "saldo inicial (aporte)") return type === "revenue" ? "capitalReceipts" : "capitalWithdrawals";
  if (type === "expense" && isShareholderWithdrawal(category)) return "capitalWithdrawals";
  if (type === "revenue" && name === "aporte") return "capitalReceipts";
  if (type === "expense" && ["somus", "w2", "d61"].includes(company ?? "") && name === "plataformas ia") return "operationalExpenses";
  if (type === "expense" && company === "lie") {
    if (group(category, 3) === "02.02.06" && name === "investimento lie digital") return "investments";
    if (name === "juros pagos" || name === "multas pagas") return "financialExpense";
  }
  if (type === "expense" && company === "lie-design") {
    if (group(category, 3) === "02.02.06" && name === "investimento lie digital") return "investments";
    if (group(category, 3) === "02.09.01" && name === "aquisicao de imobilizado") return "investments";
    if (name === "multas pagas") return "financialExpense";
  }
  if (company !== "w2") return undefined;
  if (type === "expense" && group(category, 2) === "04.05" && name === "imobiliario") return "investments";
  return undefined;
}

/** Impostos sobre a venda. */
export function isTaxCategory(category: string | null | undefined) {
  const c = normalize(category);
  if (!c) return false;
  if (COMMISSION_WORDS.test(c)) return false; // "comissão" contém "iss"
  if (group(c, 2) === "03.02") return true;
  return TAX_WORDS.test(c);
}

/** Comissões sobre a venda. */
export function isCommissionCategory(category: string | null | undefined) {
  const c = normalize(category);
  return Boolean(c) && COMMISSION_WORDS.test(c);
}

/** Linha do DRE para uma receita. */
export function classifyRevenue(category: string | null | undefined): DreLine {
  const c = normalize(category);
  if (!c) return "grossRevenue";
  if (isPrincipalLoanCategory(c)) return "loanReceipts";
  const g1 = group(c, 1);
  const g2 = group(c, 2);
  const g3 = group(c, 3);

  // Other financial movements retain their existing classification.
  if (g1 === "02" || g2 === "01.03") return "financialIncome";
  if (g3 === "01.02.06" || FINANCIAL_INCOME_WORDS.test(c)) return "financialIncome";
  if (isTaxCategory(c)) return "taxes";
  return "grossRevenue";
}

/** Linha do DRE para uma despesa. */
export function classifyExpense(category: string | null | undefined): DreLine {
  const c = normalize(category);
  if (!c) return "operationalExpenses";
  if (isPrincipalLoanCategory(c)) return "debts";
  const g1 = group(c, 1);
  const g2 = group(c, 2);

  // Impostos sobre venda
  if (g2 === "03.02" || (TAX_WORDS.test(c) && !COMMISSION_WORDS.test(c))) return "taxes";

  // Comissões sobre venda
  if (COMMISSION_WORDS.test(c)) return "commissions";

  // Custos diretos dos serviços prestados
  if (g2 === "03.01") return "operationalCosts";

  // Financeiro: tarifas bancárias (03.09), empréstimos (05.*)
  if (g2 === "03.09" || g1 === "05" || FINANCIAL_EXPENSE_WORDS.test(c)) return "financialExpense";

  // Comercial / marketing (03.05)
  if (g2 === "03.05" || COMMERCIAL_WORDS.test(c)) return "commercialExpenses";

  // Administrativas: pessoal (03.03), treinamentos (03.04), contábil (03.06), sócios (06.*)
  if (g2 === "03.03" || g2 === "03.04" || g2 === "03.06" || g1 === "06") return "adminExpenses";
  if (ADMIN_WORDS.test(c)) return "adminExpenses";

  // Estrutura e serviços (03.07, 03.08) e investimentos (04.*)
  if (g2 === "03.07" || g2 === "03.08" || g1 === "04") return "operationalExpenses";

  if (OPERATIONAL_COST_WORDS.test(c)) return "operationalCosts";

  return "operationalExpenses";
}

/** Linha do DRE para qualquer lançamento. */
export function classifyTransaction(
  type: "revenue" | "expense",
  category: string | null | undefined,
): DreLine {
  return type === "revenue" ? classifyRevenue(category) : classifyExpense(category);
}

/** Custos operacionais (compatibilidade). */
export function isOperationalCostCategory(category: string | null | undefined) {
  return classifyExpense(category) === "operationalCosts";
}
