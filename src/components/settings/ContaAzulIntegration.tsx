import { useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useFilters } from "@/context/FiltersContext";
import { COMPANIES } from "@/data/mock";
import { getContaAzulAuthorizationUrl, getContaAzulConnectionStatus } from "@/lib/conta-azul.functions";
import { syncContaAzulCompany, type ContaAzulCompany, type SyncProgress } from "@/lib/conta-azul-sync";
import { refreshLiveData } from "@/data/live-sync";
import { hasDemoSession } from "@/lib/demo-auth";
import { integrationErrorMessage } from "@/lib/integration-errors";
import { contaAzulIncrementalSince } from "@/lib/conta-azul-model";
import { requestContaAzulReconciliation } from "@/lib/conta-azul-reconciliation.functions";

export function syncProgressLabel(progress: SyncProgress) {
  const labels = { starting: "Iniciando conferência", waiting: "Aguardando atualização em andamento", catalog: "Conferindo categorias e contas", revenue: "Importando receitas", expense: "Importando despesas", details: "Conferindo parcelas", verifying: "Validando a importação" };
  return `${labels[progress.phase]}${progress.page ? ` · página ${progress.page}` : ""}`;
}

type ConnectionStatus = Awaited<ReturnType<typeof getContaAzulConnectionStatus>>;

