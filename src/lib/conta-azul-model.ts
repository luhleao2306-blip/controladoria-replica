export type ContaAzulPayment = {
  id: string; date: string; amount: number; account: string | null;
  gross: number; interest: number; fine: number; discount: number; fee: number;
};
export type ContaAzulAllocation = {
  category: string; categoryId: string | null; costCenter: string | null;
  costCenterId: string | null; amount: number; weight: number; dreEntry?: string | null;
};
export type ContaAzulMetadata = {
  origin?: "initial_balance";
  version: 1; active: boolean; sourceStatus: string; paidAmount: number;
  outstandingAmount: number; payments: ContaAzulPayment[]; allocations: ContaAzulAllocation[];
  detailComplete: boolean; sourceUpdatedAt: string | null; verifiedAt: string;
  account: string | null; note: string | null; warnings: string[];
  reporting?: { grossAmount: number | null; sourceOrigin: string | null; loss: { date: string; amount: number } | null };
  operationCategories?: Record<string, ContaAzulAllocation>;
  reportingComponent?: string;
};

export function contaAzulReportingDetail(detail: any): NonNullable<ContaAzulMetadata["reporting"]> {
  const date = contaAzulDate(detail?.perda?.data), amount = contaAzulMoney(detail?.perda?.valor);
  return { grossAmount: contaAzulMoney(detail?.valor_composicao?.valor_bruto),
    sourceOrigin: typeof detail?.evento?.referencia?.origem === "string" ? detail.evento.referencia.origem : null,
    loss: date && amount !== null && amount > 0 ? { date, amount } : null };
}

export const CONTA_AZUL_OPERATION_DRE: Readonly<Record<string, string>> = Object.freeze({
  JUROS_RECEBIDOS: "RECEITAS_RENDIMENTOS_FINANCEIROS", MULTAS_RECEBIDAS: "RECEITAS_RENDIMENTOS_FINANCEIROS",
  DESCONTOS_FINANCEIROS_OBTIDOS: "RECEITAS_RENDIMENTOS_FINANCEIROS", JUROS_PAGOS: "DESPESAS_FINANCEIRAS",
  MULTAS_PAGAS: "DESPESAS_FINANCEIRAS", DESCONTOS_FINANCEIROS_CONCEDIDOS: "DESPESAS_FINANCEIRAS",
  TARIFAS: "DESPESAS_FINANCEIRAS", PERDAS: "OUTRAS_DESPESAS_NAO_OPERACIONAIS",
});

export function contaAzulOperationCategories(categories: any[], defaults: any[] = []): Record<string, ContaAzulAllocation> {
  const lookup = new Map(categories.map(category => [category.id, category]));
  return Object.fromEntries(defaults.flatMap(row => {
    const category = lookup.get(row.id_categoria);
    if (!category || !name(category.nome) || !name(row.tipo_operacao)) return [];
    // Keep the provider's explicit classification ahead of standard operation defaults.
    return [[row.tipo_operacao, { category: category.nome, categoryId: category.id, dreEntry: category.entrada_dre || CONTA_AZUL_OPERATION_DRE[row.tipo_operacao] || null,
      costCenter: null, costCenterId: null, amount: 0, weight: 0 }]];
  }));
}

export function contaAzulDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function contaAzulMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().replace(/^R\$\s*/, "").replace(/\s/g, "");
  if (!/^-?[\d.,]+$/.test(text)) return null;
  const normalized = text.lastIndexOf(",") > text.lastIndexOf(".")
    ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function first(item: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce((obj, key) => obj?.[key], item);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export const SOMUS_CONTA_AZUL_FIRST_DUE_DATE = "2025-09-01";
export const CONTA_AZUL_SYNC_POLICY = 5;

const CONTA_AZUL_WINDOW_MS = 365 * 86400_000;

export function contaAzulSearchWindow(company: string, updatedSince: string | undefined, until: string, index: number,
  dueScope = { from: contaAzulFirstDueDate(company), to: "2100-12-31" }) {
  const start = updatedSince ? Math.floor(Date.parse(updatedSince) / 1000) * 1000 : Date.parse(dueScope.from);
  const end = updatedSince ? Math.floor(Date.parse(until) / 1000) * 1000 : Date.parse(dueScope.to);
  const from = start + index * CONTA_AZUL_WINDOW_MS;
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(from) || !Number.isFinite(end) || from > end) {
    throw new Error("Período inválido na consulta da Conta Azul.");
  }
  const to = Math.min(from + CONTA_AZUL_WINDOW_MS - (updatedSince ? 1000 : 86400_000), end);
  const format = (stamp: number) => new Date(stamp - (updatedSince ? 3 * 3600000 : 0)).toISOString().slice(0, updatedSince ? 19 : 10);
  return { from: format(from), to: format(to), hasNextWindow: to < end };
}

