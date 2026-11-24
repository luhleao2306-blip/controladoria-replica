import { Link, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  CreditCard,
  LineChart,
  ReceiptText,
  Settings,
  Table2,
  TrendingUp,
  FlaskConical,
  ListPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlatformAccess } from "@/context/PlatformAccessContext";

const TABS = [
  { to: "/", label: "Painel Gerencial", icon: BarChart3 },
  { to: "/dashboard", label: "Dashboard", icon: LineChart },
  { to: "/dre", label: "DRE", icon: Table2 },
  { to: "/dre-simulacao", label: "DRE Simulação", icon: FlaskConical },
  { to: "/previsto-realizado", label: "Previsto x Realizado", icon: TrendingUp },
  { to: "/fluxo-caixa", label: "Fluxo de Caixa", icon: LineChart },
  { to: "/receitas", label: "Receitas", icon: ReceiptText },
  { to: "/despesas", label: "Despesas", icon: CreditCard },
  { to: "/lancamentos", label: "Lançamentos manuais", icon: ListPlus },
  { to: "/alertas", label: "Alertas", icon: Bell },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

export function DashboardTabs() {
  const access = usePlatformAccess();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = () => setEdges({ start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 });
    const active = element.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) {
      const left = active.offsetLeft - element.offsetLeft;
      if (left < element.scrollLeft || left + active.offsetWidth > element.scrollLeft + element.clientWidth) element.scrollLeft = left;
    }
    element.addEventListener("scroll", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => { element.removeEventListener("scroll", update); observer.disconnect(); };
  }, [pathname]);
  return (
    <nav aria-label="Módulos" className="relative flex min-w-0 items-center border-b border-border/70 bg-background px-2">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, color-mix(in oklab, var(--neon) 55%, transparent), transparent)",
        }}
      />
      <button type="button" aria-label="Módulos anteriores" title="Módulos anteriores" disabled={edges.start} onClick={() => list.current?.scrollBy({ left: -240, behavior: "auto" })} className="h-9 w-8 shrink-0 rounded hover:bg-muted disabled:opacity-25"><ChevronLeft className="mx-auto h-4 w-4" /></button>
      <div ref={list} className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.filter(tab => tab.to !== "/lancamentos" || access.companies.some(company => company.key === "manual-test")).map((t) => {
          const active = t.to === "/" ? pathname === "/" : pathname === t.to || pathname.startsWith(`${t.to}/`);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-xs font-semibold",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </div>
      <button type="button" aria-label="Próximos módulos" title="Próximos módulos" disabled={edges.end} onClick={() => list.current?.scrollBy({ left: 240, behavior: "auto" })} className="h-9 w-8 shrink-0 rounded hover:bg-muted disabled:opacity-25"><ChevronRight className="mx-auto h-4 w-4" /></button>
    </nav>
  );
}
