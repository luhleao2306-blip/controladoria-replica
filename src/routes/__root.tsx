import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isStaleAssetError } from "../lib/chunk-recovery";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const staleAssets = isStaleAssetError(error);
  useEffect(() => {
    if (!staleAssets) reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error, staleAssets]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {staleAssets ? "Nova versão disponível" : "Não foi possível carregar esta página"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {staleAssets ? "Atualize a página quando estiver pronto para continuar." : "Algo falhou ao abrir o sistema. Tente atualizar ou voltar ao início."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              if (staleAssets) { window.location.reload(); return; }
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {staleAssets ? "Atualizar página" : "Tentar novamente"}
          </button>
          {!staleAssets && <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Recarregar
          </button>}
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Modblue — Controladoria Financeira" },
      { name: "description", content: "Dashboard de controladoria financeira para agências de marketing." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Modblue — Controladoria Financeira" },
      { property: "og:description", content: "Dashboard de controladoria financeira para agências de marketing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Modblue — Controladoria Financeira" },
      { name: "twitter:description", content: "Dashboard de controladoria financeira para agências de marketing." },
      { property: "og:image", content: "/brand/modblue-symbol.png" },
      { property: "og:image:width", content: "1280" },
      { property: "og:image:height", content: "944" },
      { name: "twitter:image", content: "/brand/modblue-symbol.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/brand/modblue-symbol.png" },
      { rel: "apple-touch-icon", href: "/brand/modblue-symbol.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const themeBootstrap = `(function(){try{var t=window.localStorage.getItem("theme");var d=t!=="light";document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" translate="no" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Also handle recovery links redirected to the configured Site URL.
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
        window.location.replace("/reset-password");
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}