export function contaAzulIncrementalSince(lastSyncAt: unknown) {
  const stamp = typeof lastSyncAt === "string" ? Date.parse(lastSyncAt) : NaN;
  return Number.isFinite(stamp) && stamp <= Date.now() + 60_000
    ? new Date(stamp - 10 * 60_000).toISOString() : undefined;
}

export function contaAzulFirstDueDate(company: string) {
  return company === "somus" ? SOMUS_CONTA_AZUL_FIRST_DUE_DATE : "2000-01-01";
}

export function assertContaAzulImportPeriod(company: string, item: any) {
  if (company !== "somus") return;
  const due = contaAzulDate(first(item, ["data_vencimento", "vencimento", "parcelas.0.data_vencimento", "parcela.data_vencimento"]));
  if (!due || due < SOMUS_CONTA_AZUL_FIRST_DUE_DATE) {
    throw new Error(`Somus: parcela ${item?.id ?? "sem ID"} fora do periodo autorizado de vencimento (a partir de 01/09/2025).`);
  }
  const detailDue = item.__somus_detail?.data_vencimento;
  if (detailDue != null && contaAzulDate(detailDue) !== due) {
    throw new Error(`Somus: vencimento divergente no detalhe da parcela ${item?.id ?? "sem ID"}. Atualize a consulta antes de importar.`);
  }
}
function name(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function joinNames(values: any[], field = "nome"): string | null {
  const labels = [...new Set(values.map((value) => name(value?.[field])).filter(Boolean))];
  return labels.length ? labels.join("; ") : null;
}

export function contaAzulTotal(item: any): number {
  const total = contaAzulMoney(first(item, ["total", "valor_total_liquido", "valor_composicao.valor_liquido",
    "valor.valor_liquido", "valor_composicao.valor_bruto", "valor.valor_bruto", "valor_total", "valor"]));
  if (total === null) throw new Error(`Conta Azul: valor total ausente na parcela ${item?.id ?? "sem ID"}.`);
  return total;
}

export function contaAzulSourceStatus(item: any): string {
  const raw = String(first(item, ["status_traduzido", "status", "situacao.nome", "situacao"]) ?? "").toUpperCase();
  if (/PARCIAL|PARTIAL/.test(raw)) return "RECEBIDO_PARCIAL";
  if (/RENEG/.test(raw)) return "RENEGOCIADO";
  if (/LOST|PERD/.test(raw)) return "PERDIDO";
  if (/CANCEL/.test(raw)) return "CANCELADO";
  if (/ACQUITTED|QUIT|PAID|PAGO|RECEBIDO|SETTLED|LIQUID/.test(raw)) return "RECEBIDO";
  if (/OVERDUE|ATRAS|VENC/.test(raw)) return "ATRASADO";
  if (/PENDING|PENDENTE|EM_ABERTO/.test(raw)) return "EM_ABERTO";
  throw new Error(`Conta Azul: situacao desconhecida "${raw}" na parcela ${item?.id ?? "sem ID"}.`);
}

export function canReuseContaAzulDetail(previous: any, current: any) {
  if (!previous?.__somus_detail || previous.__somus_detail_source_updated_at !== current.data_alteracao) return false;
  // Payments and overdue status can change without a new alteration timestamp.
  const fields = ["total", "valor", "valor_total", "valor_total_liquido", "valor_composicao", "pago", "nao_pago", "status", "status_traduzido", "descricao",
    "data_vencimento", "data_competencia", "data_pagamento", "cliente", "fornecedor", "contato", "categorias", "centros_de_custo", "centros_custo",
    "evento", "rateio", "conta_financeira", "baixas", "fatura", "perda"];
  // JSONB may reorder object keys without changing the provider's financial data.
  const comparable = (value: unknown) => JSON.stringify(value ?? null, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
  return fields.every(field => comparable(previous[field]) === comparable(current[field]));
}

function fiscalDescriptionSuffix(detail: any) {
  if (detail?.fatura?.tipo_fatura !== "NFSE") return "";
  const reference = (value: unknown) => {
    if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    return typeof value === "string" && /^\d+$/.test(value.trim()) && !/^0+$/.test(value.trim()) ? value.trim() : null;
  };
  const invoice = reference(detail.fatura.numero), rps = reference(detail.fatura.rps);
  return invoice && rps ? ` / NFS-e:${invoice} - RPS:${rps}` : "";
}

export function contaAzulDescriptionFromDetail(summary: any, detail: any) {
  const currentSuffix = fiscalDescriptionSuffix(detail), previousSuffix = fiscalDescriptionSuffix(summary.__somus_detail);
  const withoutSuffix = (value: any, suffix: string) => typeof value === "string" && suffix && value.endsWith(suffix)
    ? value.slice(0, -suffix.length) : value;
  const currentDescription = withoutSuffix(detail.descricao, currentSuffix);
  const previousDescription = withoutSuffix(summary.__somus_detail?.descricao, previousSuffix) || currentDescription;
  const searchDescription = withoutSuffix(withoutSuffix(summary.descricao, previousSuffix), currentSuffix);
  // Search includes installment prefixes and NFSe references absent from the detail's base description.
  const description = previousDescription && typeof currentDescription === "string" && typeof searchDescription === "string"
    && searchDescription.endsWith(previousDescription)
    ? searchDescription.slice(0, -previousDescription.length) + currentDescription : currentDescription ?? searchDescription;
  return typeof description === "string" && currentSuffix ? description + currentSuffix : description;
}

export function refreshContaAzulSummaryFromDetail(summary: any, detail: any) {
  if (detail.id !== summary.id || !Array.isArray(detail.evento?.rateio)) throw new Error("Detalhe financeiro diferente da parcela solicitada.");
  const categories = detail.evento.rateio.map((row: any) => ({ id: row.id_categoria, nome: row.nome_categoria }));
  const centers = detail.evento.rateio.flatMap((row: any) => row.rateio_centro_custo ?? [])
    .map((row: any) => ({ id: row.id_centro_custo, nome: row.nome_centro_custo }));
  const description = contaAzulDescriptionFromDetail(summary, detail);
  return { ...summary, ...detail, descricao: description, total: contaAzulTotal(detail), pago: detail.valor_pago ?? summary.pago,
    nao_pago: detail.nao_pago ?? summary.nao_pago, status_traduzido: undefined,
    data_competencia: detail.evento.data_competencia ?? summary.data_competencia,
    categorias: categories, centros_de_custo: [...new Map(centers.map((row: any) => [row.id, row])).values()],
    __somus_detail: detail, __somus_detail_source_updated_at: detail.data_alteracao ?? summary.data_alteracao,
    __somus_detail_checked_at: new Date().toISOString() };
}

export function mapContaAzulTransaction(item: any, companyId: string, type: "revenue" | "expense", catalog: any[] = []) {
  const id = first(item, ["id", "id_evento", "id_legado", "id_parcela", "evento.id", "parcela.id", "parcelas.0.id"]);
  const sourceStatus = contaAzulSourceStatus(item);
  const competence = contaAzulDate(first(item, ["data_competencia", "evento.data_competencia", "data_competencia_inicio", "data"]));
  if (!competence) throw new Error(`Conta Azul: competencia ausente ou invalida na parcela ${id ?? "sem ID"}.`);
  const detail = item.__somus_detail;
  const rateio = detail?.evento?.rateio ?? item.evento?.rateio ?? item.rateio ?? [];
  const lookup = new Map(catalog.map(category => [category.id, category]));
  const categories = (item.categorias ?? []).map((category: any) => ({ ...category, nome: name(lookup.get(category.id)?.nome) ?? category.nome }));
  const namedRateio = rateio.map((row: any) => ({ ...row, nome_categoria: name(lookup.get(row.id_categoria)?.nome) ?? row.nome_categoria }));
  const centers = item.centros_de_custo ?? item.centros_custo ?? [];
  const payments = detail?.baixas ?? item.baixas ?? [];
  const paidDates = payments.map((p: any) => contaAzulDate(p.data_pagamento)).filter(Boolean).sort();
  return {
    company_id: companyId, external_id: id === null ? null : String(id), transaction_type: type,
    accounting_basis: "accrual" as const,
    description: name(first(item, ["descricao", "observacao", "nota"])) ?? "Descricao nao informada no Conta Azul",
    customer_or_supplier_name: name(first(item, ["contato.nome", "cliente.nome", "fornecedor.nome", "nome_contato"])),
    category_name: joinNames(categories) ?? joinNames(namedRateio, "nome_categoria") ?? name(first(item, ["categoria.nome", "rateio.0.categoria.nome"])),
    cost_center_name: joinNames(centers) ?? joinNames(rateio.flatMap((r: any) => r.rateio_centro_custo ?? []), "nome_centro_custo")
      ?? name(first(item, ["centro_custo.nome", "rateio.0.rateio_centro_custo.0.centro_custo.nome"])),
    amount: contaAzulTotal(item),
    due_date: contaAzulDate(first(item, ["data_vencimento", "vencimento", "parcelas.0.data_vencimento", "parcela.data_vencimento"])),
    payment_date: paidDates.at(-1) ?? contaAzulDate(item.data_pagamento), competence_date: competence,
    status: (sourceStatus === "RECEBIDO" ? "paid" : sourceStatus === "ATRASADO" ? "overdue"
      : ["CANCELADO", "PERDIDO", "RENEGOCIADO"].includes(sourceStatus) ? "canceled" : "pending") as "paid" | "overdue" | "canceled" | "pending",
  };
}

export function contaAzulMetadata(item: any, categories: any[] = []): ContaAzulMetadata {
  const detail = item.__somus_detail;
  const total = contaAzulTotal(item);
  const sourceStatus = contaAzulSourceStatus(item);
  const paid = contaAzulMoney(item.pago ?? detail?.valor_pago) ?? (sourceStatus === "RECEBIDO" ? total : 0);
  const outstanding = contaAzulMoney(item.nao_pago ?? detail?.nao_pago)
    ?? (["RECEBIDO", "CANCELADO", "PERDIDO", "RENEGOCIADO"].includes(sourceStatus) ? 0 : Math.max(0, total - paid));
  const warnings: string[] = [];
  const payments: ContaAzulPayment[] = (detail?.baixas ?? []).map((p: any) => {
    const v = p.valor_composicao ?? p.composicao_valor ?? {};
    const gross = contaAzulMoney(v.valor_bruto) ?? 0;
    const interest = contaAzulMoney(v.juros) ?? 0, fine = contaAzulMoney(v.multa) ?? 0;
    const discount = contaAzulMoney(v.desconto) ?? 0, fee = contaAzulMoney(v.taxa) ?? 0;
    const amount = contaAzulMoney(v.valor_liquido) ?? gross + interest + fine - discount - fee;
    const date = contaAzulDate(p.data_pagamento);
    if (!date) throw new Error(`Conta Azul: baixa ${p.id} sem data de pagamento valida.`);
    return { id: String(p.id), date, amount, gross, interest, fine, discount, fee, account: name(p.conta_financeira?.nome) };
  });
  if (detail && paid > 0 && !payments.length) warnings.push("Pagamento informado sem baixa retornada pela API");
  const categoryLookup = new Map(categories.map((c) => [c.id, c]));
  const rateio = detail?.evento?.rateio ?? [];
  const allocations: ContaAzulAllocation[] = [];
  for (const r of rateio) {
    const category = name(categoryLookup.get(r.id_categoria)?.nome) ?? name(r.nome_categoria)
      ?? name(item.categorias?.find((c: any) => c.id === r.id_categoria)?.nome);
    if (!category) throw new Error(`Conta Azul: categoria ${r.id_categoria} sem nome resolvido.`);
    const centers = r.rateio_centro_custo?.length ? r.rateio_centro_custo : [null];
    for (const cc of centers) {
      allocations.push({ category, categoryId: r.id_categoria ?? null,
        costCenter: name(cc?.nome_centro_custo) ?? name(item.centros_de_custo?.find((c: any) => c.id === cc?.id_centro_custo)?.nome),
        costCenterId: cc?.id_centro_custo ?? null, amount: 0,
        weight: contaAzulMoney(cc?.valor ?? r.valor) ?? 0, dreEntry: categoryLookup.get(r.id_categoria)?.entrada_dre ?? null });
    }
  }
  if (!allocations.length) {
    const cats = item.categorias ?? [];
    if (cats.length > 1) warnings.push("Rateio de categorias ainda nao detalhado");
    const cc = item.centros_de_custo ?? item.centros_custo ?? [];
    const category = joinNames(cats.map((c: any) => ({ ...c, nome: name(categoryLookup.get(c.id)?.nome) ?? c.nome }))) ?? "Categoria nao informada no Conta Azul";
    allocations.push({ category, categoryId: cats.length === 1 ? cats[0].id : null,
      costCenter: joinNames(cc), costCenterId: cc.length === 1 ? cc[0].id : null,
      weight: total, amount: total, dreEntry: cats.length === 1 ? categoryLookup.get(cats[0].id)?.entrada_dre ?? null : null });
  } else {
    const weight = allocations.reduce((sum, r) => sum + r.weight, 0);
    if (weight <= 0 && total !== 0) throw new Error(`Conta Azul: rateio sem valores na parcela ${item.id}.`);
    let assignedCents = 0;
    allocations.forEach((r, i) => {
      const cents = i === allocations.length - 1 ? Math.round(total * 100) - assignedCents
        : Math.round(total * 100 * (weight ? r.weight / weight : 0));
      r.amount = cents / 100; assignedCents += cents;
    });
  }
  return { version: 1, active: true, sourceStatus, paidAmount: paid, outstandingAmount: outstanding,
    payments, allocations, detailComplete: Boolean(detail), sourceUpdatedAt: item.data_alteracao ?? null,
    verifiedAt: new Date().toISOString(), account: name(detail?.conta_financeira?.nome), note: name(detail?.nota), warnings,
    ...(detail ? { reporting: contaAzulReportingDetail(detail) } : {}) };
}

export function projectContaAzulDreCategories(categories: any[], dre: any) {
  const byId = new Map(categories.map(category => [category.id, category]));
  const memberships = new Map<string, Set<string>>();
  const visit = (items: any[]) => {
    for (const item of items) {
      const members = Array.isArray(item.categorias_financeiras) ? item.categorias_financeiras : [];
      const entries = new Set<string>(members.map((member: any) => byId.get(member.id)?.entrada_dre).filter(Boolean));
      if (!item.indica_totalizador && entries.size === 1) {
        for (const member of members) {
          const groups = memberships.get(member.id) ?? new Set<string>();
          groups.add([...entries][0]);
          memberships.set(member.id, groups);
        }
      }
      if (Array.isArray(item.subitens)) visit(item.subitens);
    }
  };
  if (Array.isArray(dre?.itens)) visit(dre.itens);
  return categories.map(category => {
    const groups = memberships.get(category.id);
    // Fill only explicit, unambiguous membership in the provider's own DRE tree.
    return !category.entrada_dre && groups?.size === 1
      ? { ...category, entrada_dre: [...groups][0] } : category;
  });
}

export function reconcileContaAzulCategoryNames(metadata: ContaAzulMetadata, categories: any[]) {
  const lookup = new Map(categories.map(category => [category.id, category]));
  let changed = false;
  const allocations = metadata.allocations.map(allocation => {
    const category = lookup.get(allocation.categoryId);
    if (!category) return allocation;
    const label = name(category.nome) ?? allocation.category;
    const dreEntry = category.entrada_dre ?? null;
    if (label === allocation.category && dreEntry === (allocation.dreEntry ?? null)) return allocation;
    changed = true;
    return { ...allocation, category: label, dreEntry };
  });
  return changed ? { ...metadata, allocations } : metadata;
}
