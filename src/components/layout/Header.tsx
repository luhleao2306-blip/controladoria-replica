import { LogOut, RefreshCw, Settings, User } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { endDemoSession, getDemoSession } from "@/lib/demo-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { GlyphText } from "@/components/fx/GlyphText";
import { BrandLogo } from "@/components/common/BrandLogo";

import { useFilters } from "@/context/FiltersContext";
import { MultiSelect } from "@/components/common/MultiSelect";
import { selectedCompanies } from "@/lib/filter-options";
import { type CompanyId } from "@/data/mock";
import { clearLiveData, refreshLiveData, refreshManualCompanyData, useLiveSyncStatus } from "@/data/live-sync";
import { getContaAzulReconciliation, requestContaAzulReconciliation } from "@/lib/conta-azul-reconciliation.functions";
import { integrationErrorMessage } from "@/lib/integration-errors";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";

type ApiCompany = "w2" | "somus" | "lie" | "lie-design" | "d61";
const apiCompanyName = (company: ApiCompany) => company === "d61" ? "D61" : company === "lie-design" ? "Liê Design" : company === "lie" ? "LIE ARQUITETURA" : company === "w2" ? "W2" : "Somus";
type ReconciliationState = Awaited<ReturnType<typeof getContaAzulReconciliation>>;
const pendingReconciliation = (state?: ReconciliationState) => Boolean(state && ["queued", "running", "retrying"].includes(state.status));
const reloadedDocuments = new WeakSet<Document>();

async function withDeadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("A resposta demorou. A conferencia pode continuar no servidor; o status sera consultado novamente.")), 30000);
    })]);
  } finally { clearTimeout(timer!); }
}

