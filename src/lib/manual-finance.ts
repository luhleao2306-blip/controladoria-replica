import { z } from "zod";
import { contaAzulDate, type ContaAzulMetadata } from "./conta-azul-model";
import { MANUAL_COMPANY_ID, MANUAL_COMPANY_KEY, MANUAL_COMPANY_NAME } from "./manual-company";

export const MANUAL_GROUPS = [
  ["grossRevenue", "Receita Bruta", "revenue", "RECEITA_VENDA_PRODUTOS_SERVICOS"],
  ["financialIncome", "Receitas Financeiras", "revenue", "RECEITAS_RENDIMENTOS_FINANCEIROS"],
  ["otherIncome", "Outras receitas", "revenue", "OUTRAS_RECEITAS_NAO_OPERACIONAIS"],
  ["loanReceipts", "Emprestimos recebidos", "revenue", "EMPRESTIMOS_DIVIDAS"],
  ["capitalReceipts", "Aportes", "revenue", "MANUAL_CAPITAL_RECEIPTS"],
  ["taxes", "Impostos sobre vendas", "expense", "IMPOSTOS_SOBRE_VENDAS"],
  ["commissions", "Comissoes sobre vendas", "expense", "COMISSOES_SOBRE_VENDAS"],
  ["discounts", "Descontos incondicionais", "expense", "DESCONTOS_INCONDICIONAIS"],
  ["operationalCosts", "Custo dos servicos prestados", "expense", "CUSTO_SERVICOS_PRESTADOS"],
  ["commercialExpenses", "Despesas Comerciais", "expense", "DESPESAS_COMERCIAIS"],
  ["adminExpenses", "Despesas Administrativas", "expense", "DESPESAS_ADMINISTRATIVAS"],
  ["operationalExpenses", "Despesas Operacionais", "expense", "DESPESAS_OPERACIONAIS_NIVEL_2"],
  ["financialExpense", "Despesas Financeiras", "expense", "DESPESAS_FINANCEIRAS"],
  ["otherExpense", "Outras despesas", "expense", "OUTRAS_DESPESAS_NAO_OPERACIONAIS"],
  ["debts", "Emprestimos e dividas", "expense", "EMPRESTIMOS_DIVIDAS"],
  ["capitalWithdrawals", "Retiradas de socios", "expense", "MANUAL_CAPITAL_WITHDRAWALS"],
  ["investments", "Investimentos", "expense", "INVESTIMENTOS_IMOBILIZADO"],
] as const;
export type ManualGroup = typeof MANUAL_GROUPS[number][0];
const text = (max: number) => z.string().trim().min(1).max(max);
const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && contaAzulDate(value) === value
  && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2200, "Data invalida; use um ano entre 1900 e 2200");
