import { ArrowDownRight, ArrowUpRight, HelpCircle, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BRL, formatBRL, formatVariation } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { financialAmountClass, financialOutcome, type FinancialDirection } from "@/lib/financial-semantics";

export type KpiTone = "positive" | "warning" | "critical" | "neutral";

export function KpiCard({
  label,
  value,
  variation,
  tone = "neutral",
  icon: Icon,
  formatValue,
  formula,
  trend,
  size = "md",
  direction = "higher",
  presentation = "standard",
}: {
  label: string;
  value: number | null;
  variation?: number | null;
  tone?: KpiTone;
  icon?: LucideIcon;
  formatValue?: (n: number) => string;
  formula?: string;
  trend?: number[];
  size?: "md" | "lg";
  direction?: FinancialDirection;
  presentation?: "standard" | "compact";
}) {
  const compact = presentation === "compact";
  const outcome = financialOutcome(variation, direction);
  const increasing = (variation ?? 0) >= 0;
  const accent = value != null && value < 0 && direction === "higher" ? "var(--destructive)"
    : direction === "lower" || tone === "warning" ? "var(--warning)" : "var(--neon)";
  const currencyParts = compact && value != null && !formatValue ? BRL.formatToParts(value) : null;
  const max = trend?.length ? trend.reduce((acc, n) => Math.max(acc, Math.abs(Number(n) || 0)), 1) : 1;

  return (
    <Card data-kpi={label} className={cn("min-w-0 overflow-hidden rounded-lg border-border/70 shadow-none", compact ? "financial-kpi-compact p-4" : "p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <p className={cn("min-w-0 break-words tracking-normal text-muted-foreground", compact ? "text-xs font-medium" : "text-[11px] font-bold")}>
            {label}
          </p>
          {formula ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Ver fórmula de ${label}`}
                    className="rounded-full text-muted-foreground/60 transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{formula}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>
        {Icon ? (
          <span
            className={cn("flex shrink-0 items-center justify-center rounded-md", compact ? "h-7 w-7" : "h-9 w-9")}
            style={{
              background: `color-mix(in oklab, ${accent} 16%, transparent)`,
              color: accent,
              boxShadow: `0 0 22px -8px ${accent}`,
            }}
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>

      <p
        className={cn(
          "mt-3 break-words font-semibold tabular-nums tracking-normal",
          compact ? "financial-kpi-value text-[26px] leading-tight" : size === "lg" ? "text-[28px] leading-tight" : "text-[22px] leading-tight",
          financialAmountClass(value),
        )}
        aria-label={compact && value != null ? (formatValue ?? formatBRL)(value) : undefined}
      >
        {value == null ? (
          "—"
        ) : (
          currencyParts ? currencyParts.map((part, index) => <span key={index} className={part.type === "currency" ? "mr-1 text-sm font-medium text-muted-foreground" : undefined}>{part.value}</span>) : (formatValue ?? formatBRL)(value)
        )}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        {variation != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
              outcome === "positive"
                ? "bg-[color:var(--success)]/12 text-[color:var(--success)]"
                : outcome === "critical" ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
            )}
          >
            {variation !== 0 && (increasing ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
            {formatVariation(variation)}
          </span>
        ) : (
          compact && value != null && value < 0 && direction === "higher" ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive"><ArrowDownRight className="h-3 w-3" />Resultado negativo</span> : <span className="text-[11px] text-muted-foreground">Período selecionado</span>
        )}

        {trend?.length ? (
          <div className="flex h-9 flex-1 items-end justify-end gap-[3px]" aria-hidden>
            {trend.map((v, i) => (
              <span
                key={i}
                className="w-full max-w-[6px] rounded-full"
                style={{
                  height: `${Math.max(12, (Math.abs(v) / max) * 100)}%`,
                  background: accent,
                  boxShadow: `0 0 10px -2px ${accent}`,
                  opacity: 0.3 + (i / Math.max(trend.length - 1, 1)) * 0.7,
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