export function ContaAzulIntegration() {
  const { company, setCompany } = useFilters();
  const selected = company === "all" || company === "manual-test" ? null : company;
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [retry, setRetry] = useState(0);
  const currentCompany = useRef(selected);
  currentCompany.current = selected;

  useEffect(() => {
    let active = true;
    setConnection(null);
    setError(null);
    if (!selected || hasDemoSession()) return;
    getContaAzulConnectionStatus({ data: { company: selected } })
      .then((status) => { if (active) setConnection(status); })
      .catch((reason) => { if (active) setError(integrationErrorMessage(reason, "Não foi possível consultar a conexão.")); });
    return () => { active = false; };
  }, [selected, retry]);

  async function connect() {
    if (!selected) return;
    if (hasDemoSession()) { setError("Entre com um usuário real para conectar a Conta Azul."); return; }
    setBusy("connect");
    setError(null);
    try {
      const { url } = await getContaAzulAuthorizationUrl({ data: { company: selected } });
      window.location.assign(url);
    } catch (reason) {
      setError(integrationErrorMessage(reason, "Não foi possível iniciar a conexão."));
      setBusy(null);
    }
  }

  async function sync() {
    if (!selected) return;
    const target: ContaAzulCompany = selected;
    setBusy("sync");
    setError(null);
    setProgress(null);
    try {
      const latest = await getContaAzulConnectionStatus({ data: { company: target } });
      if (latest.server_sync_enabled && (target === "w2" || target === "somus" || target === "lie" || target === "lie-design" || target === "d61")) {
        await requestContaAzulReconciliation({ data: { company: target } });
        toast.info("Busca de novidades solicitada no servidor.");
        if (currentCompany.current === target) setRetry(value => value + 1);
        await refreshLiveData({ background: true });
        return;
      }
      const totals = await syncContaAzulCompany(target, { updatedSince: contaAzulIncrementalSince(latest.last_sync_at), onProgress: setProgress });
      try {
        await refreshLiveData({ background: true });
      } catch {
        toast.warning("Importação concluída. A leitura do painel está indisponível; atualize o painel sem refazer a conexão.");
      }
      if (currentCompany.current === target) setRetry((value) => value + 1);
      toast.success(`Novidades importadas: ${totals.received} receitas e ${totals.paid} despesas.`);
    } catch (reason) {
      setError(integrationErrorMessage(reason, "A importação não foi concluída. Os dados anteriores foram preservados."));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const connected = connection?.connection_status === "connected";
  const authorizationRequired = connection?.connection_status === "expired" || connection?.scheduler_error === "source_authorization_required";
  const automationError = connection?.scheduler_error;
  const lastSuccessfulCheck = connection?.last_scheduler_completion_at ?? connection?.last_sync_at;
  const overdue = connected && lastSuccessfulCheck && Date.now() - Date.parse(lastSuccessfulCheck) > 24 * 3600000;
  return <div className="min-w-0 space-y-4 text-sm">
    <div className="space-y-2">
      <Label htmlFor="integration-company">Empresa da conexão</Label>
      <Select value={selected ?? ""} disabled={busy !== null} onValueChange={(value) => setCompany(value as ContaAzulCompany)}>
        <SelectTrigger id="integration-company"><SelectValue placeholder="Selecione uma empresa" /></SelectTrigger>
        <SelectContent>{COMPANIES.filter(entry => entry.id !== "manual-test").map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    <dl className="divide-y divide-border/60">
      <div className="flex flex-wrap items-center justify-between gap-2 py-2"><dt>Conexão</dt>
        <dd><StatusBadge tone={connected && !authorizationRequired ? "positive" : "warning"}>{!selected ? "Selecione uma empresa" : error && !connection ? "Consulta indisponível" : !connection ? "Verificando..." : authorizationRequired ? "Reconexão necessária" : connected ? "Autorizada" : "Desconectada"}</StatusBadge></dd>
      </div>
      {connection?.server_sync_enabled && <div className="flex flex-wrap justify-between gap-2 py-2"><dt>Atualização automática</dt><dd className={authorizationRequired || automationError || overdue ? "text-amber-500" : "text-muted-foreground"}>{authorizationRequired ? "Pausada: reconecte a empresa" : automationError === "authorization_required" ? "Acesso do servidor pendente" : automationError === "source_configuration_error" ? "Credenciais da integração pendentes" : overdue ? "Sem conclusão nas últimas 24 horas" : automationError ? "Falha temporária; nova tentativa automática" : "Ativa no servidor"}</dd></div>}
      <div className="flex flex-wrap justify-between gap-2 py-2"><dt>Última importação concluída</dt><dd className="text-muted-foreground">{connection?.last_sync_at ? new Date(connection.last_sync_at).toLocaleString("pt-BR") : "Ainda não confirmada"}</dd></div>
      <div className="flex flex-wrap justify-between gap-2 py-2"><dt>Registros no banco</dt><dd>{connection?.transaction_count == null ? "Não conferidos" : connection.transaction_count.toLocaleString("pt-BR")}</dd></div>
      {selected === "somus" && <div className="flex flex-wrap justify-between gap-2 py-2"><dt>Vencimentos autorizados</dt><dd>A partir de 01/09/2025</dd></div>}
      {(connection?.import_status || busy === "sync") && <div className="flex flex-wrap justify-between gap-2 py-2"><dt>Importação</dt><dd>{busy === "sync" || connection?.import_status === "running" ? "Em andamento" : connection?.import_status === "completed" ? "Concluída" : "Pendente de conferência"}</dd></div>}
    </dl>
    {authorizationRequired && <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-amber-500">A Conta Azul recusou a renovação do acesso desta empresa. Clique em Reconectar Conta Azul para retomar as atualizações. Os dados já importados foram preservados.</p>}
    {progress && <div role="status" aria-live="polite" className="space-y-1 text-muted-foreground">
      <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 shrink-0 animate-spin" />{syncProgressLabel(progress)}</p>
      <p>{progress.received.toLocaleString("pt-BR")} receitas · {progress.paid.toLocaleString("pt-BR")} despesas</p>
    </div>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy !== null || !selected} onClick={connect}>
        {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        {busy === "connect" ? "Abrindo autorização..." : connected || authorizationRequired ? "Reconectar Conta Azul" : "Conectar Conta Azul"}
      </Button>
      <Button disabled={busy !== null || !connected || authorizationRequired} onClick={sync}><RefreshCw className="h-4 w-4" />Buscar novidades</Button>
      <Button size="icon" variant="ghost" aria-label="Consultar conexão novamente" title="Consultar conexão novamente" disabled={busy !== null || !selected} onClick={() => setRetry((value) => value + 1)}><RefreshCw className="h-4 w-4" /></Button>
    </div>
  </div>;
}
