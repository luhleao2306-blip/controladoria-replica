import { useState } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Transaction } from "@/data/mock";
import { formatBRL, formatDate } from "@/lib/format";

export function transactionStatus(t: Transaction) {
  if (t.source?.origin === "initial_balance") return "Saldo inicial";
  const labels: Record<string, string> = { RECEBIDO: t.type === "expense" ? "Pago" : "Recebido",
    RECEBIDO_PARCIAL: t.type === "expense" ? "Pago parcial" : "Recebido parcial", PERDIDO: "Perdido",
    CANCELADO: "Cancelado", RENEGOCIADO: "Renegociado", EM_ABERTO: "Em aberto", ATRASADO: "Atrasado" };
  return t.source ? labels[t.source.sourceStatus] ?? t.source.sourceStatus : t.status;
}

export function TransactionDetails({ transaction: t }: { transaction: Transaction }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <button type="button" onClick={() => setOpen(true)} title="Detalhes do lancamento" aria-label="Detalhes do lancamento" className="p-2"><Info size={18} /></button>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle className="break-words">{t.description || t.party}</DialogTitle></DialogHeader>
      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-sm [&>dd]:min-w-0 [&>dd]:break-words">
        <dt>Cliente / fornecedor</dt><dd className="break-words">{t.party}</dd>
        <dt>Situacao</dt><dd>{transactionStatus(t)}</dd>
        <dt>Competencia</dt><dd>{formatDate(t.competencyDate || t.date)}</dd>
        <dt>Vencimento</dt><dd>{t.source?.origin === "initial_balance" ? "Nao se aplica ao saldo inicial" : t.dueDate ? formatDate(t.dueDate) : "Nao informado na origem"}</dd>
        <dt>Valor do recorte</dt><dd>{formatBRL(t.amount)}</dd>
        <dt>{t.source?.origin === "initial_balance" ? "Valor de abertura" : "Pago / recebido"}</dt><dd>{formatBRL(t.source?.paidAmount ?? (t.status === "Pago" ? t.amount : 0))}</dd>
        <dt>Saldo em aberto</dt><dd>{formatBRL(t.source?.outstandingAmount ?? (t.status === "Pago" ? 0 : t.amount))}</dd>
        <dt>Conta financeira</dt><dd>{t.source?.account || "Nao informada na origem"}</dd>
        {t.source?.sourceStatus === "PERDIDO" && t.source.reporting?.loss && <><dt>Data da perda</dt><dd>{formatDate(t.source.reporting.loss.date)}</dd><dt>Valor da perda na origem</dt><dd>{formatBRL(t.source.reporting.loss.amount)}</dd></>}
      </dl>
      {t.source && <>
        <h3 className="font-semibold">Rateio</h3>
        {t.source.allocations.map((a, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b py-2 text-sm">
          <span className="min-w-0 break-words">{a.category}<br /><span className="text-muted-foreground">{a.costCenter || "Centro de custo nao informado na origem"}</span></span><span className="whitespace-nowrap tabular-nums">{formatBRL(a.amount)}</span>
        </div>)}
        <h3 className="font-semibold">{t.source.origin === "initial_balance" ? "Registro de abertura" : "Baixas"}</h3>
        {t.source.payments.length ? t.source.payments.map((p) => <div key={p.id} className="border-b py-2 text-sm">
          <div className="flex justify-between gap-3"><span className="min-w-0 break-words">{formatDate(p.date)} · {p.account || "Conta nao informada"}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatBRL(p.amount)}</span></div>
          <p className="text-muted-foreground">Bruto: {formatBRL(p.gross)} · Juros: {formatBRL(p.interest)} · Multa: {formatBRL(p.fine)} · Desconto: {formatBRL(p.discount)} · Taxa: {formatBRL(p.fee)}</p>
        </div>) : <p className="text-sm text-muted-foreground">{t.source.origin === "initial_balance" ? "Saldo inicial; nao representa pagamento ou recebimento de uma parcela." : t.source.detailComplete ? "Sem baixas na origem" : "Detalhes das baixas ainda em conferência"}</p>}
        {t.source.note && <p className="text-sm break-words">{t.source.note}</p>}
        {t.source.warnings.map((warning) => <p key={warning} className="text-sm text-amber-400">{warning}</p>)}
      </>}
    </DialogContent>
  </Dialog>;
}
