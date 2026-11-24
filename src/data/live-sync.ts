import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getW2TestData, getContaAzulW2Data, getContaAzulReadState } from "@/lib/conta-azul.functions";
import { contaAzulMoney, contaAzulDate, contaAzulOperationCategories, SOMUS_CONTA_AZUL_FIRST_DUE_DATE, type ContaAzulMetadata } from "@/lib/conta-azul-model";
import { openingBalanceRows, approvedOpeningBalanceRows, OPENING_BALANCE_PREFIX, APPROVED_OPENING_PREFIX } from "@/lib/conta-azul-opening-balances";
import type { CompanyId } from "@/data/mock";
import { parseLocalDate } from "@/lib/date";
import { classifyExpense, classifyRevenue } from "@/lib/dre-classify";

import {
  KPI_BY_YEAR,
  TRANSACTIONS_BY_YEAR,
  ALERTS,
  TARGETS_2025,
  COST_CENTERS,
  EXPENSE_CATEGORIES,
  SERVICE_TYPES,
  type MonthlyKpi,
  type Transaction,
} from "@/data/mock";
import { MONTHS_PT } from "@/lib/format";
import { fetchAllRows } from "./fetch-paged";
import { readSnapshot, writeSnapshot, deleteSnapshot } from "./snapshot-cache";
import { snapshotSignature } from "./snapshot-signature";
import { getPlatformAccess } from "@/lib/platform-access.functions";
import type { PlatformAccess } from "@/lib/platform-access";
import { unpackFinancialRead } from "@/lib/financial-read-transport";
import { getManualCompanyData } from "@/lib/manual-finance.functions";
import { MANUAL_COMPANY_ID } from "@/lib/manual-company";

