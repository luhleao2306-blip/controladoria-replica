import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileDown, FileSpreadsheet, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { consolidateSimulations, simulationChanges, type Simulation } from "@/lib/dre-simulation";
import { formatBRL, MONTHS_PT } from "@/lib/format";
import { financialAmountClass } from "@/lib/financial-semantics";
import { cn } from "@/lib/utils";

const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-40";
export function ConsolidatedDreSimulation({ simulations, onSeparate }: { simulations: Simulation[]; onSeparate: () => void }) {
  const report = useMemo(() => consolidateSimulations(simulations), [simulations]);
  const changes = useMemo(() => simulationChanges(simulations), [simulations]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const result = report.rows.find(row => row.key === "result")!.total;
  const originalResult = report.original.find(row => row.key === "result")!.total;
  const exportFile = async (format: "pdf" | "xlsx") => {
    if (exporting) return;
    setExporting(format);
    try {
      const { downloadSimulation } = await import("@/lib/dre-simulation-export");
      await downloadSimulation(simulations, format);
      toast.success(format === "pdf" ? "PDF das alterações gerado." : "Planilha consolidada gerada.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível gerar o arquivo."); }
    finally { setExporting(null); }
  };
  const cell = (value: number) => <td className={cn("min-w-36 whitespace-nowrap px-3 py-2 text-right tabular-nums", financialAmountClass(value / 100))}>{formatBRL(value / 100)}</td>;
  return <section aria-label="DRE Simulação consolidado" className="min-w-0 border-t border-border pt-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-lg font-semibold">Consolidado · {simulations.length} empresas</h2>
        <p className="mt-1 break-words text-xs text-muted-foreground">{simulations.map(item => item.companyName).join(" · ")}</p>
        <p className="mt-2 text-xs text-primary">SIMULAÇÃO · {changes.length} alterações</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={onSeparate}><Pencil size={16} />Editar por empresa</button>
        <button type="button" className={button} disabled={!!exporting || !changes.length} title={changes.length ? "Exportar somente alterações" : "Nenhuma alteração nos cenários"} onClick={() => void exportFile("pdf")}>{exporting === "pdf" ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}PDF das alterações</button>
        <button type="button" className={button} disabled={!!exporting} onClick={() => void exportFile("xlsx")}>{exporting === "xlsx" ? <Loader2 size={16} className="animate-spin" /> : <FileSpreadsheet size={16} />}Planilha</button>
      </div>
    </div>
    <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-3 text-xs">
      {[["Resultado original", originalResult], ["Resultado simulado", result], ["Variação", result - originalResult]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className={cn("mt-1 text-base font-semibold tabular-nums", financialAmountClass(Number(value) / 100))}>{formatBRL(Number(value) / 100)}</dd></div>)}
    </dl>
    {report.rows.find(row => row.key === "unclassified")!.values.some(value => value !== 0) && <p role="status" className="mb-3 border-l-2 border-warning p-2 text-sm">Resultado parcial: há valores sem classificação DRE.</p>}
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border"><table className="w-full min-w-[980px] text-sm" aria-label="DRE consolidado">
      <thead className="sticky top-0 z-20 bg-card text-xs text-muted-foreground"><tr><th className="sticky left-0 z-30 min-w-64 bg-card px-4 py-3 text-left">Linha / empresa</th>
        {report.months.map(month => <th key={month} className="min-w-36 whitespace-nowrap px-3 py-3 text-right">{MONTHS_PT[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</th>)}
        {["Total original", "Total simulado", "Variação"].map(label => <th key={label} className="min-w-36 whitespace-nowrap px-3 py-3 text-right">{label}</th>)}
      </tr></thead><tbody>{report.rows.map((row, index) => <Fragment key={row.key}>
        <tr className={cn("border-t border-border/50", row.emphasis && "bg-primary/5 font-semibold")}>
          <th className="sticky left-0 z-10 max-w-80 bg-card px-4 py-2 text-left"><button type="button" aria-expanded={!!open[row.key]} onClick={() => setOpen(previous => ({ ...previous, [row.key]: !previous[row.key] }))} className="flex items-start gap-2 text-left">{open[row.key] ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" />}{row.label}</button></th>
          {row.values.map((value, i) => <Fragment key={report.months[i]}>{cell(value)}</Fragment>)}{cell(report.original[index].total)}{cell(row.total)}{cell(row.total - report.original[index].total)}
        </tr>
        {open[row.key] && report.companies.map(({ simulation, rows, original }) => <tr key={simulation.company} className="border-t border-border/30 text-xs">
          <th className="sticky left-0 z-10 max-w-80 break-words bg-card px-4 py-2 pl-8 text-left font-normal"><button type="button" className="inline-flex items-center gap-2 hover:text-primary" title={`Abrir cenários por empresa: ${simulation.companyName}`} onClick={onSeparate}><Pencil size={12} className="shrink-0" />{simulation.companyName}</button></th>
          {report.months.map(month => <Fragment key={month}>{cell(rows[index].values[simulation.months.indexOf(month)] ?? 0)}</Fragment>)}{cell(original[index].total)}{cell(rows[index].total)}{cell(rows[index].total - original[index].total)}
        </tr>)}
      </Fragment>)}</tbody>
    </table></div>
  </section>;
}
