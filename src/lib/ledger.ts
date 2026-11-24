import type { Transaction } from "@/data/mock";

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function searchTransactions(rows: Transaction[], query: string) {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows;
  return rows.filter((row) => {
    const text = normalized([row.description, row.party, row.category, row.costCenter, row.source?.account, row.id].filter(Boolean).join(" "));
    return terms.every((term) => text.includes(term));
  });
}

export function ledgerTotals(rows: Transaction[]) {
  return rows.reduce((total, row) => ({
    amount: total.amount + Math.round(row.amount * 100),
    paid: total.paid + Math.round((row.source?.paidAmount ?? (row.status === "Pago" ? row.amount : 0)) * 100),
    open: total.open + Math.round((row.source?.outstandingAmount ?? (row.status === "Pago" ? 0 : row.amount)) * 100),
  }), { amount: 0, paid: 0, open: 0 });
}

export function ledgerCsv(rows: Transaction[]) {
  const cell = (value: string | number) => {
    if (typeof value === "number") return value.toFixed(2).replace(".", ",");
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? "'" + value : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [
    ["ID", "Descricao", "Cliente / Fornecedor", "Categoria", "Centro de custo", "Valor", "Pago / Recebido", "Em aberto", "Competencia", "Pagamento", "Vencimento", "Situacao", "Conta financeira"],
    ...rows.map((row) => [row.id, row.description || row.party, row.party, row.category, row.costCenter, row.amount,
      row.source?.paidAmount ?? (row.status === "Pago" ? row.amount : 0),
      row.source?.outstandingAmount ?? (row.status === "Pago" ? 0 : row.amount),
      row.competencyDate || row.date, row.paymentDate || "", row.dueDate || "", row.source?.sourceStatus || row.status, row.source?.account || ""]),
  ].map((row) => row.map(cell).join(";")).join("\r\n");
}