type ReceitaRow = {
  id: string;
  descricao: string | null;
  status: string | null;
  total: number | string | null;
  valor?: number | string | null;
  pago: number | string | null;
  data_pagamento?: string | null;
  nao_pago: number | string | null;
  data_vencimento: string | null;
  data_competencia: string | null;
  cliente_nome: string | null;
  cliente?: string | null;
  categoria_nome: string | null;
  categoria?: string | null;
  centro_de_custo_nome: string | null;
  centro_custo?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type DespesaRow = {
  id: string;
  descricao: string | null;
  status: string | null;
  total: number | string | null;
  valor?: number | string | null;
  pago: number | string | null;
  data_pagamento?: string | null;
  nao_pago: number | string | null;
  data_vencimento: string | null;
  data_competencia: string | null;
  fornecedor_nome: string | null;
  fornecedor?: string | null;
  categoria_nome: string | null;
  categoria?: string | null;
  centro_de_custo_nome: string | null;
  centro_custo?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type VendaRow = {
  id: string;
  numero?: string | null;
  cliente?: string | null;
  cliente_nome?: string | null;
  descricao?: string | null;
  valor?: number | string | null;
  total?: number | string | null;
  data?: string | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  data_competencia?: string | null;
  status?: string | null;
  categoria?: string | null;
  categoria_nome?: string | null;
  centro_custo?: string | null;
  centro_de_custo_nome?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type ContratoRow = {
  id: string;
  numero?: string | null;
  descricao?: string | null;
  cliente_id?: string | null;
  cliente_nome?: string | null;
  valor?: number | string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  status?: string | null;
  categoria_nome?: string | null;
  categoria_id?: string | null;
  centro_custo_nome?: string | null;
  centro_custo_id?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type BemRow = {
  id: string;
  nome?: string | null;
  descricao?: string | null;
  valor_aquisicao?: number | string | null;
  data_aquisicao?: string | null;
  status?: string | null;
  categoria_nome?: string | null;
  categoria_id?: string | null;
  centro_custo_nome?: string | null;
  centro_custo_id?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type FinancialTransactionRow = {
  metadata?: ContaAzulMetadata;
  id: string;
  external_id?: string | null;
  transaction_type?: string | null;
  description?: string | null;
  customer_or_supplier_name?: string | null;
  category_name?: string | null;
  cost_center_name?: string | null;
  amount?: number | string | null;
  due_date?: string | null;
  payment_date?: string | null;
  competence_date?: string | null;
  status?: string | null;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
};

type KpiSnapshotRow = {
  id: string;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
  year: number;
  month: number;
  gross_revenue?: number | string | null;
  net_revenue?: number | string | null;
  operational_costs?: number | string | null;
  operational_expenses?: number | string | null;
  ebitda?: number | string | null;
  net_profit?: number | string | null;
  net_margin?: number | string | null;
  cash_balance?: number | string | null;
  accounts_receivable?: number | string | null;
  accounts_payable?: number | string | null;
};

type BudgetTargetRow = {
  id: string;
  company_id?: string | null;
  empresa?: string | null;
  empresa_nome?: string | null;
  company?: string | null;
  year: number;
  month: number;
  category_name?: string | null;
  cost_center_name?: string | null;
  planned_revenue?: number | string | null;
  planned_expense?: number | string | null;
  planned_profit?: number | string | null;
};

type CompanyRow = {
  id: string;
  name?: string | null;
  nome?: string | null;
  slug?: string | null;
};

type CatalogRow = {
  id: string;
  name?: string | null;
  nome?: string | null;
  tipo?: string | null;
};

type SourceSnapshot = {
  operationCategories?: ContaAzulMetadata["operationCategories"];
  financialAccounts?: { id: string; nome: string; ativo?: boolean; currentBalance?: { saldo_atual?: number } }[];
  companies: CompanyRow[];
  categorias: CatalogRow[];
  centros_de_custo: CatalogRow[];
  pessoas: CatalogRow[];
  financial_transactions: FinancialTransactionRow[];
  receitas: ReceitaRow[];
  despesas: DespesaRow[];
  vendas: VendaRow[];
  contratos: ContratoRow[];
  bem: BemRow[];
  kpi_snapshots: KpiSnapshotRow[];
  budget_targets: BudgetTargetRow[];
};

type CompanyLookup = Map<string, CompanyId>;
export const W2_FINANCIAL_ACCOUNTS: NonNullable<SourceSnapshot["financialAccounts"]> = [];
export const FINANCIAL_ACCOUNTS_BY_COMPANY = {
  w2: W2_FINANCIAL_ACCOUNTS,
  d61: [] as NonNullable<SourceSnapshot["financialAccounts"]>,
  somus: [] as NonNullable<SourceSnapshot["financialAccounts"]>,
  lie: [] as NonNullable<SourceSnapshot["financialAccounts"]>,
  "lie-design": [] as NonNullable<SourceSnapshot["financialAccounts"]>,
  "manual-test": [] as NonNullable<SourceSnapshot["financialAccounts"]>,
};
type ReferenceLookup = {
  categorias: Map<string, string>;
  centros_de_custo: Map<string, string>;
  pessoas: Map<string, string>;
};

function emptyMonth(year: number, monthIndex: number): MonthlyKpi {
  return {
    year,
    monthIndex,
    monthLabel: MONTHS_PT[monthIndex],
    grossRevenue: 0, taxes: 0, commissions: 0, netRevenue: 0,
    operationalCosts: 0, commercialExpenses: 0, adminExpenses: 0, operationalExpenses: 0,
    financialIncome: 0, financialExpense: 0, grossProfit: 0, ebitda: 0,
    netProfit: 0, netMargin: 0, cashIn: 0, cashOut: 0, cashBalance: 0,
    accountsReceivable: 0, accountsPayable: 0,
  };
}

const STATUS_MAP: Record<string, Transaction["status"]> = {
  ACQUITTED: "Pago",
  PAID: "Pago",
  PAGO: "Pago",
  RECEBIDO: "Pago",
  SETTLED: "Pago",
  LIQUIDADO: "Pago",
  PERDIDO: "Pendente",
  LOST: "Pendente",
  CANCELED: "Pendente",
  CANCELLED: "Pendente",
  CANCELADO: "Pendente",
  PENDING: "Pendente",
  PENDENTE: "Pendente",
  OVERDUE: "Atrasado",
  VENCIDO: "Atrasado",
  ATRASADO: "Atrasado",
};

function asNumber(value: number | string | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  return contaAzulMoney(value) ?? 0;
}

function normalizeStatus(value: string | null | undefined): Transaction["status"] {
  return STATUS_MAP[(value ?? "").toUpperCase()] ?? "Pendente";
}

function ensureYear(year: number) {
  if (!KPI_BY_YEAR[year]) KPI_BY_YEAR[year] = Array.from({ length: 12 }, (_, i) => emptyMonth(year, i));
  if (!TRANSACTIONS_BY_YEAR[year]) TRANSACTIONS_BY_YEAR[year] = [];
}

function pushUnique(list: string[], value: string | null | undefined) {
  const label = value?.trim();
  if (label && !list.includes(label)) list.push(label);
}

async function fetchOptional<T>(client: SupabaseClient, company: CompanyId, table: string) {
  let clientCache = sourceFetchCache.get(client as object);
  if (!clientCache) {
    clientCache = new Map();
    sourceFetchCache.set(client as object, clientCache);
  }
  const cached = clientCache.get(table);
  if (cached) return (await cached) as T[];

  const request = fetchAllRows<T>(client, table).catch((err) => {
    // Only absent optional tables may be skipped. Auth/network errors must
    // preserve the last successful data, not replace it with empty arrays.
    if (["companies", "financial_transactions"].includes(table) || !["42P01", "PGRST205"].includes(err?.code)) throw err;
    console.warn(`[live-sync:${company}] ${table} skipped`, err);
    return [] as T[];
  });
  clientCache.set(table, request as Promise<unknown[]>);
  return await request;
}

function companyFromLabel(value: string | null | undefined): CompanyId | null {
  const normalized = (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!normalized) return null;
  if (normalized.trim() === "manual-test" || normalized.trim() === "empresa teste") return "manual-test";
  if (normalized.trim() === "lie" || normalized.trim() === "lie arquitetura") return "lie";
  if (normalized.trim() === "lie-design" || normalized.trim() === "lie design") return "lie-design";
  if (normalized.includes("d61") || normalized.includes("d 61")) return "d61";
  if (normalized.includes("w2") || normalized.includes("w 2")) return "w2";
  if (normalized.includes("somus")) return "somus";
  return null;
}

function buildCompanyLookup(companies: CompanyRow[]) {
  const lookup: CompanyLookup = new Map();

  for (const company of companies) {
    const id = companyFromLabel(company.slug) ?? companyFromLabel(company.name) ?? companyFromLabel(company.nome);
    if (id) lookup.set(company.id, id);
  }

  return lookup;
}

function buildNameLookup(rows: CatalogRow[]) {
  const lookup = new Map<string, string>();
  for (const row of rows) {
    const label = row.nome ?? row.name;
    if (label) lookup.set(row.id, label);
  }
  return lookup;
}

function buildReferenceLookup(snapshot: Pick<SourceSnapshot, "categorias" | "centros_de_custo" | "pessoas">): ReferenceLookup {
  return {
    categorias: buildNameLookup(snapshot.categorias),
    centros_de_custo: buildNameLookup(snapshot.centros_de_custo),
    pessoas: buildNameLookup(snapshot.pessoas),
  };
}

function resolveCompany(
  fallback: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  row: {
    company_id?: string | null;
    empresa?: string | null;
    empresa_nome?: string | null;
    company?: string | null;
  },
): Exclude<CompanyId, "all"> {
  const direct =
    companyFromLabel(row.company) ??
    companyFromLabel(row.empresa) ??
    companyFromLabel(row.empresa_nome) ??
    companyFromLabel(row.company_id);

  if (direct && direct !== "all") return direct;
  const fromLookup = row.company_id ? lookup.get(row.company_id) : null;
  return fromLookup && fromLookup !== "all" ? fromLookup : fallback;
}

function transactionTypeFromValue(value: string | null | undefined): Transaction["type"] {
  const normalized = (value ?? "").toLowerCase();
  if (
    normalized.includes("expense") ||
    normalized.includes("despesa") ||
    normalized.includes("saida") ||
    normalized.includes("saída") ||
    normalized.includes("payable") ||
    normalized.includes("financial_expense")
  ) {
    return "expense";
  }
  return "revenue";
}

const SOURCES: { company: Exclude<CompanyId, "all">; client: SupabaseClient }[] = [
  { company: "somus", client: supabase },
  // Keep the normal W2 view backed by its existing Supabase records.
  { company: "w2", client: supabase },
  { company: "lie", client: supabase },
  { company: "lie-design", client: supabase },
  { company: "d61", client: supabase },
];
const LIVE_SYNC_TABLES = [
  "companies",
  "financial_transactions",
  "receitas",
  "despesas",
  "vendas",
  "contratos",
  "bem",
  "categorias",
  "centros_de_custo",
  "pessoas",
  "kpi_snapshots",
  "budget_targets",
];
let currentLoadTransactionKeys = new Set<string>();
const sourceFetchCache = new WeakMap<object, Map<string, Promise<unknown[]>>>();

function transactionDedupeKey(company: CompanyId, table: string, row: { id?: string | null; external_id?: string | null }) {
  return `${company}:${row.external_id || `${table}:${row.id}` || table}`;
}

function reserveTransaction(dedupeKey: string) {
  if (currentLoadTransactionKeys.has(dedupeKey)) return false;
  currentLoadTransactionKeys.add(dedupeKey);
  return true;
}

function ingestReceitas(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  receitas: ReceitaRow[],
  tableName = "receitas",
) {
  for (const row of receitas) {
    const company = resolveCompany(fallbackCompany, lookup, row);
    const dateStr = row.data_vencimento ?? row.data_competencia ?? row.data_pagamento;
    if (!dateStr) continue;
    const dt = parseLocalDate(dateStr);
    if (!dt) continue;
    const dedupeKey = transactionDedupeKey(company, tableName, row);
    if (!reserveTransaction(dedupeKey)) continue;
    const year = dt.getFullYear();
    ensureYear(year);
    const month = KPI_BY_YEAR[year][dt.getMonth()];
    const total = asNumber(row.total ?? row.valor);
    const paid = asNumber(row.pago);
    const status = normalizeStatus(row.status);
    const open = asNumber(row.nao_pago) || (status === "Pago" ? 0 : total);

    const category = row.categoria_nome ?? row.categoria ?? "Sem categoria";
    const line = classifyRevenue(category);
    if (line === "financialIncome") month.financialIncome += total;
    else if (line === "taxes") month.taxes += total;
    else if (line === "commissions") month.commissions += total;
    else month.grossRevenue += total;

    month.cashIn += paid || total;
    month.accountsReceivable += open;



    const transaction: Transaction = {
      id: `${company}:${row.id}`,
      date: dateStr,
      competencyDate: row.data_competencia || dateStr,
      paymentDate: row.data_pagamento || row.data_vencimento || dateStr,
      type: "revenue",
      party: row.cliente_nome ?? row.cliente ?? "—",
      category,
      costCenter: row.centro_de_custo_nome ?? row.centro_custo ?? "Não alocado",
      amount: total,
      status,
      company,
    };
    TRANSACTIONS_BY_YEAR[year].push(transaction);
    pushUnique(SERVICE_TYPES as unknown as string[], row.categoria_nome);
    pushUnique(SERVICE_TYPES as unknown as string[], row.categoria);
    pushUnique(COST_CENTERS, row.centro_de_custo_nome ?? row.centro_custo);
  }
}

function ingestDespesas(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  despesas: DespesaRow[],
  tableName = "despesas",
) {
  for (const row of despesas) {
    const company = resolveCompany(fallbackCompany, lookup, row);
    const dateStr = row.data_vencimento ?? row.data_competencia ?? row.data_pagamento;
    if (!dateStr) continue;
    const dt = parseLocalDate(dateStr);
    if (!dt) continue;
    const dedupeKey = transactionDedupeKey(company, tableName, row);
    if (!reserveTransaction(dedupeKey)) continue;
    const year = dt.getFullYear();
    ensureYear(year);
    const month = KPI_BY_YEAR[year][dt.getMonth()];
    const total = asNumber(row.total ?? row.valor);
    const paid = asNumber(row.pago);
    const status = normalizeStatus(row.status);
    const open = asNumber(row.nao_pago) || (status === "Pago" ? 0 : total);

    const category = row.categoria_nome ?? row.categoria ?? "Sem categoria";
    const line = classifyExpense(category);
    if (line === "taxes") month.taxes += total;
    else if (line === "commissions") month.commissions += total;
    else if (line === "operationalCosts") month.operationalCosts += total;
    else if (line === "commercialExpenses") month.commercialExpenses += total;
    else if (line === "adminExpenses") month.adminExpenses += total;
    else if (line === "financialExpense") month.financialExpense += total;
    else month.operationalExpenses += total;



    month.cashOut += paid || total;
    month.accountsPayable += open;
    const transaction: Transaction = {
      id: `${company}:${row.id}`,
      date: dateStr,
      competencyDate: row.data_competencia || dateStr,
      paymentDate: row.data_pagamento || row.data_vencimento || dateStr,
      type: "expense",
      party: row.fornecedor_nome ?? row.fornecedor ?? "—",
      category,
      costCenter: row.centro_de_custo_nome ?? row.centro_custo ?? "Não alocado",
      amount: total,
      status,
      company,
    };
    TRANSACTIONS_BY_YEAR[year].push(transaction);
    pushUnique(EXPENSE_CATEGORIES as unknown as string[], row.categoria_nome);
    pushUnique(EXPENSE_CATEGORIES as unknown as string[], row.categoria);
    pushUnique(COST_CENTERS, row.centro_de_custo_nome ?? row.centro_custo);
  }
}

function ingestFinancialTransactions(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  rows: FinancialTransactionRow[],
  operationCategories?: ContaAzulMetadata["operationCategories"],
) {
  for (const row of rows) {
    if (row.metadata?.active === false) continue;
    const company = resolveCompany(fallbackCompany, lookup, row);
    if (company === "somus") {
      const due = contaAzulDate(row.metadata?.origin === "initial_balance" ? row.competence_date : row.due_date);
      if (!due || due < SOMUS_CONTA_AZUL_FIRST_DUE_DATE) continue;
    }
    const dateStr = row.competence_date ?? row.due_date ?? row.payment_date;
    if (!dateStr) continue;
    const dt = parseLocalDate(dateStr);
    if (!dt) continue;
    const dedupeKey = transactionDedupeKey(company, "financial_transactions", row);
    if (!reserveTransaction(dedupeKey)) continue;

    const year = dt.getFullYear();
    ensureYear(year);
    const month = KPI_BY_YEAR[year][dt.getMonth()];
    const amount = Math.abs(asNumber(row.amount));
    const type = transactionTypeFromValue(row.transaction_type);
    const category = row.category_name ?? (type === "revenue" ? "Receita" : "Despesa");
    const status = normalizeStatus(row.status);

    if (type === "revenue") {
      const line = classifyRevenue(category);
      if (line === "financialIncome") month.financialIncome += amount;
      else if (line === "taxes") month.taxes += amount;
      else if (line === "commissions") month.commissions += amount;
      else month.grossRevenue += amount;
      if (status === "Pago") month.cashIn += amount;
      else month.accountsReceivable += amount;
      pushUnique(SERVICE_TYPES as unknown as string[], category);
    } else {
      const line = classifyExpense(category);
      if (line === "taxes") month.taxes += amount;
      else if (line === "commissions") month.commissions += amount;
      else if (line === "operationalCosts") month.operationalCosts += amount;
      else if (line === "commercialExpenses") month.commercialExpenses += amount;
      else if (line === "adminExpenses") month.adminExpenses += amount;
      else if (line === "financialExpense") month.financialExpense += amount;
      else month.operationalExpenses += amount;
      if (status === "Pago") month.cashOut += amount;
      else month.accountsPayable += amount;
      pushUnique(EXPENSE_CATEGORIES as unknown as string[], category);
    }

    TRANSACTIONS_BY_YEAR[year].push({
      id: `${company}:${row.id}`,
      date: dateStr,
      competencyDate: row.competence_date || dateStr,
      paymentDate: row.payment_date || (row.metadata ? undefined : row.due_date || dateStr),
      dueDate: row.due_date || undefined,
      description: row.description || "Descricao nao informada no Conta Azul",
      source: row.metadata ? { ...row.metadata, operationCategories } : undefined,
      type,
      party: row.customer_or_supplier_name || "Nao informado na origem",
      category,
      costCenter: row.cost_center_name ?? "Não alocado",
      amount,
      status,
      company,
    });
    pushUnique(COST_CENTERS, row.cost_center_name);
  }
}

function ingestVendas(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  vendas: VendaRow[],
) {
  const receitas: ReceitaRow[] = vendas.map((row) => ({
    id: row.id,
    descricao: row.descricao ?? row.numero ?? null,
    status: row.status ?? null,
    total: row.total ?? row.valor ?? null,
    valor: row.valor ?? row.total ?? null,
    pago: normalizeStatus(row.status) === "Pago" ? (row.valor ?? row.total ?? null) : null,
    nao_pago: normalizeStatus(row.status) === "Pago" ? 0 : (row.valor ?? row.total ?? null),
    data_vencimento: row.data_vencimento ?? row.data ?? null,
    data_competencia: row.data_competencia ?? row.data ?? null,
    data_pagamento: row.data_pagamento ?? null,
    cliente_nome: row.cliente_nome ?? row.cliente ?? null,
    cliente: row.cliente ?? row.cliente_nome ?? null,
    categoria_nome: row.categoria_nome ?? row.categoria ?? "Vendas",
    categoria: row.categoria ?? row.categoria_nome ?? "Vendas",
    centro_de_custo_nome: row.centro_de_custo_nome ?? row.centro_custo ?? null,
    centro_custo: row.centro_custo ?? row.centro_de_custo_nome ?? null,
    company_id: row.company_id ?? null,
    empresa: row.empresa ?? null,
    empresa_nome: row.empresa_nome ?? null,
    company: row.company ?? null,
  }));
  ingestReceitas(fallbackCompany, lookup, receitas, "vendas");
}

function ingestContratos(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  references: ReferenceLookup,
  contratos: ContratoRow[],
) {
  const receitas: ReceitaRow[] = contratos.map((row) => ({
    id: row.id,
    descricao: row.descricao ?? row.numero ?? null,
    status: row.status ?? "Pendente",
    total: row.valor ?? null,
    valor: row.valor ?? null,
    pago: normalizeStatus(row.status) === "Pago" ? (row.valor ?? null) : null,
    nao_pago: normalizeStatus(row.status) === "Pago" ? 0 : (row.valor ?? null),
    data_vencimento: row.data_inicio ?? row.data_fim ?? null,
    data_competencia: row.data_inicio ?? row.data_fim ?? null,
    data_pagamento: null,
    cliente_nome: row.cliente_nome ?? (row.cliente_id ? references.pessoas.get(row.cliente_id) : null) ?? null,
    categoria_nome: row.categoria_nome ?? (row.categoria_id ? references.categorias.get(row.categoria_id) : null) ?? "Contratos",
    categoria: row.categoria_nome ?? (row.categoria_id ? references.categorias.get(row.categoria_id) : null) ?? "Contratos",
    centro_de_custo_nome: row.centro_custo_nome ?? (row.centro_custo_id ? references.centros_de_custo.get(row.centro_custo_id) : null) ?? null,
    centro_custo: row.centro_custo_nome ?? (row.centro_custo_id ? references.centros_de_custo.get(row.centro_custo_id) : null) ?? null,
    company_id: row.company_id ?? null,
    empresa: row.empresa ?? null,
    empresa_nome: row.empresa_nome ?? null,
    company: row.company ?? null,
  }));
  ingestReceitas(fallbackCompany, lookup, receitas, "contratos");
}

function ingestBens(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  references: ReferenceLookup,
  bens: BemRow[],
) {
  const despesas: DespesaRow[] = bens.map((row) => ({
    id: row.id,
    descricao: row.descricao ?? row.nome ?? null,
    status: row.status ?? "Pago",
    total: row.valor_aquisicao ?? null,
    valor: row.valor_aquisicao ?? null,
    pago: row.valor_aquisicao ?? null,
    nao_pago: 0,
    data_vencimento: row.data_aquisicao ?? null,
    data_competencia: row.data_aquisicao ?? null,
    data_pagamento: row.data_aquisicao ?? null,
    fornecedor_nome: "Patrimônio",
    categoria_nome: row.categoria_nome ?? (row.categoria_id ? references.categorias.get(row.categoria_id) : null) ?? "Bens e patrimônio",
    categoria: row.categoria_nome ?? (row.categoria_id ? references.categorias.get(row.categoria_id) : null) ?? "Bens e patrimônio",
    centro_de_custo_nome: row.centro_custo_nome ?? (row.centro_custo_id ? references.centros_de_custo.get(row.centro_custo_id) : null) ?? null,
    centro_custo: row.centro_custo_nome ?? (row.centro_custo_id ? references.centros_de_custo.get(row.centro_custo_id) : null) ?? null,
    company_id: row.company_id ?? null,
    empresa: row.empresa ?? null,
    empresa_nome: row.empresa_nome ?? null,
    company: row.company ?? null,
  }));
  ingestDespesas(fallbackCompany, lookup, despesas, "bem");
}

function ingestKpiSnapshots(
  fallbackCompany: Exclude<CompanyId, "all">,
  lookup: CompanyLookup,
  rows: KpiSnapshotRow[],
) {
  for (const row of rows) {
    const company = resolveCompany(fallbackCompany, lookup, row);
    const monthIndex = row.month - 1;
    if (!Number.isFinite(row.year) || monthIndex < 0 || monthIndex > 11) continue;
    ensureYear(row.year);
    const month = KPI_BY_YEAR[row.year][monthIndex];
    month.grossRevenue += asNumber(row.gross_revenue);
    month.operationalCosts += asNumber(row.operational_costs);
    month.operationalExpenses += asNumber(row.operational_expenses);
    month.cashBalance += asNumber(row.cash_balance);
    month.accountsReceivable += asNumber(row.accounts_receivable);
    month.accountsPayable += asNumber(row.accounts_payable);
  }
}

function ingestBudgetTargets(rows: BudgetTargetRow[]) {
  for (const row of rows) {
    if (row.year !== 2025) continue;
    const planned = asNumber(row.planned_revenue) || asNumber(row.planned_expense) || asNumber(row.planned_profit);
    if (!planned) continue;
    TARGETS_2025.push({
      category: row.category_name ?? "Sem categoria",
      planned,
      realized: 0,
    });
    pushUnique(COST_CENTERS, row.cost_center_name);
  }
}

function ingestSource(
  fallbackCompany: Exclude<CompanyId, "all">,
  snapshot: SourceSnapshot,
) {
  const lookup = buildCompanyLookup(snapshot.companies);
  const references = buildReferenceLookup(snapshot);
  ingestFinancialTransactions(fallbackCompany, lookup, snapshot.financial_transactions, snapshot.operationCategories);
  ingestReceitas(fallbackCompany, lookup, snapshot.receitas);
  ingestDespesas(fallbackCompany, lookup, snapshot.despesas);
  ingestVendas(fallbackCompany, lookup, snapshot.vendas);
  ingestContratos(fallbackCompany, lookup, references, snapshot.contratos);
  ingestBens(fallbackCompany, lookup, references, snapshot.bem);
  ingestKpiSnapshots(fallbackCompany, lookup, snapshot.kpi_snapshots);
  ingestBudgetTargets(snapshot.budget_targets);
}

async function loadSource(company: Exclude<CompanyId, "all">, client: SupabaseClient, savedFinancial?: FinancialTransactionRow[]) {
  const [
    companies,
    categorias,
    centrosDeCusto,
    pessoas,
    financialTransactions,
    receitas,
    despesas,
    vendas,
    contratos,
    bem,
    kpiSnapshots,
    budgetTargets,
  ] = await Promise.all([
    fetchOptional<CompanyRow>(client, company, "companies"),
    fetchOptional<CatalogRow>(client, company, "categorias"),
    fetchOptional<CatalogRow>(client, company, "centros_de_custo"),
    fetchOptional<CatalogRow>(client, company, "pessoas"),
    savedFinancial ?? fetchOptional<FinancialTransactionRow>(client, company, "financial_transactions"),
    fetchOptional<ReceitaRow>(client, company, "receitas"),
    fetchOptional<DespesaRow>(client, company, "despesas"),
    fetchOptional<VendaRow>(client, company, "vendas"),
    fetchOptional<ContratoRow>(client, company, "contratos"),
    fetchOptional<BemRow>(client, company, "bem"),
    fetchOptional<KpiSnapshotRow>(client, company, "kpi_snapshots"),
    fetchOptional<BudgetTargetRow>(client, company, "budget_targets"),
  ]);

  const companyIds = new Set(
    companies
      .filter((row) => companyFromLabel(row.slug) === company || companyFromLabel(row.name) === company || companyFromLabel(row.nome) === company)
      .map((row) => row.id),
  );
  const belongsToSource = (row: { company_id?: string | null; empresa?: string | null; empresa_nome?: string | null; company?: string | null }) => {
    const explicit = companyFromLabel(row.company) ?? companyFromLabel(row.empresa) ?? companyFromLabel(row.empresa_nome);
    if (explicit) return explicit === company;
    if (row.company_id) return companyIds.has(row.company_id);
    // Keep unlabeled legacy rows only in the general SOMUS source. W2 must be
    // strictly company-scoped so old imports cannot leak into the real account.
    return company === "somus";
  };
  const onlyCompany = <T extends { company_id?: string | null; empresa?: string | null; empresa_nome?: string | null; company?: string | null }>(rows: T[]) => rows.filter(belongsToSource);

  const scopedCounts = {
    financial_transactions: onlyCompany(financialTransactions).length,
    receitas: onlyCompany(receitas).length,
    despesas: onlyCompany(despesas).length,
    vendas: onlyCompany(vendas).length,
    contratos: onlyCompany(contratos).length,
    bem: onlyCompany(bem).length,
  };
  const scopedFinancial = onlyCompany(financialTransactions);
  const financialStats = {
    count: scopedFinancial.length,
    nonZero: scopedFinancial.filter((row) => asNumber(row.amount) !== 0).length,
    sum: scopedFinancial.reduce((total, row) => total + Math.abs(asNumber(row.amount)), 0),
    minDate: scopedFinancial.map((row) => row.competence_date ?? row.due_date ?? row.payment_date).filter(Boolean).sort()[0] ?? null,
    maxDate: scopedFinancial.map((row) => row.competence_date ?? row.due_date ?? row.payment_date).filter(Boolean).sort().at(-1) ?? null,
  };
  console.info(`[live-sync:${company}] company_ids=${companyIds.size} ${JSON.stringify({ ...scopedCounts, financialStats })}`);

  return { company, snapshot: {
    companies,
    categorias,
    centros_de_custo: centrosDeCusto,
    pessoas,
    financial_transactions: onlyCompany(financialTransactions),
    receitas: onlyCompany(receitas),
    despesas: onlyCompany(despesas),
    vendas: onlyCompany(vendas),
    contratos: onlyCompany(contratos),
    bem: onlyCompany(bem),
    kpi_snapshots: onlyCompany(kpiSnapshots),
    budget_targets: onlyCompany(budgetTargets),
  } };
}


type LoadedSource = { company: Exclude<CompanyId, "all">; snapshot: SourceSnapshot; readRevision?: string; openingRevision?: string; confirmedAt?: string; savedView?: boolean; dreReadProjection?: number; provider?: "conta-azul" };
const DRE_READ_PROJECTION = 4;
type CachedData = { schema: 2; savedAt: number; sources: LoadedSource[]; accessKey?: string };
const isConfirmedSource = (source: LoadedSource) => typeof source.confirmedAt === "string" && Number.isFinite(Date.parse(source.confirmedAt))
  && (source.company !== "d61" || source.provider === "conta-azul");
const hasReportingCatalog = (source: LoadedSource) => !source.snapshot?.financial_transactions?.some(row => row.metadata?.reporting)
  || !!source.snapshot.operationCategories;
let lastSources: LoadedSource[] = [];
let lastSignature = "";
let cacheUserId: string | null = null;
let sessionEpoch = 0;
let allowedCompanies: Exclude<CompanyId, "all">[] = ["w2", "somus", "d61", "lie", "lie-design"];
let accessKey = "";
let initialAccess: { value: PlatformAccess; expiresAt: number } | null = null;

function configureAccess(access: PlatformAccess, invalidate = true) {
  const key = JSON.stringify([access.isAdmin, access.companies.map(c => c.id).sort(), access.securityReady]);
  if (key === accessKey) return;
  accessKey = key;
  allowedCompanies = access.securityReady || access.isAdmin ? [...new Set(access.companies.map(c => c.key))] : [];
  // A role/company change invalidates old snapshots, including reference catalogs.
  lastSources = [];
  lastSignature = "";
  loaded = false;
  applySources([]);
  if (invalidate && cacheUserId) void deleteSnapshot(cacheUserId);
}

async function loadContaAzulData(epoch: number) {
  const access = initialAccess && initialAccess.expiresAt > Date.now() ? initialAccess.value : await getPlatformAccess();
  initialAccess = null;
  if (epoch !== sessionEpoch) return false;
  configureAccess(access);
  if (!allowedCompanies.length) throw new Error("Seu acesso aguarda liberacao de uma empresa pelo administrador.");
  const starting = !loaded;
  const baseline = lastSources.filter(isConfirmedSource);
  const sources = [...baseline];
  const pending = new Set<Exclude<CompanyId, "all">>();
  const remaining = new Set(allowedCompanies);
  let published = false;
  sourceFetchCache.delete(supabase as object);
  // Overlap first-load reference catalogs with the server reading, sharing each table once.
  if (starting) for (const source of SOURCES.filter(source => allowedCompanies.includes(source.company))) {
    for (const table of LIVE_SYNC_TABLES.filter(table => table !== "financial_transactions")) {
      void fetchOptional(source.client, source.company, table).catch(() => {});
    }
  }
  const updatePending = () => setLiveSyncState({ pendingCompanies: Object.fromEntries(
    [...new Set([...remaining, ...pending])].map(company => [company, true])) });
  const replace = (company: Exclude<CompanyId, "all">, source: LoadedSource | undefined | null) => {
    const index = sources.findIndex(entry => entry.company === company);
    if (source && index >= 0) sources[index] = source;
    else if (source) sources.push(source);
    else if (index >= 0) sources.splice(index, 1);
  };
  const publish = () => {
    const latestManual = lastSources.find(source => source.company === "manual-test");
    const pendingManual = sources.find(source => source.company === "manual-test");
    if (latestManual && Number(latestManual.readRevision) > Number(pendingManual?.readRevision ?? -1)) replace("manual-test", latestManual);
    sources.sort((a, b) => allowedCompanies.indexOf(a.company) - allowedCompanies.indexOf(b.company));
    const signature = snapshotSignature(sources);
    const changed = !loaded || signature !== lastSignature;
    if (changed) applySources(sources);
    lastSignature = signature;
    lastSources = [...sources];
    setLiveSyncState({ confirmedAtByCompany: Object.fromEntries(sources.filter(source => source.confirmedAt)
      .map(source => [source.company, Date.parse(source.confirmedAt!)])), savedViewCompanies: Object.fromEntries(sources.filter(source => source.savedView).map(source => [source.company, true])) });
    return changed;
  };
  updatePending();
  // Each company publishes only after its own complete, verified reading is ready.
  await Promise.all(allowedCompanies.map(async company => {
    const previous = baseline.find(entry => entry.company === company);
    try {
      if (company === "manual-test") {
        const result = await getManualCompanyData({ data: { companyId: MANUAL_COMPANY_ID } });
        if (epoch !== sessionEpoch) return;
        replace(company, { company, snapshot: result.snapshot, confirmedAt: result.confirmedAt, readRevision: String(result.revision) });
        setLiveSyncState({ sourceErrors: { ...liveSyncState.sourceErrors, [company]: undefined } });
        return;
      }
      const integration = await unpackFinancialRead(await getContaAzulW2Data({ data: { company,
        knownRevision: previous?.dreReadProjection === DRE_READ_PROJECTION ? previous.readRevision : undefined, knownOpeningRevision: previous?.openingRevision,
        preferSaved: !previous, compact: true, compression: typeof DecompressionStream === "function" ? "gzip" : undefined } }));
      if (epoch !== sessionEpoch) return;
      if ("importPending" in integration && integration.importPending ||
          (!("confirmedAt" in integration) || !integration.confirmedAt || !Number.isFinite(Date.parse(integration.confirmedAt)) ||
            "savedView" in integration && integration.savedView && !("fullyReconciled" in integration && integration.fullyReconciled))) {
        pending.add(company);
        setLiveSyncState({ sourceErrors: { ...liveSyncState.sourceErrors, [company]: undefined } });
        return;
      }
      setLiveSyncState({ sourceErrors: { ...liveSyncState.sourceErrors, [company]: undefined } });
      if ("unchanged" in integration && integration.unchanged) return;
      const connection = SOURCES.find(source => source.company === company);
      let source: LoadedSource | null = connection ? await loadSource(company, connection.client,
          "financialTransactions" in integration && Array.isArray(integration.financialTransactions) ? integration.financialTransactions : undefined) : null;
      if (epoch !== sessionEpoch) return;
      if (source) {
        source.confirmedAt = "confirmedAt" in integration ? integration.confirmedAt ?? undefined : undefined;
        source.dreReadProjection = DRE_READ_PROJECTION;
        if (company === "d61") source.provider = "conta-azul";
      }
      if (!integration.metadata.length && !integration.catalog) {
        replace(company, source);
        return;
      }
      if (source) {
        source = { ...source, snapshot: { ...source.snapshot } };
        const details = new Map(integration.metadata.map((row: any) => [row.external_id, row]));
        source.snapshot.operationCategories = contaAzulOperationCategories(integration.catalog?.categories ?? [], integration.catalog?.defaultCategories ?? []);
        source.snapshot.financialAccounts = integration.catalog?.accounts ?? [];
        source.snapshot.financial_transactions = source.snapshot.financial_transactions
          .filter(row => details.get(row.external_id)?.source !== "conta_azul_archived")
          .map(row => {
            const metadata = details.get(row.external_id)?.metadata ?? row.metadata;
            return { ...row, metadata, category_name: metadata?.allocations?.length
              ? [...new Set(metadata.allocations.map((allocation: any) => allocation.category))].join("; ") : row.category_name };
          });
        source.snapshot.financial_transactions = [
          ...source.snapshot.financial_transactions.filter(row => !row.external_id?.startsWith(OPENING_BALANCE_PREFIX) && !row.external_id?.startsWith(APPROVED_OPENING_PREFIX)),
          ...(company === "w2" || company === "lie" || company === "lie-design" || company === "d61" ? openingBalanceRows(integration.companyId!, company, integration.catalog) : []),
          ...approvedOpeningBalanceRows(integration.companyId!, company, integration.catalog?.approvedOpenings),
        ];
        source.openingRevision = "openingRevision" in integration ? integration.openingRevision : undefined;
        if ("readRevision" in integration && integration.readRevision) {
          if ("savedView" in integration && integration.savedView) {
            source.readRevision = integration.readRevision;
            source.confirmedAt = integration.confirmedAt ?? undefined;
            source.savedView = true;
          } else {
            const after = await getContaAzulReadState({ data: { company } });
            if (epoch !== sessionEpoch) return;
            if (after.status && !["completed", "running"].includes(after.status)) throw new Error("A leitura financeira foi interrompida. Os dados anteriores foram preservados.");
            if (after.status !== "completed" || after.revision !== integration.readRevision) { pending.add(company); return; }
            source.readRevision = integration.readRevision;
            source.confirmedAt = integration.confirmedAt ?? undefined;
          }
        }
      }
      replace(company, source);
    } catch (reason) {
      if (epoch !== sessionEpoch) return;
      const message = reason instanceof Error ? reason.message : "Importacao ainda nao conferida.";
      setLiveSyncState({ sourceErrors: { ...liveSyncState.sourceErrors, [company]: `${message} Os ultimos dados confirmados desta empresa, se existentes, foram preservados.` } });
      replace(company, previous);
    } finally {
      if (epoch === sessionEpoch) {
        remaining.delete(company);
        updatePending();
        if (starting && sources.length && publish()) {
          published = true;
          notifyDataChanged();
          if (remaining.size) setLiveSyncState({ status: "syncing", foreground: false });
        }
      }
    }
  }));
  if (epoch !== sessionEpoch) return false;
  if (!sources.length) {
    if (pending.size) return false;
    throw new Error("Nenhuma empresa possui uma leitura financeira confirmada disponivel.");
  }
  const changed = publish() || published;
  // Persist the completed batch once; cloning every partial multi-company
  // snapshot repeatedly blocks the main thread during first load.
  if (cacheUserId) void writeSnapshot(cacheUserId, { schema: 2, savedAt: Date.now(), sources: [...sources], accessKey });
  return changed;
}


function applySources(sources: LoadedSource[]) {
  // No awaits between clearing and rebuilding: filters always see a complete load.
  currentLoadTransactionKeys = new Set();
  ALERTS.length = 0;
  TARGETS_2025.length = 0;

  for (const year of Object.keys(KPI_BY_YEAR)) {
    const y = Number(year);
    const arr = KPI_BY_YEAR[y];
    for (let i = 0; i < arr.length; i++) arr[i] = emptyMonth(y, i);
  }
  for (const k of Object.keys(TRANSACTIONS_BY_YEAR)) TRANSACTIONS_BY_YEAR[Number(k)] = [];

  COST_CENTERS.length = 0;
  for (const company of ["w2", "d61", "somus", "lie", "lie-design", "manual-test"] as const) {
    const accounts = FINANCIAL_ACCOUNTS_BY_COMPANY[company];
    accounts.splice(0, accounts.length, ...(sources.find((source) => source.company === company)?.snapshot.financialAccounts ?? []));
  }
  (SERVICE_TYPES as unknown as string[]).length = 0;
  (EXPENSE_CATEGORIES as unknown as string[]).length = 0;
  for (const { company, snapshot } of sources) ingestSource(company, snapshot);

  for (const year of Object.keys(KPI_BY_YEAR).map(Number).sort()) {
    let balance = 0;
    for (const month of KPI_BY_YEAR[year]) {
      month.netRevenue = month.grossRevenue - month.taxes - month.commissions;
      month.grossProfit = month.netRevenue - month.operationalCosts;
      month.ebitda = month.grossProfit - month.commercialExpenses - month.adminExpenses - month.operationalExpenses;
      month.netProfit = month.ebitda + month.financialIncome - month.financialExpense;
      month.netMargin = month.netRevenue > 0 ? month.netProfit / month.netRevenue : 0;
      balance += month.cashIn - month.cashOut;
      month.cashBalance = balance;
    }
    TRANSACTIONS_BY_YEAR[year]?.sort((a, b) => b.date.localeCompare(a.date));
  }
}

async function loadW2Test() {
  try {
    const data = await getW2TestData();
    ingestSource("w2", {
      companies: [{ id: "w2-test", name: "W2 Test", slug: "w2" }],
      categorias: [], centros_de_custo: [], pessoas: [], receitas: [], despesas: [], vendas: [], contratos: [], bem: [], kpi_snapshots: [], budget_targets: [],
      financial_transactions: (data.financial_transactions ?? []).map((row: any) => ({
        ...row,
        id: row.id,
        company_id: "w2-test",
        transaction_type: row.transaction_type,
        external_id: row.external_id,
        amount: row.amount,
        competence_date: row.competence_date,
        due_date: row.due_date,
        payment_date: row.payment_date,
      })) as FinancialTransactionRow[],
    });
  } catch (err) {
    console.warn("[live-sync:w2-test] failed", err);
  }
}



let loadPromise: Promise<void> | null = null;
let loaded = false;
let openingReadStarted = false;
export const hasLiveData = () => loaded;
export const hasConfirmedCompanyData = (company: Exclude<CompanyId, "all">) => loaded && lastSources.some((source) => source.company === company && isConfirmedSource(source));
export function isCompanyDataAwaitingRead(company: Exclude<CompanyId, "all">) {
  if (liveSyncState.sourceErrors[company] && !liveSyncState.pendingCompanies[company]) return false;
  const hasRows = Object.values(TRANSACTIONS_BY_YEAR).some((rows) => rows.some((row) => row.company === company));
  const reading = liveSyncState.status === "loading" || liveSyncState.status === "syncing" ||
    (liveSyncState.status === "idle" && liveSyncState.lastCheckedAt === null);
  return Boolean(liveSyncState.pendingCompanies[company] && !hasConfirmedCompanyData(company))
    || reading && (!hasConfirmedCompanyData(company) || (!hasRows && liveSyncState.lastCheckedAt === null));
}

export async function restoreLiveData(userId: string, access?: PlatformAccess) {
  const expectedKey = access ? JSON.stringify([access.isAdmin, access.companies.map(c => c.id).sort(), access.securityReady]) : accessKey;
  if (cacheUserId === userId && loaded && accessKey === expectedKey) return;
  clearLiveData();
  cacheUserId = userId;
  if (access) configureAccess(access, false);
  if (access) initialAccess = { value: access, expiresAt: Date.now() + 10_000 };
  const epoch = sessionEpoch;
  const cached = await readSnapshot<CachedData>(userId);
  if (epoch !== sessionEpoch || !cached || cached.schema !== 2 || !Array.isArray(cached.sources)) return;
  if (access && ((!access.isAdmin && cached.accessKey !== accessKey) || (cached.accessKey && cached.accessKey !== accessKey))) return;
  // Older reporting caches lack the company catalog and can display incorrect DRE groups before refresh.
  cached.sources = cached.sources.filter(source => source && allowedCompanies.includes(source.company) && isConfirmedSource(source) && hasReportingCatalog(source));
  const valid = cached.sources.length > 0 && Number.isFinite(cached.savedAt) && cached.sources.every((source) =>
    source && ["w2", "d61", "somus", "lie", "lie-design", "manual-test"].includes(source.company) && source.snapshot &&
    LIVE_SYNC_TABLES.every((table) => Array.isArray(source.snapshot[table as keyof SourceSnapshot])));
  if (!valid) return;
  try {
    applySources(cached.sources);
    lastSources = cached.sources;
    lastSignature = snapshotSignature(cached.sources);
    loaded = true;
    setLiveSyncState({ status: "idle", foreground: false, lastUpdatedAt: cached.savedAt, lastCheckedAt: null, errorMessage: null,
      confirmedAtByCompany: Object.fromEntries(cached.sources.filter(source => source.confirmedAt).map(source => [source.company, Date.parse(source.confirmedAt!)])), savedViewCompanies: Object.fromEntries(cached.sources.filter(source => source.savedView).map(source => [source.company, true])) });
  } catch {
    applySources([]);
    void deleteSnapshot(userId);
  }
}

export function clearLiveData(removeCache = false) {
  sessionEpoch++;
  openingReadStarted = false;
  if (removeCache && cacheUserId) void deleteSnapshot(cacheUserId);
  cacheUserId = null;
  accessKey = "";
  initialAccess = null;
  allowedCompanies = ["w2", "somus", "d61", "lie", "lie-design"];
  lastSources = [];
  lastSignature = "";
  loaded = false;
  loadPromise = null;
  applySources([]);
  setLiveSyncState({ status: "loading", foreground: true, lastUpdatedAt: null, lastCheckedAt: null, errorMessage: null, sourceErrors: {}, pendingCompanies: {}, confirmedAtByCompany: {}, savedViewCompanies: {} });
}
const subscribers = new Set<() => void>();
type LiveSyncState = {
  status: "loading" | "syncing" | "idle" | "error";
  foreground: boolean;
  lastCheckedAt: number | null;
  lastUpdatedAt: number | null;
  errorMessage: string | null;
  sourceErrors: Partial<Record<CompanyId, string>>;
  pendingCompanies: Partial<Record<CompanyId, boolean>>;
  confirmedAtByCompany: Partial<Record<CompanyId, number>>;
  savedViewCompanies: Partial<Record<CompanyId, boolean>>;
};

let liveSyncState: LiveSyncState = {
  status: "loading",
  foreground: true,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  errorMessage: null,
  sourceErrors: {},
  pendingCompanies: {},
  confirmedAtByCompany: {},
  savedViewCompanies: {},
};
const statusSubscribers = new Set<(state: LiveSyncState) => void>();

function setLiveSyncState(patch: Partial<LiveSyncState>) {
  liveSyncState = { ...liveSyncState, ...patch };
  statusSubscribers.forEach((fn) => fn(liveSyncState));
}

function notifyDataChanged() {
  loaded = true;
  subscribers.forEach((fn) => fn());
  setLiveSyncState({
    status: "idle",
    foreground: false,
    lastUpdatedAt: Date.now(),
    lastCheckedAt: Date.now(),
    errorMessage: null,
  });
}

function ensureLoad(background = false) {
  if (!loadPromise) {
    const epoch = sessionEpoch;
    setLiveSyncState({ status: loaded ? "syncing" : "loading", foreground: !loaded || !background, errorMessage: null });
    const request = loadContaAzulData(epoch)
      .then((committed) => {
        if (epoch !== sessionEpoch) return;
        if (committed) notifyDataChanged();
        else setLiveSyncState({ status: "idle", foreground: false, lastCheckedAt: Date.now(), errorMessage: null });
      })
      .catch((err) => {
        if (epoch !== sessionEpoch) return;
        console.error("[live-sync] failed to load external financial data", err);
        setLiveSyncState({
          status: "error",
          foreground: false,
          errorMessage: "Falha ao carregar dados do Supabase.",
        });
        throw err;
      })
      .finally(() => {
        if (loadPromise === request) {
          loadPromise = null;
        }
      });
    loadPromise = request;
  } else if (!background && !liveSyncState.foreground) {
    setLiveSyncState({ foreground: true });
  }
  return loadPromise;
}

export function refreshLiveData(options: { background?: boolean } = {}) {
  return ensureLoad(options.background);
}

export async function refreshManualCompanyData() {
  const epoch = sessionEpoch;
  if (!allowedCompanies.includes("manual-test")) throw new Error("Empresa manual nao autorizada");
  const result = await getManualCompanyData({ data: { companyId: MANUAL_COMPANY_ID } });
  if (epoch !== sessionEpoch) throw new Error("A sessao mudou. Reabra a pagina.");
  // A manual edit cannot replace any other company's confirmed API snapshot.
  lastSources = [...lastSources.filter(source => source.company !== "manual-test"),
    { company: "manual-test", snapshot: result.snapshot, confirmedAt: result.confirmedAt, readRevision: String(result.revision) }];
  applySources(lastSources);
  lastSignature = snapshotSignature(lastSources);
  setLiveSyncState({ confirmedAtByCompany: { ...liveSyncState.confirmedAtByCompany, "manual-test": Date.parse(result.confirmedAt) } });
  if (cacheUserId) void writeSnapshot(cacheUserId, { schema: 2, savedAt: Date.now(), sources: lastSources, accessKey });
  notifyDataChanged();
  return result;
}

export function useLiveData(enabled = true) {
  const [version, setVersion] = useState(loaded ? 1 : 0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setVersion((v) => v + 1);
    subscribers.add(bump);
    if (loaded) {
      setVersion((v) => (v === 0 ? 1 : v));
    }
    // Module navigation reuses this document's reading, even when the cache was restored.
    if (!openingReadStarted) {
      openingReadStarted = true;
      ensureLoad(true).catch(() => {});
    }
    return () => {
      subscribers.delete(bump);
    };
  }, [enabled]);
  return version;
}

export function useLiveSyncStatus() {
  const [state, setState] = useState(liveSyncState);
  useEffect(() => {
    statusSubscribers.add(setState);
    setState(liveSyncState);
    return () => {
      statusSubscribers.delete(setState);
    };
  }, []);
  return state;
}
