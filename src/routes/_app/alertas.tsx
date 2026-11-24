import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertCard } from "@/components/common/AlertCard";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type AlertEvent } from "@/data/mock";
import { useFilters } from "@/context/FiltersContext";
import { getTransactions, getAggregateKpis } from "@/lib/finance";
import { buildFinancialAlerts, EMPTY_SETTINGS } from "@/lib/operational-settings";
import { useOperationalSettings } from "@/hooks/use-operational-settings";
import { resolveFinancialAlert } from "@/lib/operational-settings.functions";
import { toast } from "sonner";
import { LoadingState } from "@/components/common/LoadingState";
import { cn } from "@/lib/utils";
import { filterSelectionKey, selectedCategories, selectedCostCenters, selectedPayments, selectedFinancialAccounts, selectedDateRanges, selectedMonths, selectedYears } from "@/lib/filter-options";

export const Route = createFileRoute("/_app/alertas")({
  head: () => ({
    meta: [
      { title: "Alertas — Modblue Controladoria" },
      {
        name: "description",
        content: "Central de alertas financeiros com severidade e recomendações.",
      },
    ],
  }),
  component: AlertasPage,
});

const FILTERS: { key: AlertEvent["status"] | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "open", label: "Abertos" },
  { key: "resolved", label: "Revisados" },
];

function AlertasPage() {
  const financialFilters = useFilters();
  const preferences = useOperationalSettings(financialFilters.company);
  const [busy, setBusy] = useState(false);
  const alerts = useMemo<AlertEvent[]>(() => {
    const f = financialFilters;
    const fullMonth = f.company !== "all" && f.basis === "accrual" && selectedYears(f).length === 1 && selectedMonths(f).length === 1 && !selectedDateRanges(f).length &&
      !selectedCategories(f).length && !selectedCostCenters(f).length && !selectedPayments(f).length && !selectedFinancialAccounts(f).length;
    const scope = filterSelectionKey(f);
    let hash = 0;
    for (const char of scope) hash = Math.imul(hash, 31) + char.charCodeAt(0) | 0;
    return buildFinancialAlerts(getTransactions(f), fullMonth ? getAggregateKpis(f) : null,
      preferences.data?.settings ?? EMPTY_SETTINGS, `${f.company}:${hash >>> 0}`)
      .map(alert => ({ ...alert, status: preferences.data?.resolved.includes(alert.id) ? "resolved" as const : "open" as const }));
  }, [financialFilters, preferences.data]);
  const [filter, setFilter] = useState<AlertEvent["status"] | "all">("all");
  const [severity, setSeverity] = useState<AlertEvent["severity"] | "all">("all");
  const list = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (filter === "all" || a.status === filter) &&
          (severity === "all" || a.severity === severity),
      ),
    [alerts, filter, severity],
  );
  const grouped = {
    open: list.filter((a) => a.status === "open"),
    in_review: list.filter((a) => a.status === "in_review"),
    resolved: list.filter((a) => a.status === "resolved"),
  };
  const resolveAlert = async (id: string) => {
    if (financialFilters.company === "all" || busy || !preferences.data) return;
    setBusy(true);
    try {
      await resolveFinancialAlert({ data: { company: financialFilters.company, id } });
      await preferences.invalidate(); toast.success("Alerta revisado e salvo.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar a revisao."); }
    finally { setBusy(false); }
  };

  if (financialFilters.company !== "all" && preferences.isPending) return <LoadingState label="Carregando regras e revisoes de alertas..." />;
  if (financialFilters.company !== "all" && preferences.isError) return <EmptyState title="Alertas indisponiveis" description="Nao foi possivel consultar as regras salvas." actionLabel="Tentar novamente" onAction={() => void preferences.refetch()} />;

  return (
    <>
      <PageHeader
        title="Alertas"
        description="Central de alertas financeiros com severidade, impacto e recomendação."
      />
      <Card className="mb-5 rounded-2xl border-border p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                variant={filter === f.key ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f.key)}
                className={cn(filter === f.key && "bg-primary text-primary-foreground")}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Severidade</span>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as AlertEvent["severity"] | "all")}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="critical">Crítica</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Média</SelectItem>
                <SelectItem value="low">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {list.length === 0 ? (
        <EmptyState
          title="Sem alertas para os filtros selecionados"
          description="Nenhum alerta corresponde aos filtros atuais."
          actionLabel="Mostrar todos"
          onAction={() => {
            setFilter("all");
            setSeverity("all");
          }}
        />
      ) : (
        <div className="grid gap-5">
          {Object.entries(grouped).map(([status, items]) =>
            items.length ? (
              <section key={status} className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {status === "open"
                      ? "Abertos"
                      : status === "in_review"
                        ? "Em análise"
                        : "Revisados"}
                  </h2>
                  <StatusBadge tone="neutral">{items.length}</StatusBadge>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {items.map((a) => (
                    <AlertCard key={a.id} alert={a} onResolve={financialFilters.company !== "all" && !busy && preferences.data && a.status !== "resolved" ? () => void resolveAlert(a.id) : undefined} />
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}
