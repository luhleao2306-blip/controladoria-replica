import { DRE_BUCKET_LABELS, DRE_ROWS } from "./dre-rows";
import { consolidateSimulations, simulationChanges, simulationChanged, simulationEntries, simulationGroups, simulationRows, type Simulation } from "./dre-simulation";
import { formatBRL, MONTHS_PT } from "./format";

const monthLabel = (month: string) => `${MONTHS_PT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const moneyFormat = '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00';
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function simulationExportData(simulation: Simulation) {
  const rows = simulationRows(simulation), original = simulationRows(simulation, true);
  const entries = simulationEntries(simulation);
  const categories = DRE_ROWS.filter(row => !row.emphasis).flatMap(row => simulationGroups(simulation, row.key).map(group => ({
    line: row.label, category: group.category, values: group.values, total: group.total, count: group.entries.length,
  })));
  return { rows, original, entries, categories };
}

export async function simulationXlsx(simulation: Simulation): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Modblue Controladoria"; workbook.created = new Date();
  const report = simulationExportData(simulation);
  const sheet = (name: string, headers: string[], values: (string | number)[][], widths: number[], numeric: number[]) => {
    const tab = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5, xSplit: 1 }] });
    tab.addRow([`SIMULAÇÃO - ${simulation.name}`]);
    tab.addRow([simulation.companyName, simulation.basis === "cash" ? "Caixa: pagamentos e abertos por vencimento" : "Competência"]);
    tab.addRow([`Base original: ${new Date(simulation.createdAt).toLocaleString("pt-BR")}`, "Não altera o DRE principal"]);
    tab.addRow([]); tab.addRow(headers);
    tab.addRows(values);
    tab.columns.forEach((column, i) => { column.width = widths[i] ?? 20; });
    tab.getRow(1).font = { name: "Calibri", size: 15, bold: true, color: { argb: "FF075985" } };
    tab.getRow(5).eachCell(cell => { cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123047" } }; });
    tab.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + values.length, column: headers.length } };
    tab.eachRow((row, index) => {
      if (index <= 5) return;
      row.alignment = { vertical: "top", wrapText: true };
      for (const column of numeric) { row.getCell(column).numFmt = moneyFormat; row.getCell(column).alignment = { horizontal: "right", vertical: "top" }; }
    });
    tab.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:5" };
    return tab;
  };
  const moneyColumns = Array.from({ length: simulation.months.length + 3 }, (_, i) => i + 2);
  sheet("DRE Simulado", ["Linha", ...simulation.months.map(monthLabel), "Total original", "Total simulado", "Variação"], report.rows.map((row, i) => [
    row.label, ...row.values.map(value => value / 100), report.original[i].total / 100, row.total / 100, (row.total - report.original[i].total) / 100,
  ]), [42], moneyColumns);
  sheet("DRE Original", ["Linha", ...simulation.months.map(monthLabel), "Total original"], report.original.map(row => [row.label, ...row.values.map(value => value / 100), row.total / 100]), [42], moneyColumns.slice(0, -2));
  sheet("Categorias", ["Grupo DRE", "Categoria", ...simulation.months.map(monthLabel), "Total simulado", "Itens"], report.categories.map(group => [
    group.line, group.category, ...group.values.map(value => value / 100), group.total / 100, group.count,
  ]), [36, 48], Array.from({ length: simulation.months.length + 1 }, (_, i) => i + 3));
  sheet("Lançamentos", ["Empresa", "Identificador", "Data original", "Mês original", "Mês simulado", "Nome", "Descrição original", "Descrição simulada",
    "Grupo original", "Grupo simulado", "Categoria original", "Categoria simulada", "Centro de custo", "Conta", "Situação original", "Valor original", "Valor simulado", "Variação", "Estado no cenário"],
  report.entries.map(entry => [simulation.companyName, entry.transactionId, entry.date, entry.originalMonth, entry.month, entry.party, entry.originalDescription, entry.description,
    DRE_BUCKET_LABELS[entry.originalBucket], DRE_BUCKET_LABELS[entry.bucket], entry.originalCategory, entry.category, entry.costCenter, entry.account, entry.status,
    entry.originalCents / 100, (entry.excluded ? 0 : entry.amountCents) / 100, ((entry.excluded ? 0 : entry.amountCents) - entry.originalCents) / 100,
    entry.excluded ? "Excluído do cenário" : entry.added ? "Adicionado no cenário" : simulationChanged(entry) ? "Alterado no cenário" : "Original"]),
  [28, 40, 16, 16, 16, 34, 65, 65, 36, 36, 44, 44, 30, 30, 22, 22, 22, 22, 26], [16, 17, 18]);
  sheet("Filtros", ["Campo", "Valor"], [["Empresa", simulation.companyName], ["Cenário", simulation.name], ["Base", simulation.basis === "cash" ? "Caixa, incluindo abertos por vencimento" : "Competência"],
    ["Meses", simulation.months.map(monthLabel).join(", ")], ["Leitura original", simulation.createdAt], ["Filtros da leitura", simulation.filters],
    ["Itens exportados", report.entries.length], ["Itens alterados", report.entries.filter(simulationChanged).length]], [30, 100], []);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function simulationPdf(input: Simulation | Simulation[]): Promise<Uint8Array> {
  const simulations = Array.isArray(input) ? input : [input];
  const changes = simulationChanges(simulations);
  if (!changes.length) throw new Error("Não há alterações para exportar em PDF.");
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3", compress: true });
  for (let start = 0; start < changes.length; start += 200) {
    if (start) doc.addPage();
    autoTable(doc, {
      head: [["Empresa / cenário", "Data / identificação", "Descrição original / simulada", "Classificação original", "Classificação simulada / alteração", "Original", "Simulado", "Variação"]],
      body: changes.slice(start, start + 200).map(({ companyName, scenario, entry }) => [
        `${companyName}\n${scenario}`,
        `${entry.party}\n${entry.transactionId || "Ajuste da simulação"}\nData original: ${entry.date}\nMês original: ${entry.added ? "Não se aplica" : entry.originalMonth}\nMês simulado: ${entry.month}`,
        `Original: ${entry.added ? "Não se aplica" : entry.originalDescription || "Não informado na origem"}\nSimulada: ${entry.description || "Não informada"}`,
        entry.added ? "Não se aplica" : `${DRE_BUCKET_LABELS[entry.originalBucket]}\n${entry.originalCategory}`,
        `${DRE_BUCKET_LABELS[entry.bucket]}\n${entry.category}\n${entry.excluded ? "EXCLUÍDO DO CENÁRIO" : entry.added ? "ADICIONADO NO CENÁRIO" : "ALTERADO NO CENÁRIO"}`,
        formatBRL(entry.originalCents / 100), formatBRL((entry.excluded ? 0 : entry.amountCents) / 100),
        formatBRL(((entry.excluded ? 0 : entry.amountCents) - entry.originalCents) / 100),
      ]),
      startY: 27, margin: { top: 27, right: 14, bottom: 15, left: 14 }, theme: "striped",
      styles: { font: "helvetica", fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [18, 48, 71], textColor: 255 }, rowPageBreak: "avoid",
      columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 54 }, 5: { cellWidth: 31, halign: "right" }, 6: { cellWidth: 31, halign: "right" }, 7: { cellWidth: 31, halign: "right" } },
      didDrawPage: () => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(18, 48, 71);
        doc.text("DRE SIMULAÇÃO | ALTERAÇÕES", 14, 12);
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(70);
        doc.text(`Somente itens alterados | ${changes.length} alterações | ${simulations.length} empresa(s) | ${simulations[0].basis === "cash" ? "Caixa, incluindo abertos por vencimento" : "Competência"}`, 14, 19);
      },
      didParseCell: cell => {
        if (cell.section !== "body" || cell.column.index < 5) return;
        cell.cell.styles.textColor = String(cell.cell.raw).startsWith("-") ? [190, 18, 60] : [3, 105, 161];
      },
    });
    await yieldTask();
  }
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(95);
    doc.text("Modblue Controladoria | Simulação não contabilizada | DRE principal preservado", 14, 289);
    doc.text(`${page} / ${pages}`, 400, 289, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

export async function consolidatedSimulationXlsx(simulations: Simulation[]): Promise<Uint8Array> {
  const report = consolidateSimulations(simulations);
  const { default: ExcelJS } = await import("exceljs/dist/exceljs.min.js");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Modblue Controladoria";
  const tab = workbook.addWorksheet("Consolidado", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  tab.addRow(["Linha", ...report.months.map(monthLabel), "Total original", "Total simulado", "Variação"]);
  tab.addRows(report.rows.map((row, i) => [row.label, ...row.values.map(value => value / 100), report.original[i].total / 100, row.total / 100, (row.total - report.original[i].total) / 100]));
  tab.columns.forEach((column, index) => { column.width = index ? 22 : 42; if (index) column.numFmt = moneyFormat; });
  tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  tab.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123047" } };
  tab.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  for (const [index, simulation] of simulations.entries()) {
    const source = new ExcelJS.Workbook();
    await source.xlsx.load(new Uint8Array(await simulationXlsx(simulation)).buffer);
    source.eachSheet(sheet => {
      const name = `${index + 1} ${sheet.name}`.slice(0, 31);
      const target = workbook.addWorksheet(name);
      target.model = { ...sheet.model, id: target.id, name };
    });
    await yieldTask();
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function downloadSimulation(simulation: Simulation | Simulation[], format: "pdf" | "xlsx") {
  const bytes = format === "pdf" ? await simulationPdf(simulation) : Array.isArray(simulation) ? await consolidatedSimulationXlsx(simulation) : await simulationXlsx(simulation);
  const blob = new Blob([new Uint8Array(bytes)], { type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  const label = Array.isArray(simulation) ? "Consolidado" : `${simulation.companyName}-${simulation.name}`;
  anchor.href = url; anchor.download = `DRE-Simulacao-${label}`.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 150) + `.${format}`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
