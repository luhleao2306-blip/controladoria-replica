import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatBRL, formatDate } from "@/lib/format";
import type { DreIssue } from "@/lib/dre-checks";
import { financialAmountClass } from "@/lib/financial-semantics";
import { TransactionDetails } from "./TransactionDetails";

export function DreAttention({ issues, label = "DRE" }: { issues: DreIssue[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(30);
  if (!issues.length) return null;
  return <Dialog open={open} onOpenChange={setOpen}>
    <button type="button" onClick={() => setOpen(true)} aria-label={`Conferir pendências de ${label}`}
      title={`${issues.length} pendências para conferir`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-warning hover:bg-warning/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning">
      <HelpCircle size={18} />
    </button>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Pendências de {label}</DialogTitle>
        <DialogDescription>{issues.length} pontos de atenção no recorte selecionado. {issues.some(issue => issue.excluded) ? "Há categorias fora do Resultado, aguardando classificação." : "Os valores precisam de conferência na origem."}</DialogDescription>
      </DialogHeader>
      <div className="divide-y divide-border">
        {issues.slice(0, limit).map(issue => <section key={issue.key} className="min-w-0 py-4">
          <h3 className="break-words text-sm font-semibold text-warning">{issue.title}</h3>
          <p className="mt-1 break-words text-sm">{issue.category}{issue.company ? ` · ${issue.company.toUpperCase()}` : ""}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{issue.message}</p>
          {issue.transactions.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{issue.transactions.length} lançamentos envolvidos</p>}
          {issue.transactions.slice(0, limit).map(t => <div key={`${t.company}:${t.id}`} className="mt-2 flex items-start justify-between gap-3 text-xs">
            <div className="min-w-0 break-words"><p>{t.party}</p><p className="text-muted-foreground">{t.description}</p>
              <p className="text-muted-foreground">{formatDate(t.competencyDate || t.date)}</p></div>
            <div className="flex shrink-0 items-center gap-1"><span className={`tabular-nums ${financialAmountClass((t.type === "revenue" ? 1 : -1) * t.amount)}`}>{formatBRL((t.type === "revenue" ? 1 : -1) * t.amount)}</span><TransactionDetails transaction={t} /></div>
          </div>)}
          {issue.transactions.length > limit && <button type="button" onClick={() => setLimit(value => value + 30)} className="mt-2 text-xs underline">Mostrar mais lançamentos ({issue.transactions.length - limit})</button>}
        </section>)}
      </div>
      {issues.length > limit && <button type="button" onClick={() => setLimit(value => value + 30)} className="rounded border px-3 py-2 text-sm hover:bg-muted">Mostrar mais pendências ({issues.length - limit})</button>}
    </DialogContent>
  </Dialog>;
}
