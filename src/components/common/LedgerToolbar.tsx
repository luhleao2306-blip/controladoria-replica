import { Download, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { ledgerCsv, ledgerTotals } from "@/lib/ledger";
import type { Transaction } from "@/data/mock";
import { financialAmountClass } from "@/lib/financial-semantics";

export function LedgerToolbar({ rows, query, onQueryChange, type, scope }: {
  rows: Transaction[]; query: string; onQueryChange: (value: string) => void;
  type: "revenue" | "expense"; scope: string;
}) {
  const totals = ledgerTotals(rows);
  function download() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", ledgerCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `somus-${scope}-${type === "revenue" ? "receitas" : "despesas"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-0 flex-1 basis-60">
        <Search aria-hidden className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input type="text" role="searchbox" inputMode="search" aria-label="Buscar lançamentos" placeholder="Buscar lançamentos" value={query} onChange={(event) => onQueryChange(event.target.value)} className="h-10 pl-9 pr-10" />
        {query && <button type="button" title="Limpar busca" aria-label="Limpar busca" onClick={() => onQueryChange("")} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded hover:bg-muted"><X className="h-4 w-4" /></button>}
      </div>
      <Button variant="outline" disabled={!rows.length} onClick={download}><Download className="h-4 w-4" /> Exportar CSV</Button>
    </div>
    <dl className="grid grid-cols-1 gap-3 border-y border-border py-4 sm:grid-cols-3">
      {[["Valor total", totals.amount], [type === "revenue" ? "Recebido" : "Pago", totals.paid], ["Em aberto", totals.open]].map(([label, cents]) => <div key={String(label)} className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={`mt-1 break-words text-lg font-semibold tabular-nums ${financialAmountClass(Number(cents))}`}>{formatBRL(Number(cents) / 100)}</dd>
      </div>)}
    </dl>
  </div>;
}
