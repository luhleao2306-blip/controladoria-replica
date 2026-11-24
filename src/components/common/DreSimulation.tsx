import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, FileDown, FileSpreadsheet, ListTree, Loader2, Pencil, Plus, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "./EmptyState";
import { formatBRL, formatDate, MONTHS_PT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { financialAmountClass } from "@/lib/financial-semantics";
import { DRE_BUCKETS, DRE_BUCKET_LABELS, type DreBucket } from "@/lib/dre-rows";
import { addSimulationEntry, createSimulation, parseSimulationAmount, patchSimulation, setSimulationCell, simulationChanged,
  simulationEntries, simulationGroups, simulationRows, simulationSourceMatches, refreshUneditedSimulation, type Simulation, type SimulationEntry, type SimulationGroup } from "@/lib/dre-simulation";
import type { MonthlyKpi, Transaction } from "@/data/mock";
import type { FiltersState } from "@/context/FiltersContext";
import { CategorySort } from "./CategorySort";
import { compareCategories, type CategoryOrder } from "@/lib/dre-details";

type Editor = { kind: "cell"; line: string; label: string; month: string; value: number; group?: SimulationGroup }
  | { kind: "entry"; entry: SimulationEntry } | { kind: "new" };
const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";
const field = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const monthLabel = (month: string) => `${MONTHS_PT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const decimal = (value: number) => (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DreSimulation({ company, filters, data, transactions, initial, onDraft, hidden = false }: {
  company: { id: Simulation["company"]; name: string }; filters: FiltersState; data: MonthlyKpi[]; transactions: Transaction[];
  initial?: Simulation; onDraft: (draft: Simulation) => void; hidden?: boolean;
}) {
  const filterDescription = JSON.stringify({
    company: company.id, years: filters.years ?? [filters.year], months: filters.months ?? filters.month, quarters: filters.quarters ?? filters.quarter,
    category: filters.categories ?? filters.category, costCenter: filters.costCenters ?? filters.costCenter, accounts: filters.financialAccounts ?? filters.financialAccount,
    payment: filters.payments ?? filters.payment, dateRanges: filters.dateRanges, start: filters.customStart, end: filters.customEnd,
    basis: filters.basis, includeOpenCash: filters.includeOpenCash,
  });
  const latestSource = useMemo(() => createSimulation(company.id, company.name, filters.basis, filterDescription, data, transactions),
    [company.id, company.name, filters.basis, filterDescription, data, transactions]);
  const [history, setHistory] = useState(() => ({ past: [] as Simulation[], current: initial ?? latestSource, future: [] as Simulation[] }));
  const simulation = history.current;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<CategoryOrder>("amount-desc");
  const [editor, setEditor] = useState<Editor | null>(null), [reset, setReset] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const entries = useMemo(() => simulationEntries(simulation), [simulation]);
  const rows = useMemo(() => simulationRows(simulation), [simulation]);
  const original = useMemo(() => simulationRows(simulation, true), [simulation]);
  const groups = useMemo(() => new Map(rows.filter(row => !row.emphasis).map(row => [row.key,
    simulationGroups(simulation, row.key).sort((a, b) => compareCategories(a, b, order))])), [simulation, rows, order]);
  const changes = entries.filter(simulationChanged).length;
  const sourceChanged = useMemo(() => !simulationSourceMatches(simulation, latestSource), [simulation.original, simulation.months, simulation.filters, simulation.company, simulation.basis, latestSource]);
  useEffect(() => {
    if (!sourceChanged || changes) return;
    setHistory(state => { const current = refreshUneditedSimulation(state.current, latestSource);
      return current === state.current ? state : { past: [], current, future: [] }; });
  }, [sourceChanged, changes, latestSource]);
  const result = rows.find(row => row.key === "result")!.total, originalResult = original.find(row => row.key === "result")!.total;
  useEffect(() => { onDraft(simulation); }, [simulation, onDraft]);
  useEffect(() => {
    if (!changes) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);
  const update = (next: Simulation) => setHistory(state => next === state.current ? state : ({ past: [...state.past.slice(-39), state.current], current: next, future: [] }));
  const toggle = (key: string) => setOpen(state => ({ ...state, [key]: !state[key] }));
  const exportFile = async (format: "pdf" | "xlsx") => {
    if (exporting) return;
    setExporting(format);
    try {
      const { downloadSimulation } = await import("@/lib/dre-simulation-export");
      await downloadSimulation(simulation, format);
      toast.success(format === "pdf" ? "PDF das alterações gerado." : "Planilha completa gerada.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível gerar o arquivo."); }
    finally { setExporting(null); }
  };
  if (hidden) return null;
  if (!data.length) return <section aria-label={company.name}><h2 className="mb-3 text-lg font-semibold">{company.name}</h2><EmptyState /></section>;
  const cell = (value: number, title: string, edit?: () => void, previous?: number) => <td className={cn("min-w-36 whitespace-nowrap px-3 py-2 text-right tabular-nums", financialAmountClass(value / 100))}>
    {edit ? <button type="button" title={title} aria-label={title} onClick={edit} className="group inline-flex w-full items-center justify-end gap-2 rounded-sm hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      <Pencil size={12} className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />{formatBRL(value / 100)}
    </button> : formatBRL(value / 100)}
    {previous !== undefined && value !== previous && <div className="text-[10px] text-muted-foreground">Original {formatBRL(previous / 100)}</div>}
  </td>;
  return <section aria-label={`Simulação ${company.name}`} className="min-w-0 border-t border-border pt-4">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{company.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="rounded border border-primary/40 px-2 py-1 text-primary">SIMULAÇÃO</span><span>Base de {new Date(simulation.createdAt).toLocaleString("pt-BR")}</span><span>{changes} alterações</span></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" aria-label="Desfazer alteração" title="Desfazer alteração" disabled={!history.past.length || !!exporting} onClick={() => setHistory(state => ({ past: state.past.slice(0, -1), current: state.past.at(-1)!, future: [state.current, ...state.future] }))}><Undo2 size={16} /></button>
        <button className={button} type="button" aria-label="Refazer alteração" title="Refazer alteração" disabled={!history.future.length || !!exporting} onClick={() => setHistory(state => ({ past: [...state.past, state.current], current: state.future[0], future: state.future.slice(1) }))}><Redo2 size={16} /></button>
        <button className={button} type="button" disabled={!!exporting} onClick={() => setReset(true)}><RotateCcw size={16} />Novo cenário</button>
        <button className={button} type="button" disabled={!!exporting} onClick={() => setEditor({ kind: "new" })}><Plus size={16} />Adicionar ajuste</button>
        <button className={button} type="button" title={changes ? "Exportar somente alterações" : "Nenhuma alteração neste cenário"} disabled={!!exporting || !changes} onClick={() => void exportFile("pdf")}>{exporting === "pdf" ? <Loader2 className="animate-spin" size={16} /> : <FileDown size={16} />}PDF das alterações</button>
        <button className={button} type="button" disabled={!!exporting} onClick={() => void exportFile("xlsx")}>{exporting === "xlsx" ? <Loader2 className="animate-spin" size={16} /> : <FileSpreadsheet size={16} />}Planilha</button>
      </div>
    </div>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <label className="grid w-full max-w-xs gap-1 text-xs text-muted-foreground">Cenário<input className={field} aria-label={`Nome do cenário ${company.name}`} maxLength={100} value={simulation.name} onChange={event => update({ ...simulation, name: event.target.value })} /></label>
      <dl className="flex flex-wrap gap-x-6 gap-y-3 text-right text-xs"><div><dt className="text-muted-foreground">Resultado original</dt><dd className="mt-1 text-base font-semibold tabular-nums">{formatBRL(originalResult / 100)}</dd></div>
        <div><dt className="text-muted-foreground">Resultado simulado</dt><dd className={cn("mt-1 text-base font-semibold tabular-nums", financialAmountClass(result / 100))}>{formatBRL(result / 100)}</dd></div>
        <div><dt className="text-muted-foreground">Variação</dt><dd className={cn("mt-1 text-base font-semibold tabular-nums", financialAmountClass((result - originalResult) / 100))}>{formatBRL((result - originalResult) / 100)}</dd></div></dl>
    </div>
    {rows.find(row => row.key === "unclassified")!.values.some(value => value !== 0) && <p role="status" className="mb-3 border-l-2 border-warning p-2 text-sm">Resultado parcial: há valores sem classificação DRE.</p>}
    {sourceChanged && changes > 0 && <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 border-l-2 border-warning p-2 text-sm"><span>A base principal mudou. Este cenário mantém os dados e ajustes anteriores.</span><button type="button" className={button} onClick={() => setReset(true)}><RotateCcw size={14} />Recriar com base atual</button></div>}
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <button className={button} type="button" title="Expandir categorias" aria-label="Expandir categorias" onClick={() => setOpen(Object.fromEntries(rows.filter(row => !row.emphasis).map(row => [row.key, true])))}><ListTree size={16} /></button>
      <button className={button} type="button" title="Recolher detalhes" aria-label="Recolher detalhes" onClick={() => setOpen({})}><ChevronsDownUp size={16} /></button>
      <span className="text-xs text-muted-foreground">{simulation.original.length} itens na base · {simulation.additions.length} ajustes</span>
      <div className="ml-auto"><CategorySort value={order} onChange={setOrder} /></div>
    </div>
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[980px] text-sm" aria-label={`DRE Simulação ${company.name}`}>
        <thead className="sticky top-0 z-20 bg-card text-xs text-muted-foreground"><tr>
          <th className="sticky left-0 z-30 min-w-64 bg-card px-4 py-3 text-left">Linha / categoria / lançamento</th>
          {simulation.months.map(month => <th key={month} className="min-w-36 whitespace-nowrap px-3 py-3 text-right">{monthLabel(month)}</th>)}
          <th className="min-w-36 whitespace-nowrap px-3 py-3 text-right">Total original</th><th className="min-w-36 whitespace-nowrap bg-primary/10 px-3 py-3 text-right">Total simulado</th><th className="min-w-36 whitespace-nowrap px-3 py-3 text-right">Variação</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => <Fragment key={row.key}>
          <tr className={cn("border-t border-border/50 hover:bg-muted/20", row.emphasis && "bg-primary/5 font-semibold")}>
            <th className="sticky left-0 z-10 max-w-80 bg-card px-4 py-2 text-left font-inherit"><button type="button" disabled={!groups.get(row.key)?.length} aria-expanded={Boolean(open[row.key])} onClick={() => toggle(row.key)} className="flex items-start gap-2 text-left">
              {groups.get(row.key)?.length ? open[row.key] ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" /> : <span className="w-3.5 shrink-0" />}{row.label}</button></th>
            {row.values.map((value, monthIndex) => <Fragment key={simulation.months[monthIndex]}>{cell(value, `Editar ${row.label}, ${monthLabel(simulation.months[monthIndex])}`,
              row.emphasis || exporting ? undefined : () => setEditor({ kind: "cell", line: row.key, label: row.label, month: simulation.months[monthIndex], value }), original[index].values[monthIndex])}</Fragment>)}
            {cell(original[index].total, "Original")}{cell(row.total, "Simulado")}{cell(row.total - original[index].total, "Variação")}
          </tr>
          {open[row.key] && groups.get(row.key)?.map(group => {
            const key = `${row.key}:${group.key}`, limit = limits[key] ?? 50;
            return <Fragment key={group.key}><tr className="border-t border-border/40 bg-muted/20">
              <th className="sticky left-0 z-10 max-w-80 break-words bg-card px-4 py-2 pl-8 text-left font-normal"><button type="button" aria-expanded={Boolean(open[key])} onClick={() => toggle(key)} className="flex items-start gap-2 text-left">{open[key] ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" />}<span>{group.category} <span className="text-xs text-muted-foreground">({group.entries.length})</span></span></button></th>
              {group.values.map((value, i) => <Fragment key={simulation.months[i]}>{cell(value, `Editar ${group.category}, ${monthLabel(simulation.months[i])}`, exporting ? undefined : () => setEditor({ kind: "cell", line: row.key, label: group.category, month: simulation.months[i], value, group }))}</Fragment>)}
              {cell(simulation.original.filter(entry => entry.bucket === group.bucket && entry.category === group.category).reduce((sum, entry) => sum + entry.originalCents, 0), "Original")}{cell(group.total, "Simulado")}{cell(group.total - simulation.original.filter(entry => entry.bucket === group.bucket && entry.category === group.category).reduce((sum, entry) => sum + entry.originalCents, 0), "Variação")}
            </tr>
            {open[key] && group.entries.slice(0, limit).map(entry => <tr key={entry.id} className={cn("border-t border-border/30", entry.excluded && "opacity-50")}>
              <td className="sticky left-0 z-10 max-w-80 break-words bg-card px-4 py-2 pl-12"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div>{entry.party}</div><div className="text-xs text-muted-foreground">{entry.description || "Não informado na origem"}</div><div className="mt-1 text-xs text-muted-foreground">{formatDate(entry.date)} · {entry.excluded ? "Excluído do cenário" : entry.added ? "Ajuste" : entry.status}</div></div>
                <div className="flex shrink-0 flex-col gap-1"><button className="rounded p-1 hover:bg-muted" type="button" disabled={!!exporting} title="Editar lançamento" aria-label={`Editar lançamento ${entry.description || entry.party}`} onClick={() => setEditor({ kind: "entry", entry })}><Pencil size={14} /></button>
                  <button className="rounded p-1 hover:bg-muted" type="button" disabled={!!exporting} title={entry.excluded ? "Restaurar no cenário" : "Excluir do cenário"} aria-label={`${entry.excluded ? "Restaurar" : "Excluir"} ${entry.description || entry.party}`} onClick={() => update(patchSimulation(simulation, entry.id, { excluded: !entry.excluded }))}>{entry.excluded ? <RotateCcw size={14} /> : <Trash2 size={14} />}</button></div></div></td>
              {simulation.months.map(month => <Fragment key={month}>{cell(entry.month === month && !entry.excluded ? entry.amountCents : 0, "Valor do lançamento")}</Fragment>)}
              {cell(entry.originalCents, "Original")}{cell(entry.excluded ? 0 : entry.amountCents, "Simulado")}{cell((entry.excluded ? 0 : entry.amountCents) - entry.originalCents, "Variação")}
            </tr>)}
            {open[key] && group.entries.length > limit && <tr><td colSpan={simulation.months.length + 4} className="p-3 text-center"><button className={button} onClick={() => setLimits(state => ({ ...state, [key]: limit + 100 }))} type="button">Mostrar mais ({group.entries.length - limit})</button></td></tr>}
            </Fragment>;
          })}
        </Fragment>)}</tbody>
      </table>
    </div>
    {editor && <SimulationEditor editor={editor} simulation={simulation} onClose={() => setEditor(null)} onSave={next => { update(next); setEditor(null); }} />}
    <Dialog open={reset} onOpenChange={setReset}><DialogContent className="max-w-[min(32rem,calc(100vw-2rem))]"><DialogHeader><DialogTitle>Novo cenário</DialogTitle><DialogDescription>{changes ? "Os ajustes deste cenário serão descartados. O DRE principal permanece intacto." : "Criar um cenário com a leitura atual do DRE."}</DialogDescription></DialogHeader><DialogFooter><button type="button" className={button} onClick={setReset.bind(null, false)}>Cancelar</button><button type="button" className={button} onClick={() => { update(latestSource); setOpen({}); setReset(false); }}>Criar cenário</button></DialogFooter></DialogContent></Dialog>
  </section>;
}

function SimulationEditor({ editor, simulation, onClose, onSave }: { editor: Editor; simulation: Simulation; onClose: () => void; onSave: (next: Simulation) => void }) {
  const entry = editor.kind === "entry" ? editor.entry : undefined;
  const [amount, setAmount] = useState(decimal(editor.kind === "cell" ? editor.value : entry?.amountCents ?? 0));
  const [bucket, setBucket] = useState<DreBucket>(entry?.bucket ?? "grossRevenue");
  const [month, setMonth] = useState(entry?.month ?? (editor.kind === "cell" ? editor.month : simulation.months[0]));
  const [category, setCategory] = useState(entry?.category ?? "Ajuste da simulação"), [description, setDescription] = useState(entry?.description ?? "");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const amountCents = parseSimulationAmount(amount);
      onSave(editor.kind === "cell" ? setSimulationCell(simulation, editor.line, editor.month, amountCents, editor.group)
        : editor.kind === "entry" ? patchSimulation(simulation, editor.entry.id, { amountCents, bucket, month, category: category.trim(), description })
        : addSimulationEntry(simulation, { id: `manual:${crypto.randomUUID()}`, amountCents, bucket, month, category: category.trim(), description }));
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível aplicar o ajuste."); }
  };
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-h-[90vh] max-w-[min(36rem,calc(100vw-2rem))] overflow-auto"><DialogHeader>
    <DialogTitle>{editor.kind === "cell" ? editor.label : entry ? "Editar lançamento" : "Adicionar ajuste"}</DialogTitle>
    <DialogDescription>{simulation.companyName} · {editor.kind === "cell" ? monthLabel(editor.month) : simulation.basis === "cash" ? "Caixa" : "Competência"} · Simulação</DialogDescription>
  </DialogHeader><form onSubmit={submit} className="grid min-w-0 gap-4">
    {entry && <div className="break-words text-sm"><div>{entry.party}</div><div className="text-xs text-muted-foreground">Original: {formatBRL(entry.originalCents / 100)} · {formatDate(entry.date)}{entry.account ? ` · ${entry.account}` : ""}{entry.costCenter ? ` · ${entry.costCenter}` : ""}</div></div>}
    <label className="grid gap-1 text-sm">Valor com sinal (R$)<input autoFocus className={field} aria-label="Valor simulado" inputMode="decimal" value={amount} maxLength={24} onChange={event => setAmount(event.target.value)} /></label>
    {editor.kind !== "cell" && <>
      <label className="grid gap-1 text-sm">Grupo DRE<select className={field} aria-label="Grupo DRE" value={bucket} onChange={event => setBucket(event.target.value as DreBucket)}>{DRE_BUCKETS.map(bucket => <option key={bucket} value={bucket}>{DRE_BUCKET_LABELS[bucket]}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Mês<select className={field} aria-label="Mês do ajuste" value={month} onChange={event => setMonth(event.target.value)}>{simulation.months.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Categoria<input className={field} aria-label="Categoria do ajuste" value={category} required maxLength={500} onChange={event => setCategory(event.target.value)} /></label>
      <label className="grid gap-1 text-sm">Descrição<textarea className={field} aria-label="Descrição do ajuste" value={description} maxLength={4000} rows={3} onChange={event => setDescription(event.target.value)} /></label>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><button className={button} type="button" onClick={onClose}>Cancelar</button><button className={cn(button, "border-primary bg-primary/10 text-primary")} type="submit">Aplicar ajuste</button></DialogFooter>
  </form></DialogContent></Dialog>;
}
