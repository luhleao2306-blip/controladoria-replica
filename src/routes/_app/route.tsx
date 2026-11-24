import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { clearLiveData, hasLiveData, restoreLiveData, refreshLiveData, useLiveData, useLiveSyncStatus } from "@/data/live-sync";
import { LoadingState } from "@/components/common/LoadingState";
import { supabase } from "@/integrations/supabase/client";
import { endDemoSession, hasDemoSession, onDemoAuthStateChange } from "@/lib/demo-auth";
import { getPlatformAccess } from "@/lib/platform-access.functions";
import { PlatformAccessProvider } from "@/context/PlatformAccessContext";
import type { PlatformAccess } from "@/lib/platform-access";
import { retryAccessRead, withAuthTimeout } from "@/lib/auth-request";

export const Route = createFileRoute("/_app")({
  ssr: false,
  component: AppShell,
  errorComponent: FilterErrorFallback,
});

function FilterErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[app] render error", error);
  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <h2 className="text-lg font-semibold">Não foi possível montar esta visão</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Um dos filtros gerou um resultado inesperado. Tente novamente ou ajuste os filtros.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Tentar novamente
      </button>
    </div>
  );
}


function accessScope(access: PlatformAccess) {
  return JSON.stringify([access.isAdmin, access.securityReady, access.companies.map(company => `${company.key}:${company.id}`).sort()]);
}

function AppShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState("");
  const [access, setAccess] = useState<PlatformAccess | null>(null);
  const [accessError, setAccessError] = useState(false);
  const [accessChanged, setAccessChanged] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const version = useLiveData(ready && Boolean(access?.companies.length));
  const syncState = useLiveSyncStatus();

  useEffect(() => {
    let active = true;
    let signedOut = false;
    if (hasDemoSession()) {
      endDemoSession();
      navigate({ to: "/login" });
      return () => {
        active = false;
      };
    }
    const startupTimer = window.setTimeout(() => {
      if (active) { active = false; setAccessError(true); }
    }, 75000);
    withAuthTimeout(supabase.auth.getSession()).then(async ({ data, error }) => {
      if (!active || signedOut) return;
      if (error) throw error;
      if (!data.session && !hasDemoSession()) {
        navigate({ to: "/login" });
      } else {
        if (!data.session) return;
        try {
          const permissions = await retryAccessRead(() => getPlatformAccess());
          if (!active || signedOut) return;
          await restoreLiveData(data.session.user.id, permissions);
          setAccess(permissions);
        } catch { if (active) setAccessError(true); return; }
        if (active && !signedOut) {
          setUserId(data.session.user.id);
          setReady(true);
        }
      }
    }).catch(() => { if (active && !signedOut) setAccessError(true); })
      .finally(() => window.clearTimeout(startupTimer));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        signedOut = true;
        setReady(false);
        clearLiveData(true);
        navigate({ to: "/login" });
      }
    });
    const unsubscribeDemo = onDemoAuthStateChange((event) => {
      if (event === "SIGNED_OUT") navigate({ to: "/login" });
      if (event === "SIGNED_IN") setReady(true);
    });
    return () => {
      active = false;
      window.clearTimeout(startupTimer);
      sub.subscription.unsubscribe();
      unsubscribeDemo();
    };
  }, [navigate]);

  useEffect(() => {
    if (!ready || !access) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (!active || busy || document.hidden) return;
      busy = true;
      try {
        const permissions = await retryAccessRead(() => getPlatformAccess());
        if (!active) return;
        if (accessScope(permissions) !== accessScope(access)) {
          clearLiveData(true);
          setReady(false);
          setAccessChanged(true);
        }
      } catch { if (active) { setAccessError(true); clearLiveData(true); } }
      finally { busy = false; }
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [ready, userId, access]);

  if (accessChanged) return <div role="alert" className="mx-auto max-w-md p-10 text-center"><h1 className="text-xl font-semibold">Seu acesso foi alterado</h1><p className="mt-3 text-sm">Reabra a pagina para continuar com as permissoes atuais.</p><button className="mt-4 rounded-md border px-4 py-2" onClick={() => window.location.reload()}>Atualizar</button></div>;
  if (accessError) return <div role="alert" className="mx-auto max-w-md p-10 text-center"><h1 className="text-xl font-semibold">Nao foi possivel confirmar seu acesso</h1><p className="mt-3 text-sm">Os dados permanecem protegidos. Reabra a pagina para tentar novamente.</p><button className="mt-4 rounded-md border px-4 py-2" onClick={() => window.location.reload()}>Tentar novamente</button><button disabled={leaving} className="mt-4 ml-3 rounded-md border px-4 py-2" onClick={async () => {
    setLeaving(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) return;
      clearLiveData(true);
      await navigate({ to: "/login", replace: true });
    } finally { setLeaving(false); }
  }}>{leaving ? "Saindo..." : "Sair da conta"}</button></div>;
  if (ready && access && !access.companies.length) return <div role="status" className="mx-auto max-w-md p-10 text-center"><h1 className="text-xl font-semibold">Acesso aguardando liberacao</h1><p className="mt-3 text-sm">O administrador precisa autorizar as empresas que voce pode visualizar.</p><button className="mt-4 rounded-md border px-4 py-2" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/login" }); }}>Sair</button></div>;

  if (!ready || (!hasLiveData() && syncState.status === "error" && path !== "/configuracoes")) {
    if (ready && syncState.status === "error") return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p>Não foi possível carregar os dados. Nenhum valor foi substituído.</p>
        <button onClick={() => void refreshLiveData().catch(() => {})} className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground">
          Tentar novamente
        </button>
        <button onClick={() => navigate({ to: "/configuracoes" })} className="mt-4 ml-3 rounded-md border px-4 py-2">Conferir conexão</button>
      </div>
    );
    return <LoadingState label="Carregando seus dados financeiros..." />;
  }

  return (
    <PlatformAccessProvider value={access!}><AppLayout userId={userId} dataVersion={version}>
      <div className="contents">
        <Outlet />
      </div>
    </AppLayout></PlatformAccessProvider>
  );
}
