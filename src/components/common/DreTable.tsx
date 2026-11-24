import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MONTHS_PT, formatBRL, formatDate } from "@/lib/format";
import type { AccountingBasis, MonthlyKpi, Transaction } from "@/data/mock";
import { cn } from "@/lib/utils";
import { buildDreDetails, type CategoryOrder } from "@/lib/dre-details";
import { CategorySort } from "./CategorySort";
import { financialAmountClass, financialClass } from "@/lib/financial-semantics";
import { TransactionDetails } from "./TransactionDetails";
import { inspectDre } from "@/lib/dre-checks";
import { DreAttention } from "./DreAttention";
import { DRE_ROWS as ROWS } from "@/lib/dre-rows";

export function DreTable({ data, transactions = [], basis = "accrual" }: {
  data: MonthlyKpi[]; transactions?: Transaction[]; basis?: AccountingBasis;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [order, setOrder] = useState<CategoryOrder>("amount-desc");
  const groupsFor = useMemo(() => buildDreDetails(transactions, data, basis, order), [transactions, data, basis, order]);
  const issues = useMemo(() => inspectDre(transactions, data, basis, groupsFor), [transactions, data, basis, groupsFor]);
  const months = data.map((d) => `${d.year}-${String(d.monthIndex + 1).padStart(2, "0")}`);
  const toggle = (key: string) => setOpen((state) => ({ ...state, [key]: !state[key] }));
  const amount = (value: number, key?: string, label?: string) => key ? (
    <button type="button" aria-label={`Detalhar ${label}`} aria-expanded={Boolean(open[key])}
      onClick={() => toggle(key)} className="w-full rounded-sm text-right underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      {formatBRL(value)}
    </button>
  ) : formatBRL(value);

  return <>
    <div className="mb-3 flex flex-wrap justify-end"><CategorySort value={order} onChange={setOrder} /></div>
    {issues.length > 0 && <div role="status" className="mb-3 flex items-center gap-2 border-l-2 border-warning bg-warning/5 px-3 py-2 text-sm">
      <DreAttention issues={issues} />
      <p className="min-w-0 break-words">{issues.some(issue => issue.excluded) ? "Resultado parcial: há categorias sem classificação DRE." : "DRE com pendências de conferência."} <span className="text-muted-foreground">{issues.length} pontos de atenção.</span></p>
    </div>}
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
    <table className="w-full min-w-[920px] text-sm">
      <thead className="sticky top-0 z-20 bg-card text-xs text-muted-foreground"><tr>
        <th className="min-w-56 bg-card px-4 py-3 text-left md:sticky md:left-0 md:z-30">Linha</th>
        {data.map((d) => <th key={`${d.year}-${d.monthIndex}`} className="whitespace-nowrap px-3 py-3 text-right">{MONTHS_PT[d.monthIndex]} {d.year}</th>)}
        <th className="whitespace-nowrap bg-primary/10 px-4 py-3 text-right">Total</th>
      </tr></thead>
      <tbody>{ROWS.filter(row => row.key !== "unclassified" || groupsFor("unclassified").length > 0).map((row) => {
        const cells = data.map((k) => (row.negative ? -1 : 1) * Number(k[row.key] ?? 0) || 0);
        const total = cells.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100;
        const groups = groupsFor(row.key);
        const expandable = groups.length > 0;
        const isResult = ["grossProfit", "ebitda", "netProfit", "result"].includes(row.key);
        const rowIssues = issues.filter(issue => issue.lines.includes(row.key));
        return <Fragment key={row.key}>
          <tr className={cn("border-t border-border/50 hover:bg-muted/40", row.emphasis && "bg-primary/5 font-semibold")}>
            <td className="min-w-56 max-w-80 bg-card px-4 py-2 md:sticky md:left-0 md:z-10">
              <div className="flex items-start gap-1"><button type="button" disabled={!expandable} aria-expanded={expandable ? Boolean(open[row.key]) : undefined}
                onClick={() => toggle(row.key)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                {expandable ? open[row.key] ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : <span className="w-3.5" />}{row.label}
              </button><DreAttention issues={rowIssues} label={row.label} /></div>
            </td>
            {cells.map((value, i) => <td key={months[i]} className={cn("whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums", financialAmountClass(value, isResult ? "result" : "amount"))}>
              {amount(value, expandable ? row.key : undefined, `${row.label}, ${MONTHS_PT[data[i].monthIndex]} ${data[i].year}`)}
            </td>)}
            <td className={cn("whitespace-nowrap bg-primary/10 px-4 py-2 text-right font-semibold tabular-nums", isResult ? financialClass(total) : financialAmountClass(total))}>{amount(total, expandable ? row.key : undefined, `${row.label}, total`)}</td>
          </tr>
          {open[row.key] && groups.map((group) => {
            const key = `${row.key}:${group.key}`;
            const limit = limits[key] ?? 50;
            return <Fragment key={group.key}>
              <tr className="border-t border-border/40 bg-muted/20 hover:bg-muted/40">
                <td className="min-w-56 max-w-80 break-words bg-card px-4 py-2 pl-8 md:sticky md:left-0 md:z-10">
                  <button type="button" aria-expanded={Boolean(open[key])} onClick={() => toggle(key)} className="flex w-full items-start gap-1.5 text-left">
                    {open[key] ? <ChevronDown size={14} className="mt-1 shrink-0" /> : <ChevronRight size={14} className="mt-1 shrink-0" />}
                    <span>{["loanMovement", "shareholderMovement"].includes(row.key) && <span className="text-muted-foreground">{["loanReceipts", "capitalReceipts"].includes(group.bucket) ? "(+) " : "(-) "}</span>}{group.category} <span className="text-xs text-muted-foreground">({group.entries.length})</span></span>
                  </button>
                </td>
                {group.values.map((value, i) => <td key={months[i]} className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", financialAmountClass(value))}>{amount(value, key, `${group.category}, ${MONTHS_PT[data[i].monthIndex]} ${data[i].year}`)}</td>)}
                <td className={cn("whitespace-nowrap bg-primary/5 px-4 py-2 text-right tabular-nums", financialAmountClass(group.total))}>{amount(group.total, key, `${group.category}, total`)}</td>
              </tr>
              {open[key] && <>
                {group.entries.slice(0, limit).map((entry) => <tr key={`${entry.transaction.company}:${entry.transaction.id}:${entry.month}`} className="border-t border-border/30">
                  <td className="min-w-56 max-w-80 break-words bg-card px-4 py-2 pl-12 md:sticky md:left-0 md:z-10">
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0">
                      <p>{entry.transaction.party || "Nao informado na origem"}</p>
                      <p className="text-xs text-muted-foreground">{entry.transaction.description || "Descricao nao informada na origem"}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(entry.date)} · {entry.transaction.company.toUpperCase()}{basis === "cash" && (entry.transaction.source ? entry.transaction.source.outstandingAmount > 0 : entry.transaction.status !== "Pago") ? " · Em aberto (vencimento)" : ""}</p>
                    </div><TransactionDetails transaction={entry.transaction} /></div>
                  </td>
                  {months.map((month) => <td key={month} className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", financialAmountClass(month === entry.month ? entry.amount : 0))}>{month === entry.month ? formatBRL(entry.amount) : "—"}</td>)}
                  <td className={cn("whitespace-nowrap px-4 py-2 text-right tabular-nums", financialAmountClass(entry.amount))}>{formatBRL(entry.amount)}</td>
                </tr>)}
                {group.entries.length > limit && <tr><td colSpan={data.length + 2} className="px-4 py-2 text-center">
                  <button type="button" onClick={() => setLimits((state) => ({ ...state, [key]: limit + 50 }))} className="rounded border px-3 py-2 hover:bg-muted">Mostrar mais ({group.entries.length - limit})</button>
                </td></tr>}
              </>}
            </Fragment>;
          })}
        </Fragment>;
      })}</tbody>
    </table>
  </div></>;
}
