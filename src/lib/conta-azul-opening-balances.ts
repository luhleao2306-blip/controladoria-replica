import { contaAzulDate, contaAzulFirstDueDate, contaAzulMoney, type ContaAzulMetadata } from "./conta-azul-model";

export const OPENING_BALANCE_CATEGORY = "Saldo inicial (aporte)";
export const OPENING_BALANCE_PREFIX = "conta-azul:initial-balance:";
export const APPROVED_OPENING_PREFIX = "somus:approved-opening:";
export type ApprovedOpeningBalance = {
  id: string; companyId: string; date: string; amountCents: number; approvedAt: string; note: string;
};

export function approvedOpeningBalanceRows(companyId: string, company: string, rows: ApprovedOpeningBalance[] = []) {
  const seen = new Set<string>();
  return rows.map(row => {
    if (!companyId || row.companyId !== companyId || !row.id || seen.has(row.id)
      || contaAzulDate(row.date) !== row.date || row.date < contaAzulFirstDueDate(company)
      || !Number.isSafeInteger(row.amountCents) || !row.amountCents || !row.note?.trim() || !row.approvedAt) {
      throw new Error("Saldo de abertura aprovado sem empresa, data, valor ou justificativa valida.");
    }
    seen.add(row.id);
    const id = `${APPROVED_OPENING_PREFIX}${companyId}:${row.id}`;
    const amount = Math.abs(row.amountCents) / 100;
    const metadata: ContaAzulMetadata = {
      version: 1, origin: "initial_balance", active: true, sourceStatus: "ABERTURA_APROVADA",
      paidAmount: amount, outstandingAmount: 0, payments: [], detailComplete: true,
      sourceUpdatedAt: null, verifiedAt: row.approvedAt, account: null,
      allocations: [{ category: OPENING_BALANCE_CATEGORY, categoryId: null, costCenter: null,
        costCenterId: null, amount, weight: amount, dreEntry: null }], warnings: [], note: row.note,
    };
    return { id, external_id: id, company_id: companyId,
      transaction_type: row.amountCents > 0 ? "revenue" : "expense",
      description: "Saldo de abertura aprovado - Somus", customer_or_supplier_name: "Somus - saldo de abertura",
      category_name: OPENING_BALANCE_CATEGORY, cost_center_name: null, amount, status: "paid",
      competence_date: row.date, due_date: null, payment_date: row.date, metadata };
  });
}
export type ContaAzulOpeningBalance = {
  tipo: "RECEITA" | "DESPESA"; id_conta_financeira: string;
  data_competencia: string; saldo_inicial: number;
};

export function openingBalanceRanges(company: string, through: string, start = contaAzulFirstDueDate(company)) {
  if (contaAzulDate(through) !== through) throw new Error("Data final de saldo inicial invalida.");
  if (contaAzulDate(start) !== start || start < contaAzulFirstDueDate(company)) throw new Error("Data inicial de saldo inicial invalida.");
  const ranges: { from: string; to: string }[] = [];
  for (let from = start; from <= through;) {
    const end = new Date(`${from}T00:00:00Z`);
    // Stay below the provider's 365-day limit even across Brazil's former DST changes.
    end.setUTCDate(end.getUTCDate() + 363);
    const to = end.toISOString().slice(0, 10) < through ? end.toISOString().slice(0, 10) : through;
    ranges.push({ from, to });
    end.setTime(new Date(`${to}T00:00:00Z`).getTime());
    end.setUTCDate(end.getUTCDate() + 1);
    from = end.toISOString().slice(0, 10);
  }
  return ranges;
}

export function validateOpeningBalances(rows: unknown, accounts: { id: string; nome: string }[], company: string) {
  if (!Array.isArray(rows)) throw new Error("Conta Azul: resposta de saldos iniciais invalida.");
  const accountIds = new Set(accounts.map(account => account.id));
  const seen = new Set<string>();
  return rows.map((row): ContaAzulOpeningBalance => {
    const date = contaAzulDate(row?.data_competencia), amount = contaAzulMoney(row?.saldo_inicial);
    if (!date || date < contaAzulFirstDueDate(company) || amount === null
      || !["RECEITA", "DESPESA"].includes(row?.tipo) || (row.tipo === "RECEITA" && amount < 0)
      || !accountIds.has(row?.id_conta_financeira)) {
      throw new Error("Conta Azul: saldo inicial sem conta, data, tipo ou valor valido no periodo autorizado.");
    }
    const key = `${row.id_conta_financeira}:${date}`;
    if (seen.has(key)) throw new Error("Conta Azul: saldo inicial repetido para a mesma conta e data.");
    seen.add(key);
    return { tipo: row.tipo, id_conta_financeira: row.id_conta_financeira, data_competencia: date, saldo_inicial: amount };
  });
}

export function openingBalanceRows(companyId: string, company: string, catalog: {
  accounts?: { id: string; nome: string; ativo?: boolean }[];
  openingBalances?: ContaAzulOpeningBalance[]; verifiedAt?: string;
} | null | undefined) {
  if (!catalog?.openingBalances) return [];
  if (catalog.openingBalances.length && !companyId) throw new Error("Empresa do saldo inicial nao informada.");
  const accounts = new Map((catalog.accounts ?? []).map(account => [account.id, account]));
  return validateOpeningBalances(catalog.openingBalances, catalog.accounts ?? [], company).flatMap(row => {
    const amount = Math.abs(row.saldo_inicial), date = row.data_competencia;
    if (!amount) return [];
    const account = accounts.get(row.id_conta_financeira)!;
    if (!account.nome?.trim()) throw new Error("Conta Azul: conta do saldo inicial sem nome.");
    const id = `${OPENING_BALANCE_PREFIX}${company === "lie" || company === "lie-design" || company === "d61" ? `${companyId}:` : ""}${row.id_conta_financeira}:${date}`;
    const metadata: ContaAzulMetadata = {
      version: 1, origin: "initial_balance", active: true, sourceStatus: "RECEBIDO",
      paidAmount: amount, outstandingAmount: 0, payments: [], detailComplete: true,
      sourceUpdatedAt: null, verifiedAt: catalog.verifiedAt ?? "", account: account.nome,
      allocations: [{ category: OPENING_BALANCE_CATEGORY, categoryId: null, costCenter: null,
        costCenterId: null, amount, weight: amount, dreEntry: null }], warnings: [],
      note: `Saldo inicial informado pelo Conta Azul em ${date}, tratado como movimento de capital nesta plataforma; nao e faturamento nem uma baixa.${account.ativo === false ? " Conta financeira inativa na origem." : ""}`,
    };
    return [{ id, external_id: id, company_id: companyId, transaction_type: row.tipo === "RECEITA" ? "revenue" : "expense",
      description: `Saldo inicial (aporte) - ${account.nome}`, customer_or_supplier_name: account.nome,
      category_name: OPENING_BALANCE_CATEGORY, cost_center_name: null, amount, status: "paid",
      competence_date: date, due_date: null, payment_date: date, metadata }];
  });
}