function formatLastSync(value: number | null) {
  if (!value) return "Aguardando";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function Header() {
  const filters = useFilters();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const liveSync = useLiveSyncStatus();
  const isSyncing = liveSync.foreground && (liveSync.status === "loading" || liveSync.status === "syncing");
  const demoSession = getDemoSession();
  const [userEmail, setUserEmail] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [reconciliations, setReconciliations] = useState<Partial<Record<ApiCompany, ReconciliationState>>>({});
  const previousReconciliations = useRef(reconciliations);
  const requestedUpdates = useRef<Partial<Record<ApiCompany, string>>>({});
  const mounted = useRef(true);
  const refreshInFlight = useRef(false);
  const authorizedApiCompanies = filters.companyOptions.map(c => c.id).filter((c): c is ApiCompany => c === "w2" || c === "somus" || c === "lie" || c === "lie-design" || c === "d61");
  const apiCompanyKey = authorizedApiCompanies.join(",");
  const requestedUpdateKey = JSON.stringify(requestedUpdates.current);
  const requestedCompanies = selectedCompanies(filters);
  const selectedApiCompanies = authorizedApiCompanies.filter(c => !requestedCompanies.length || requestedCompanies.includes(c));
  const selectedDates = (requestedCompanies.length ? requestedCompanies : filters.companyOptions.map(c => c.id))
    .map(company => liveSync.confirmedAtByCompany?.[company]).filter((value): value is number => Number.isFinite(value));
  const awaitingConfirmation = !demoSession && selectedApiCompanies.some(company => !Number.isFinite(liveSync.confirmedAtByCompany?.[company]));
  const lastUpdate = isSyncing ? "Sincronizando..." : awaitingConfirmation ? "Aguardando confirmação" : formatLastSync(selectedDates.length ? Math.min(...selectedDates) : liveSync.lastUpdatedAt);
  const pendingApi = selectedApiCompanies.some(c => requestedUpdates.current[c] === reconciliations[c]?.requestId && pendingReconciliation(reconciliations[c]));
  const retryingApi = pendingApi && selectedApiCompanies.some(c => reconciliations[c]?.status === "retrying");
  const blockedApi = selectedApiCompanies.some(c => reconciliations[c]?.status === "blocked");
  const refreshing = requesting || isSyncing || pendingApi;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const requested = Object.entries(requestedUpdates.current).filter(([company]) => authorizedApiCompanies.includes(company as ApiCompany)) as [ApiCompany, string][];
    if (!requested.length) return;
    const poll = async () => {
      try {
        if (!refreshInFlight.current && document.visibilityState !== "hidden") {
          const entries = await Promise.all(requested.map(async ([company]) => [company, await withDeadline(getContaAzulReconciliation({ data: { company } }))] as const));
          if (!active || refreshInFlight.current) return;
          // Another user's later request cannot replace this document's financial reading.
          if (entries.some(([company, state]) => state.requestId !== requestedUpdates.current[company])) {
            requestedUpdates.current = {};
            previousReconciliations.current = {};
            setReconciliations({});
            toast.info("Outra conferencia foi iniciada. Clique em Atualizar para carregar uma nova leitura.");
            return;
          }
          const next = Object.fromEntries(entries) as typeof reconciliations;
          previousReconciliations.current = next;
          if (entries.every(([, state]) => state.status === "completed")) {
            try {
              await refreshLiveData({ background: true });
              if (!active) return;
              await queryClient.invalidateQueries();
              if (active) toast.success(`Alteracoes atualizadas: ${entries.map(([c]) => apiCompanyName(c)).join(", ")}.`);
            } catch (error) {
              if (active) toast.error(integrationErrorMessage(error, "Nao foi possivel carregar a nova leitura. Clique em Atualizar para tentar novamente."));
            }
            if (!active) return;
            requestedUpdates.current = {};
          } else if (entries.some(([, state]) => state.status === "blocked")) {
            requestedUpdates.current = {};
          }
          setReconciliations(next);
        }
      } catch { /* A failed status read never clears the last confirmed progress or values. */ }
      finally { if (active && Object.keys(requestedUpdates.current).length) timer = setTimeout(poll, 15000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [apiCompanyKey, requestedUpdateKey]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setUserEmail(data.session?.user.email ?? ""); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (demoSession || !selectedApiCompanies.length || typeof window === "undefined" || reloadedDocuments.has(document)) return;
    const reloaded = window.performance?.getEntriesByType("navigation")
      .some(entry => (entry as PerformanceNavigationTiming).type === "reload");
    if (!reloaded) return;
    // One request per document, not per render, filter change or module navigation.
    reloadedDocuments.add(document);
    void handleRefresh();
  }, [apiCompanyKey, selectedApiCompanies.join(",")]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (demoSession) endDemoSession();
      else {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
      }
      // Cancelling unrelated queries must not delay termination of the session.
      void queryClient.cancelQueries();
      queryClient.clear();
      clearLiveData(true);
      await navigate({ to: "/login", replace: true });
    } catch {
      toast.error("Não foi possível concluir a saída. Tente novamente.");
    } finally { if (mounted.current) setSigningOut(false); }
  }

  async function handleRefresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRequesting(true);
    const queued: string[] = [];
    const failures: string[] = [];
    try {
      for (const company of selectedApiCompanies) {
        try {
            const request = await withDeadline(requestContaAzulReconciliation({ data: { company } }));
            if (!mounted.current) return;
            requestedUpdates.current[company] = request.requestId;
            const next = { ...previousReconciliations.current, [company]: { ...request, checked: 0, completedAt: null } };
            previousReconciliations.current = next;
            setReconciliations(next);
            queued.push(apiCompanyName(company));
        } catch (error) { failures.push(integrationErrorMessage(error, "Nao foi possivel buscar as alteracoes na API.")); }
      }
      if (queued.length) toast.info(`Busca de alteracoes solicitada: ${queued.join(", ")}.`);
      if (failures.length) toast.error(failures.join(" "));
      if (!mounted.current) return;
      if (!queued.length) {
        await withDeadline(requestedCompanies.length === 1 && requestedCompanies[0] === "manual-test"
          ? refreshManualCompanyData().then(() => {}) : refreshLiveData({ background: true }));
        if (!mounted.current) return;
        await queryClient.invalidateQueries();
        if (!failures.length && mounted.current) toast.success("Dados atualizados.");
      }
    } catch (error) {
      toast.error(integrationErrorMessage(error, queued.length ? "Atualizacao solicitada; a leitura da tela sera tentada novamente." : "Falha ao atualizar. Os dados anteriores foram preservados."));
    } finally {
      refreshInFlight.current = false;
      if (mounted.current) setRequesting(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/50">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, var(--neon) 65%, transparent), transparent)",
        }}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 lg:flex lg:h-20 lg:py-0">
        <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
          <BrandLogo className="w-[120px] sm:w-[144px]" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-base font-bold text-foreground">
              <GlyphText text="Controladoria" />
            </p>
            <p className="text-[10px] font-medium text-muted-foreground">
              Enterprise Intelligence
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 lg:ml-4">
          <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 rounded-lg bg-muted border border-border">
            <span className="hidden text-xs font-medium text-muted-foreground sm:block">
              Unidade
            </span>
            <MultiSelect label="Unidades" values={selectedCompanies(filters)} onChange={values => filters.setCompanies(values as Exclude<CompanyId, "all">[])} options={filters.companyOptions.map(c => ({ value: c.id, label: c.name }))} allLabel="Todas as autorizadas" className="min-h-7 border-0 bg-transparent p-0 lg:w-[180px]" />
          </div>

          <div className="hidden items-center gap-3 xl:flex">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${awaitingConfirmation ? "bg-primary/10 border-primary/20" : "bg-emerald-500/10 border-emerald-500/20"}`}>
              <div className={`h-1.5 w-1.5 rounded-full ${awaitingConfirmation ? "bg-primary" : "bg-emerald-500"}`}></div>
              <span className={`text-[10px] font-bold ${awaitingConfirmation ? "text-primary" : "text-emerald-500"}`}>
                {awaitingConfirmation ? "Dados pendentes" : liveSync.status === "error" ? "Atualizacao pendente" : selectedApiCompanies.some(company => liveSync.savedViewCompanies?.[company]) ? "Dados salvos" : "Live Sync"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 sm:gap-2 lg:ml-auto">
          <div className="hidden text-right xl:block">
            <p className="text-[10px] font-bold tracking-widest text-muted-foreground">
              Última Sincronização
            </p>
            <p className={`text-xs font-bold ${retryingApi || blockedApi ? "text-amber-400" : "text-foreground/80"}`} aria-live="polite">{blockedApi ? "Atualizacao pausada: autorizacao pendente" : retryingApi ? "API pendente; nova tentativa automatica" : pendingApi ? "Buscando alteracoes..." : lastUpdate}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 w-10 shrink-0 rounded-lg border-border bg-card p-0 text-xs font-medium text-foreground hover:bg-accent sm:w-auto sm:px-3"
            aria-label="Atualizar dados"
            title={blockedApi ? "O acesso do processo automatico precisa ser renovado. Os dados anteriores foram preservados." : retryingApi ? "A API falhou. Os valores anteriores foram preservados e o servidor tentara novamente." : pendingApi ? "Busca de alteracoes em andamento no servidor" : "Buscar novos lancamentos, alteracoes e exclusoes na API"}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing && !retryingApi && !blockedApi ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{blockedApi ? "Pausado" : retryingApi ? "Aguardando API" : pendingApi ? "Atualizando" : "Atualizar"}</span>
          </Button>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Menu do usuario" className="h-10 w-10 rounded-xl hover:bg-accent">
                <Avatar className="h-9 w-9 border border-border">
                  <AvatarFallback className="bg-primary/20 text-xs font-bold text-primary">
                    {userEmail ? userEmail.slice(0, 2).toUpperCase() : "--"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 bg-card border-border text-foreground p-2"
            >
              <DropdownMenuLabel className="px-3 py-4">
                <div className="leading-tight">
                  <p className="font-bold text-lg">Gestor Financeiro</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {userEmail || "Carregando..."}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                className="rounded-lg py-3 focus:bg-accent cursor-pointer"
                onSelect={() => navigate({ to: "/configuracoes" })}
              >
                <User className="mr-3 h-5 w-5 text-muted-foreground" /> Perfil Executivo
              </DropdownMenuItem>
              <DropdownMenuItem
                className="rounded-lg py-3 focus:bg-accent cursor-pointer"
                onSelect={() => navigate({ to: "/configuracoes" })}
              >
                <Settings className="mr-3 h-5 w-5 text-muted-foreground" /> Preferências
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                className="rounded-lg py-3 focus:bg-accent text-rose-500 cursor-pointer"
                disabled={signingOut}
                onSelect={(e) => {
                  e.preventDefault();
                  handleSignOut();
                }}
              >
                <LogOut className="mr-3 h-5 w-5" /> {signingOut ? "Saindo..." : "Sair do Sistema"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
