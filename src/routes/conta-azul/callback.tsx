import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { completeContaAzulAuthorization, getContaAzulConnectionStatus, getContaAzulReadState } from "@/lib/conta-azul.functions";
import { getContaAzulReconciliation, requestContaAzulReconciliation } from "@/lib/conta-azul-reconciliation.functions";
import { syncContaAzulCompany, type ContaAzulCompany, type SyncProgress } from "@/lib/conta-azul-sync";
import { supabase } from "@/integrations/supabase/client";
import { restoreLiveData, refreshLiveData } from "@/data/live-sync";
import { Button } from "@/components/ui/button";
import { Loader2, CircleCheck, CircleAlert, ArrowLeft, RefreshCw } from "lucide-react";
import { z } from "zod";

const pendingKey = "modblue:conta-azul:pending";
const pendingSchema = z.object({ company: z.enum(["w2", "somus", "lie", "lie-design", "d61"]), userId: z.string().min(1) });
function savePending(company: ContaAzulCompany, userId: string) {
  try { window.sessionStorage.setItem(pendingKey, JSON.stringify({ company, userId })); } catch { /* Storage restrictions must not cancel a server import. */ }
}
function readPending(userId: string): ContaAzulCompany | null {
  try {
    const saved = pendingSchema.safeParse(JSON.parse(window.sessionStorage.getItem(pendingKey) ?? "null"));
    return saved.success && saved.data.userId === userId ? saved.data.company : null;
  } catch { return null; }
}
function clearPending() {
  try { window.sessionStorage.removeItem(pendingKey); } catch { /* Import state remains durable on the server. */ }
}

export const Route = createFileRoute("/conta-azul/callback")({
  ssr: false,
  component: ContaAzulCallbackPage,
});

function ContaAzulCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Concluindo a conexão segura com a Conta Azul...");
  const [phase, setPhase] = useState<"connecting" | "syncing" | "complete" | "error">("connecting");
  const [company, setCompany] = useState<ContaAzulCompany | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [displayWarning, setDisplayWarning] = useState<string | null>(null);
  const [serverImport, setServerImport] = useState(false);
  const started = useRef(false);
  const mounted = useRef(false);

  async function importData(target: ContaAzulCompany) {
    setPhase("syncing");
    setDisplayWarning(null);
    setProgress(null);
    setServerImport(false);
    setMessage("Importando e conferindo os dados financeiros...");
    try {
      const connection = await getContaAzulConnectionStatus({ data: { company: target } });
      if (!mounted.current) return;
      let summary: string | null = null;
      if (connection.server_sync_enabled) {
        setServerImport(true);
        await requestContaAzulReconciliation({ data: { company: target } });
        while (mounted.current) {
          const [state, reading] = await Promise.all([
            getContaAzulReconciliation({ data: { company: target } }),
            getContaAzulReadState({ data: { company: target } }),
          ]);
          if (!mounted.current) return;
          if (state.status === "blocked") throw new Error("O acesso automático precisa ser autorizado pelo administrador. Os dados existentes foram preservados.");
          if (reading.status === "running" && reading.progress) setProgress({
            phase: reading.progress.expensePage ? "expense" : "revenue", received: reading.progress.revenue,
            paid: reading.progress.expense, page: reading.progress.expensePage || reading.progress.revenuePage,
          });
          if (state.status === "completed" && reading.status === "completed") {
            const confirmed = await getContaAzulConnectionStatus({ data: { company: target } });
            if (!mounted.current) return;
            if (confirmed.import_status === "completed" && confirmed.last_sync_at && confirmed.transaction_count !== null
              && Number.isSafeInteger(confirmed.transaction_count) && confirmed.transaction_count >= 0) {
              summary = `Importação conferida: ${confirmed.transaction_count.toLocaleString("pt-BR")} lançamentos disponíveis.`;
              break;
            }
          }
          setMessage(state.status === "retrying" ? "Aguardando nova tentativa automática da Conta Azul..."
            : state.eventProgress ? `Conferindo baixas e alterações: ${state.eventProgress.checked.toLocaleString("pt-BR")} de ${state.eventProgress.total.toLocaleString("pt-BR")} eventos.`
            : state.phase?.startsWith("inventory-") ? "Conferindo exclusões e a integridade dos lançamentos..."
            : "Importação em andamento no servidor...");
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      } else {
        const totals = await syncContaAzulCompany(target, { onProgress: (value) => { if (mounted.current) setProgress(value); } });
        summary = `Importação conferida: ${totals.received.toLocaleString("pt-BR")} contas a receber e ${totals.paid.toLocaleString("pt-BR")} contas a pagar.`;
      }
      if (!mounted.current || summary === null) return;
      try {
        await refreshLiveData({ background: true });
      } catch {
        if (mounted.current) setDisplayWarning("Os dados foram importados, mas o painel não pôde atualizar a leitura. Tente atualizar o painel; não é necessário reconectar a Conta Azul.");
      }
      if (!mounted.current) return;
      clearPending();
      setPhase("complete");
      setMessage(summary);
    } catch (reason) {
      if (!mounted.current) return;
      setPhase("error");
      setMessage(reason instanceof Error ? reason.message : "A importação não foi concluída. Os dados anteriores foram preservados.");
    }
  }

  useEffect(() => {
    mounted.current = true;
    if (started.current) return () => { mounted.current = false; };
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    // Authorization codes are short lived and must not remain in browser history.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (code || state || error) clearPending();
    if (error) {
      setPhase("error");
      setMessage("A autorização não foi concluída na Conta Azul. Seus dados existentes não foram removidos.");
    } else {
      void (async () => {
        const session = await supabase.auth.getSession();
        if (session.error) throw session.error;
        if (!session.data.session) throw new Error("Sua sessão da plataforma expirou. Entre novamente na plataforma para continuar.");
        await restoreLiveData(session.data.session.user.id);
        let target: ContaAzulCompany;
        if (code && state) {
          const authorized = await completeContaAzulAuthorization({ data: { code, state } });
          target = authorized.company;
        } else {
          const pending = readPending(session.data.session.user.id);
          if (!pending) throw new Error("A Conta Azul não retornou uma autorização válida. Inicie uma nova conexão nas configurações.");
          target = pending;
        }
        if (!mounted.current) return;
        savePending(target, session.data.session.user.id);
        setCompany(target);
        await importData(target);
      })().catch((reason) => {
        if (!mounted.current) return;
        setPhase("error");
        setMessage(reason instanceof Error ? reason.message : "Não foi possível concluir a conexão.");
      });
    }
    return () => { mounted.current = false; };
  }, []);

  const busy = phase === "connecting" || phase === "syncing";
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10 text-foreground">
    <section className="w-full max-w-lg space-y-5" aria-live="polite">
      {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : phase === "complete" ? <CircleCheck className="h-8 w-8 text-emerald-500" /> : <CircleAlert className="h-8 w-8 text-destructive" />}
      <h1 className="text-xl font-semibold">{phase === "complete" ? "Conta Azul conectada" : phase === "error" ? "Conexão pendente" : "Conexão Conta Azul"}</h1>
      <p className="break-words text-sm text-muted-foreground" role={phase === "error" ? "alert" : "status"}>{message}</p>
      {displayWarning && <p className="break-words text-sm text-amber-500" role="alert">{displayWarning}</p>}
      {phase === "syncing" && progress && <p className="text-sm">{progress.received.toLocaleString("pt-BR")} receitas · {progress.paid.toLocaleString("pt-BR")} despesas{progress.page ? ` · página ${progress.page}` : ""}</p>}
      {(!busy || serverImport) && <div className="flex flex-wrap gap-2">
        {phase === "complete" && <Button onClick={() => navigate({ to: "/" })}>Abrir painel</Button>}
        {phase === "error" && company && <Button onClick={() => importData(company)}><RefreshCw className="h-4 w-4" />Retomar importação</Button>}
        <Button variant="outline" onClick={() => navigate({ to: "/configuracoes" })}><ArrowLeft className="h-4 w-4" />Configurações</Button>
        {phase === "error" && !company && <Button variant="outline" onClick={() => navigate({ to: "/login" })}>Entrar na plataforma</Button>}
      </div>}
    </section>
  </main>;
}
