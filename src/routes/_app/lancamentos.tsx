import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, FileUp, Loader2, Pencil, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useFilters } from "@/context/FiltersContext";
import { useAppUserId } from "@/context/AppUserContext";
import { selectedCompanies } from "@/lib/filter-options";
import { PageHeader } from "@/components/layout/PageHeader";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/common/DataTable";
import { formatBRL, formatDate } from "@/lib/format";
import { financialAmountClass } from "@/lib/financial-semantics";
import { MANUAL_COMPANY_ID } from "@/lib/manual-company";
import { getManualCompanyData, changeManualCompanyData } from "@/lib/manual-finance.functions";
import { MANUAL_GROUPS, manualEntrySchema, type ManualEntry, type StoredManualEntry, type ManualChange } from "@/lib/manual-finance";
import { manualMoneyCents, type parseManualRows } from "@/lib/manual-import";
import { refreshManualCompanyData } from "@/data/live-sync";

export const Route = createFileRoute("/_app/lancamentos")({ head: () => ({ meta: [{ title: "Lancamentos manuais - Modblue" }] }), component: ManualPage });
const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";
const field = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";
type Preview = ReturnType<typeof parseManualRows>;

function ManualPage() {
  const filters = useFilters(), userId = useAppUserId(), cache = useQueryClient();
  const selected = selectedCompanies(filters);
  const allowed = selected.length === 1 && selected[0] === "manual-test" && filters.companyOptions.some(company => company.id === "manual-test");
  const key = ["manual-finance", userId, MANUAL_COMPANY_ID];
  const query = useQuery({ queryKey: key, queryFn: () => getManualCompanyData({ data: { companyId: MANUAL_COMPANY_ID } }), enabled: allowed, staleTime: Infinity });
  const [editing, setEditing] = useState<ManualEntry | "new" | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null), [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false), [showArchived, setShowArchived] = useState(false), [search, setSearch] = useState("");
  const [archive, setArchive] = useState<StoredManualEntry | null>(null), [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const view = query.data;
  const canWrite = !!view?.canWrite;
  async function reload() {
    setBusy(true); setError("");
    try { const result = await refreshManualCompanyData(); cache.setQueryData(key, result); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao recarregar"); }
    finally { setBusy(false); }
  }
  async function change(change: Pick<ManualChange, "action"> & Partial<Pick<ManualChange, "entries" | "ids" | "replaceExisting">>) {
    if (!view || !allowed || busy) return false;
    setBusy(true); setError("");
    try {
      const result = await changeManualCompanyData({ data: { companyId: MANUAL_COMPANY_ID, revision: view.revision,
        requestId: crypto.randomUUID(), entries: [], ids: [], replaceExisting: false, ...change } });
      // The mutation succeeded even if reading the new view fails; never resubmit it automatically.
      try { const updated = await refreshManualCompanyData(); cache.setQueryData(key, updated); }
      catch { await cache.invalidateQueries({ queryKey: key }); toast.info("Salvo no servidor. Recarregue esta tela para conferir a nova leitura."); }
      toast.success(`${result.saved} lancamentos salvos${result.skipped ? `; ${result.skipped} identificadores existentes ignorados` : ""}.`);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Nao foi possivel salvar"); return false; }
    finally { setBusy(false); }
  }
  async function importFile(file: File) {
    setBusy(true); setError(""); setPreview(null); setReplaceExisting(false);
    try { const { readManualWorkbook } = await import("@/lib/manual-import"); setPreview(await readManualWorkbook(file)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Arquivo invalido"); }
    finally { setBusy(false); }
  }
  const entries = view?.entries ?? [];
  const visible = entries.filter(entry => Boolean(entry.deletedAt) === showArchived && `${entry.id} ${entry.description} ${entry.party} ${entry.category}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const active = entries.filter(entry => !entry.deletedAt), totals = (type: ManualEntry["type"]) => active.filter(entry => entry.type === type).reduce((sum, entry) => sum + entry.amountCents, 0) / 100;
  const columns: Column<StoredManualEntry>[] = [
    { key: "id", header: "ID / Competencia", cell: entry => <><p>{entry.id}</p><p className="text-xs text-muted-foreground">{formatDate(entry.competenceDate)}</p></> },
    { key: "description", header: "Lancamento", cell: entry => <><p>{entry.description}</p><p className="text-xs text-muted-foreground">{entry.party}</p></> },
    { key: "category", header: "Categoria / Grupo DRE", cell: entry => <><p>{entry.category}</p><p className="text-xs text-muted-foreground">{MANUAL_GROUPS.find(group => group[0] === entry.group)?.[1]}</p></> },
    { key: "due", header: "Vencimento / Conta", cell: entry => <><p>{formatDate(entry.dueDate)}</p><p className="text-xs text-muted-foreground">{entry.account} · {entry.paidCents === entry.amountCents ? "Liquidado" : entry.paidCents ? "Parcial" : "Em aberto"}</p></> },
    { key: "amount", header: "Valor / Liquidado", className: "text-right", cell: entry => <><p className={financialAmountClass(entry.type === "revenue" ? entry.amountCents : -entry.amountCents)}>{formatBRL((entry.type === "revenue" ? 1 : -1) * entry.amountCents / 100)}</p><p className="text-xs text-muted-foreground">{formatBRL(entry.paidCents / 100)}</p></> },
    { key: "actions", header: "", cell: entry => canWrite && <div className="flex gap-1">
      {!entry.deletedAt && <button type="button" className="p-2 hover:bg-muted" disabled={busy} title="Editar lancamento" aria-label={`Editar ${entry.id}`} onClick={() => setEditing(manualEntrySchema.parse(Object.fromEntries(Object.entries(entry).filter(([key]) => !["updatedAt", "updatedBy", "deletedAt"].includes(key)))))}><Pencil size={16} /></button>}
      <button type="button" className="p-2 hover:bg-muted" disabled={busy} title={entry.deletedAt ? "Restaurar" : "Arquivar"} aria-label={`${entry.deletedAt ? "Restaurar" : "Arquivar"} ${entry.id}`} onClick={() => entry.deletedAt ? void change({ action: "restore", ids: [entry.id] }) : setArchive(entry)}>{entry.deletedAt ? <RotateCcw size={16} /> : <Archive size={16} />}</button>
    </div> },
  ];
  return <>
    <PageHeader title="Lançamentos manuais" description={allowed ? "Empresa Teste · Histórico completo" : "Selecione apenas a Empresa Teste"} />
    {!allowed ? <p className="py-6 text-sm text-muted-foreground">Cadastro manual disponível somente na Empresa Teste. As empresas conectadas ao Conta Azul permanecem sem alterações.</p> : <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !canWrite} onClick={() => setEditing("new")}><Plus size={16} />Novo lançamento</button>
        <a className={button} href="/modelos/modelo-lancamentos-modblue.xlsx" download><Download size={16} />Modelo Excel</a>
        <button type="button" className={button} disabled={busy || !canWrite} onClick={() => fileInput.current?.click()}><FileUp size={16} />Importar Excel</button>
        <input ref={fileInput} className="hidden" type="file" accept=".xlsx" aria-label="Planilha de lancamentos" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
        <button type="button" className={button} disabled={busy} onClick={() => void reload()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}Recarregar</button>
        <Link className={button} to="/dre">DRE</Link><Link className={button} to="/fluxo-caixa">Fluxo de Caixa</Link>
      </div>
      {(query.error || error) && <p role="alert" className="mb-4 border-l-2 border-destructive p-3 text-sm">{error || (query.error instanceof Error ? query.error.message : "Falha ao carregar")}</p>}
      {query.isPending ? <p role="status">Carregando lançamentos...</p> : view && <>
        <dl className="mb-6 grid grid-cols-1 gap-5 border-y border-border py-4 sm:grid-cols-3">
          {[["Entradas cadastradas", totals("revenue")], ["Saídas cadastradas", -totals("expense") || 0], ["Lançamentos ativos", active.length]].map(([label, value], i) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`mt-1 break-words text-2xl font-semibold tabular-nums ${i < 2 ? financialAmountClass(Number(value)) : ""}`}>{i < 2 ? formatBRL(Number(value)) : value}</dd></div>)}
        </dl>
        <div className="mb-3 flex flex-wrap items-center gap-3"><input className={`${field} max-w-sm`} aria-label="Buscar lancamentos manuais" placeholder="Buscar lançamento, categoria ou ID" value={search} onChange={event => setSearch(event.target.value)} /><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Arquivados</label><span className="ml-auto text-xs text-muted-foreground">Revisão {view.revision}</span></div>
        {visible.length ? <DataTable columns={columns} rows={visible} rowKey={entry => entry.id} resetKey={`${search}:${showArchived}`} />
          : <p role="status" className="border-t border-border py-12 text-center text-sm text-muted-foreground">{showArchived ? "Nenhum lançamento arquivado" : "Nenhum lançamento cadastrado"}</p>}
      </>}
    </>}
    <Dialog open={allowed && editing !== null} onOpenChange={open => { if (!busy && !open) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{editing === "new" ? "Novo lançamento" : "Editar lançamento"}</DialogTitle></DialogHeader>
      {editing && <EntryForm key={editing === "new" ? "new" : editing.id} entry={editing === "new" ? undefined : editing} categories={active} busy={busy} onSave={async entry => { if (await change({ action: "save", entries: [entry], replaceExisting: editing !== "new" })) setEditing(null); }} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </DialogContent></Dialog>
    <Dialog open={allowed && preview !== null} onOpenChange={open => { if (!busy && !open) setPreview(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>Conferir importação · Empresa Teste</DialogTitle></DialogHeader>
      {preview && <><p className="text-sm">{preview.entries.length} linhas válidas · {preview.errors.length} erros · {preview.entries.filter(entry => entries.some(current => current.id === entry.id)).length} IDs já cadastrados</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview.errors.length > 0 && <div role="alert" className="max-h-44 overflow-y-auto border-l-2 border-destructive p-3 text-sm">{preview.errors.map(error => <p key={error.row}>Linha {error.row}: {error.message}</p>)}</div>}
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={replaceExisting} disabled={busy} onChange={event => setReplaceExisting(event.target.checked)} />Atualizar lançamentos que já possuem o mesmo identificador</label>
        <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr>{["ID", "Descrição", "Categoria", "Tipo", "Valor"].map(name => <th key={name} className="px-2 py-2 text-left">{name}</th>)}</tr></thead><tbody>{preview.entries.slice(0, 100).map(entry => <tr key={entry.id} className="border-t border-border"><td className="p-2">{entry.id}</td><td className="p-2">{entry.description}</td><td className="p-2">{entry.category}</td><td className="p-2">{entry.type === "revenue" ? "Entrada" : "Saída"}</td><td className="p-2 text-right tabular-nums">{formatBRL(entry.amountCents / 100)}</td></tr>)}</tbody></table></div>
        {preview.entries.length > 100 && <p className="text-xs text-muted-foreground">Prévia das primeiras 100 linhas; as {preview.entries.length} linhas válidas serão processadas.</p>}
        <button type="button" className={button} disabled={busy || !canWrite || !!preview.errors.length || !preview.entries.length} onClick={async () => { if (await change({ action: "import", entries: preview.entries, replaceExisting })) setPreview(null); }}><FileUp size={16} />Confirmar importação</button>
      </>}
    </DialogContent></Dialog>
    <Dialog open={allowed && archive !== null} onOpenChange={open => { if (!busy && !open) setArchive(null); }}><DialogContent><DialogHeader><DialogTitle>Arquivar lançamento?</DialogTitle></DialogHeader><p className="text-sm">{archive?.description}. O lançamento sairá dos resultados desta empresa e poderá ser restaurado.</p><button type="button" className={button} disabled={busy} onClick={async () => { if (archive && await change({ action: "archive", ids: [archive.id] })) setArchive(null); }}><Archive size={16} />Arquivar</button></DialogContent></Dialog>
  </>;
}

function EntryForm({ entry, categories, busy, onSave }: { entry?: ManualEntry; categories: StoredManualEntry[]; busy: boolean; onSave: (entry: ManualEntry) => Promise<void> }) {
  const [type, setType] = useState<ManualEntry["type"]>(entry?.type ?? "revenue"), [group, setGroup] = useState(entry?.group ?? "grossRevenue");
  const [error, setError] = useState("");
  const [newId] = useState(() => crypto.randomUUID());
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = manualEntrySchema.safeParse({ id: entry?.id ?? values.id, type, group, description: values.description, party: values.party,
        category: values.category, costCenter: values.costCenter, account: values.account, competenceDate: values.competenceDate,
        dueDate: values.dueDate, paymentDate: values.paymentDate, amountCents: manualMoneyCents(values.amount), paidCents: manualMoneyCents(values.paid) });
      if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
      await onSave(result.data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Confira os campos"); }
  }
  const input = (name: string, label: string, value: string, options: { type?: string; required?: boolean; list?: string; maxLength?: number } = {}) => <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">{label}<input className={field} name={name} defaultValue={value} type={options.type ?? "text"} required={options.required !== false} list={options.list} maxLength={options.maxLength ?? 200} disabled={busy || name === "id" && !!entry} /></label>;
  return <form className="space-y-4" onSubmit={event => void submit(event)}>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {input("id", "Identificador", entry?.id ?? newId, { maxLength: 80 })}
      <label className="grid gap-1 text-xs text-muted-foreground">Tipo<select className={field} value={type} disabled={busy} onChange={event => { const next = event.target.value as ManualEntry["type"]; setType(next); setGroup(next === "revenue" ? "grossRevenue" : "operationalExpenses"); }}><option value="revenue">Entrada</option><option value="expense">Saída</option></select></label>
      {input("description", "Descrição", entry?.description ?? "", { maxLength: 500 })}{input("party", "Cliente / fornecedor", entry?.party ?? "")}
      {input("category", "Categoria", entry?.category ?? "", { list: "manual-categories" })}
      <datalist id="manual-categories">{[...new Set(categories.filter(entry => entry.type === type).map(entry => entry.category))].map(category => <option key={category} value={category} />)}</datalist>
      <label className="grid gap-1 text-xs text-muted-foreground">Grupo DRE<select className={field} value={group} disabled={busy} onChange={event => setGroup(event.target.value as ManualEntry["group"])}>{MANUAL_GROUPS.filter(item => item[2] === type).map(item => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></label>
      {input("costCenter", "Centro de custo", entry?.costCenter ?? "", { required: false })}{input("account", "Conta financeira", entry?.account ?? "Caixa")}
      {input("competenceDate", "Competência", entry?.competenceDate ?? today, { type: "date" })}{input("dueDate", "Vencimento", entry?.dueDate ?? today, { type: "date" })}
      {input("amount", "Valor total (R$)", entry ? String(entry.amountCents / 100) : "")}{input("paid", "Valor pago / recebido (R$)", entry ? String(entry.paidCents / 100) : "0")}
      {input("paymentDate", "Data do pagamento / recebimento", entry?.paymentDate ?? "", { type: "date", required: false })}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="submit" className={button} disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Salvar lançamento</button>
  </form>;
}