export const manualEntrySchema = z.object({
  id: text(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Identificador: use letras, numeros, ponto, traco ou sublinhado"),
  type: z.enum(["revenue", "expense"]), description: text(500), party: text(200), category: text(200),
  group: z.enum(MANUAL_GROUPS.map(group => group[0]) as [ManualGroup, ...ManualGroup[]]),
  costCenter: z.string().trim().max(200).default(""), account: text(200),
  competenceDate: date, dueDate: date, paymentDate: z.union([date, z.literal("")]),
  amountCents: z.number().int().positive().max(100_000_000_000), paidCents: z.number().int().min(0).max(100_000_000_000),
}).strict().superRefine((entry, context) => {
  if (entry.paidCents > entry.amountCents) context.addIssue({ code: "custom", path: ["paidCents"], message: "Liquidado nao pode superar o valor total" });
  if (Boolean(entry.paidCents) !== Boolean(entry.paymentDate)) context.addIssue({ code: "custom", path: ["paymentDate"], message: "Informe data e valor liquidado juntos" });
  if (MANUAL_GROUPS.find(group => group[0] === entry.group)?.[2] !== entry.type) context.addIssue({ code: "custom", path: ["group"], message: "Grupo DRE incompativel com entrada ou saida" });
});
export type ManualEntry = z.infer<typeof manualEntrySchema>;
export type StoredManualEntry = ManualEntry & { deletedAt?: string; updatedAt: string; updatedBy: string };
export type ManualDocument = { revision: number; entries: StoredManualEntry[]; history: { requestId: string; fingerprint: string; at: string; userId: string; action: string; ids: string[] }[] };
export const emptyManualDocument = (): ManualDocument => ({ revision: 0, entries: [], history: [] });
export const manualChangeSchema = z.object({ companyId: z.literal(MANUAL_COMPANY_ID), revision: z.number().int().min(0),
  requestId: z.string().uuid(), action: z.enum(["save", "import", "archive", "restore"]),
  entries: z.array(manualEntrySchema).max(1000).default([]), ids: z.array(text(80)).max(1000).default([]),
  replaceExisting: z.boolean().default(false),
}).strict();
export type ManualChange = z.infer<typeof manualChangeSchema>;

export function manualChangeContent(change: ManualChange) {
  return JSON.stringify([change.action, change.entries, change.ids, change.replaceExisting]);
}
export function applyManualChange(document: ManualDocument, change: ManualChange, userId: string, at: string, fingerprint = manualChangeContent(change)) {
  const previous = document.history.find(row => row.requestId === change.requestId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error("Solicitacao repetida com conteudo diferente");
    return { document, saved: 0, skipped: change.entries.length, repeated: true };
  }
  if (change.revision !== document.revision) throw new Error("Os dados foram alterados por outro usuario. Clique em Recarregar nesta tela e confira antes de salvar.");
  const entries = new Map(document.entries.map(entry => [entry.id, entry]));
  const ids = change.action === "archive" || change.action === "restore" ? change.ids : change.entries.map(entry => entry.id);
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("Informe lancamentos com identificadores unicos");
  if (change.action === "save" && change.entries.length !== 1) throw new Error("Salve um lancamento por vez");
  let saved = 0, skipped = 0;
  if (change.action === "archive" || change.action === "restore") {
    if (change.entries.length) throw new Error("Solicitacao invalida");
    for (const id of ids) {
      const entry = entries.get(id);
      if (!entry) throw new Error("Lancamento nao encontrado nesta empresa");
      const updated = { ...entry, updatedAt: at, updatedBy: userId };
      if (change.action === "archive") updated.deletedAt = at; else delete updated.deletedAt;
      entries.set(id, updated); saved++;
    }
  } else {
    if (change.ids.length) throw new Error("Solicitacao invalida");
    for (const value of change.entries) {
      const entry = manualEntrySchema.parse(value), current = entries.get(entry.id);
      if (current && change.action === "save" && !change.replaceExisting) throw new Error("Identificador ja cadastrado. Use Editar no lancamento existente.");
      if (current && change.action === "import" && !change.replaceExisting) { skipped++; continue; }
      if (current?.deletedAt && change.action === "save") throw new Error("Restaure o lancamento antes de editar");
      entries.set(entry.id, { ...entry, updatedAt: at, updatedBy: userId }); saved++;
    }
  }
  if (entries.size > 5000) throw new Error("Limite de 5000 lancamentos por empresa de teste");
  const categories = new Map<string, string>();
  for (const entry of entries.values()) if (!entry.deletedAt) {
    const key = `${entry.type}:${entry.category.toLocaleLowerCase("pt-BR")}`;
    if (categories.has(key) && categories.get(key) !== entry.group) throw new Error(`Categoria com grupos DRE diferentes: ${entry.category}`);
    categories.set(key, entry.group);
  }
  const next = { revision: document.revision + 1, entries: [...entries.values()], history: [...document.history.slice(-49),
    { requestId: change.requestId, fingerprint, at, userId, action: change.action, ids }] };
  if (JSON.stringify(next).length > 2_000_000) throw new Error("Arquivo excede o tamanho permitido para esta empresa de teste");
  return { document: next, saved, skipped, repeated: false };
}

export function manualSnapshot(document: ManualDocument, today: string, confirmedAt: string) {
  const entries = document.entries.filter(entry => !entry.deletedAt);
  const accounts = new Map<string, number>([["Caixa", 0]]);
  const rows = entries.map(entry => {
    const amount = entry.amountCents / 100, paid = entry.paidCents / 100;
    const balance = (accounts.get(entry.account) ?? 0) + (entry.paymentDate && entry.paymentDate <= today ? (entry.type === "revenue" ? 1 : -1) * entry.paidCents : 0);
    accounts.set(entry.account, balance);
    const metadata: ContaAzulMetadata = { version: 1, active: true, sourceStatus: paid === amount ? "RECEBIDO" : paid > 0 ? "RECEBIDO_PARCIAL" : "EM_ABERTO",
      paidAmount: paid, outstandingAmount: (entry.amountCents - entry.paidCents) / 100, detailComplete: true, sourceUpdatedAt: entry.updatedAt,
      verifiedAt: confirmedAt, account: entry.account, note: "Cadastro manual", warnings: [],
      allocations: [{ category: entry.category, categoryId: null, costCenter: entry.costCenter || null, costCenterId: null, amount, weight: 100,
        dreEntry: MANUAL_GROUPS.find(group => group[0] === entry.group)![3] }],
      payments: paid ? [{ id: `manual-payment:${entry.id}`, date: entry.paymentDate, amount: paid, account: entry.account,
        gross: paid, interest: 0, fine: 0, discount: 0, fee: 0 }] : [] };
    return { id: `manual:${entry.id}`, external_id: `manual:${entry.id}`, company_id: MANUAL_COMPANY_ID, transaction_type: entry.type,
      description: entry.description, customer_or_supplier_name: entry.party, category_name: entry.category, cost_center_name: entry.costCenter,
      amount, due_date: entry.dueDate, competence_date: entry.competenceDate, payment_date: entry.paymentDate || null,
      status: paid === amount ? "Pago" : entry.dueDate < today ? "Atrasado" : "Pendente", metadata };
  });
  return { companies: [{ id: MANUAL_COMPANY_ID, name: MANUAL_COMPANY_NAME, slug: MANUAL_COMPANY_KEY }],
    financialAccounts: [...accounts].map(([nome, cents]) => ({ id: `manual:${nome}`, nome, ativo: true, currentBalance: { saldo_atual: cents / 100 } })),
    categorias: [...new Set(entries.map(entry => entry.category))].map(name => ({ id: name, name })), centros_de_custo: [], pessoas: [],
    financial_transactions: rows, receitas: [], despesas: [], vendas: [], contratos: [], bem: [], kpi_snapshots: [], budget_targets: [],
  };
}
