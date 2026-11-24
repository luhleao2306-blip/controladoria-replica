import { MANUAL_GROUPS, manualEntrySchema, type ManualEntry } from "./manual-finance";
import { contaAzulDate } from "./conta-azul-model";

export const MANUAL_HEADERS = ["Identificador", "Tipo", "Descricao", "Cliente / fornecedor", "Categoria", "Grupo DRE", "Centro de custo", "Conta", "Competencia", "Vencimento", "Valor", "Pago / recebido", "Data pagamento"];
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
export function manualMoneyCents(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  let parsed: number;
  if (typeof value === "number") parsed = value;
  else if (typeof value === "string" && /^\s*(?:R\$\s*)?\d+(?:\.\d{3})*(?:,\d{1,2})?\s*$/.test(value) && value.includes(",")) parsed = Number(value.replace(/R\$|\s|\./g, "").replace(",", "."));
  else if (typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value.trim())) parsed = Number(value.trim());
  else throw new Error("Valor invalido; use numero positivo com ate duas casas decimais");
  if (!Number.isFinite(parsed) || parsed < 0 || Math.abs(parsed * 100 - Math.round(parsed * 100)) > 0.0001) throw new Error("Valor invalido; use ate duas casas decimais");
  return Math.round(parsed * 100);
}
function text(value: unknown) {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Celula invalida: formulas e objetos nao sao aceitos");
  return String(value).trim();
}
function date(value: unknown, date1904: boolean) {
  if (value == null || value === "") return "";
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 150000) {
    if (!date1904 && value === 60) throw new Error("Data Excel inexistente: 29/02/1900");
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, value < 60 ? 31 : 30);
    return new Date(base + value * 86400000).toISOString().slice(0, 10);
  }
  const parsed = contaAzulDate(text(value));
  if (!parsed) throw new Error("Data invalida: use DD/MM/AAAA ou AAAA-MM-DD");
  return parsed;
}
export function parseManualRows(headers: unknown[], values: unknown[][], date1904 = false) {
  if (headers.length !== MANUAL_HEADERS.length || headers.some((header, i) => normalize(text(header)) !== normalize(MANUAL_HEADERS[i]))) {
    throw new Error("Cabecalho diferente do modelo. Use a aba Lancamentos do modelo padrao, sem coluna de empresa.");
  }
  const entries: ManualEntry[] = [], errors: { row: number; message: string }[] = [], ids = new Set<string>();
  if (values.length > 1000) throw new Error("Importe ate 1000 linhas por arquivo");
  values.forEach((row, index) => {
    if (row.every(cell => cell === null || cell === undefined || cell === "")) return;
    try {
      if (row.some(cell => cell !== null && typeof cell === "object" && !(cell instanceof Date))) throw new Error("Formulas, links e celulas compostas nao sao aceitos");
      const [id, kind, description, party, category, groupName, costCenter, account, competence, due, amount, paid, payment] = row;
      const type = normalize(text(kind)) === "entrada" ? "revenue" : normalize(text(kind)) === "saida" ? "expense" : null;
      const group = MANUAL_GROUPS.find(group => normalize(group[1]) === normalize(text(groupName)) || group[0] === text(groupName));
      const result = manualEntrySchema.safeParse({ id: text(id), type, description: text(description), party: text(party), category: text(category), group: group?.[0],
        costCenter: text(costCenter), account: text(account), competenceDate: date(competence, date1904), dueDate: date(due, date1904),
        amountCents: manualMoneyCents(amount), paidCents: manualMoneyCents(paid), paymentDate: date(payment, date1904) });
      if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      if (ids.has(result.data.id)) throw new Error(`Identificador repetido no arquivo: ${result.data.id}`);
      ids.add(result.data.id); entries.push(result.data);
    } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Linha invalida" }); }
  });
  return { entries, errors };
}

export async function readManualWorkbook(file: File) {
  if (!/\.xlsx$/i.test(file.name) || file.size > 5_000_000) throw new Error("Use arquivo .xlsx de ate 5 MB");
  const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.getWorksheet("Lancamentos");
  if (!sheet) throw new Error("Aba Lancamentos nao encontrada");
  if (sheet.rowCount > 1001 || sheet.columnCount > MANUAL_HEADERS.length) throw new Error("Arquivo fora do limite de 1000 linhas ou com colunas adicionais");
  const headers = MANUAL_HEADERS.map((_, i) => sheet.getRow(1).getCell(i + 1).value);
  const rows = Array.from({ length: Math.max(0, sheet.rowCount - 1) }, (_, i) => MANUAL_HEADERS.map((_, column) => sheet.getRow(i + 2).getCell(column + 1).value));
  return parseManualRows(headers, rows, Boolean(workbook.properties.date1904));
}
