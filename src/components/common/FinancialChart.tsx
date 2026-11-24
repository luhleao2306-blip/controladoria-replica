import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
} from "recharts";
import { Card } from "@/components/ui/card";
import { BRL } from "@/lib/format";
import { EmptyState } from "./EmptyState";
import { financialAmountClass, type FinancialDirection } from "@/lib/financial-semantics";

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const tickFmt = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
};

const tooltipFmt = (v: number | string) => (typeof v === "number" ? BRL.format(v) : v);

const AXIS = {
  fontSize: 11,
  stroke: "var(--muted-foreground)",
  tickLine: false as const,
  axisLine: false as const,
};

type ChartDatum = Record<string, number | string>;

type TooltipPayload = { name?: string; dataKey?: string; value?: number | string; color?: string }[];

function ChartTooltip({
  active,
  payload,
  label,
  directions,
}: {
  active?: boolean;
  payload?: TooltipPayload;
  label?: string | number;
  directions?: Record<string, FinancialDirection | undefined>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border/70 bg-popover/95 p-3 shadow-lg backdrop-blur">
      {label != null ? (
        <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground">
          {label}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {payload.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: item.color ?? "var(--primary)" }}
              />
              {item.name}
            </span>
            <span className={`font-semibold tabular-nums ${financialAmountClass(typeof item.value === "number" ? item.value : null)}`}>
              {tooltipFmt(item.value as number)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartLegend({ payload }: { payload?: { value?: string | number; name?: string; color?: string }[] }) {
  if (!payload?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {payload.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
          {item.value ?? item.name}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  chartHeight = 288,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  chartHeight?: number;
}) {
  return (
    <Card className="min-w-0 rounded-lg border-border/70 bg-card p-4 shadow-none">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="w-full min-w-0 overflow-hidden" style={{ height: chartHeight }}>{children}</div>
    </Card>
  );
}

export function CombinedDreChart({ data }: { data: ChartDatum[] }) {
  if (!data.length) return <EmptyState title="Sem dados no período" />;
  return <ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.3} />
      <XAxis dataKey="period" {...AXIS} dy={8} />
      <YAxis {...AXIS} tickFormatter={tickFmt} width={52} />
      <Tooltip content={<ChartTooltip directions={{ result: "higher" }} />} />
      <Legend content={<ChartLegend />} />
      <Area isAnimationActive={false} type="monotone" dataKey="revenue" name="Receitas da DRE" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.12} strokeWidth={3} />
      <Bar isAnimationActive={false} dataKey="expense" name="Deduções e despesas da DRE" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={20} opacity={0.8} />
      <Line isAnimationActive={false} type="monotone" dataKey="result" name="Lucro líquido" stroke="var(--chart-3)" strokeWidth={3} dot={{ r: 3 }} />
    </ComposedChart>
  </ResponsiveContainer>;
}

export function MultiBarChart({
  data,
  xKey,
  series,
}: {
  data: ChartDatum[];
  xKey: string;
  series: { key: string; name: string; color?: string; direction?: FinancialDirection }[];
}) {
  if (data.length === 0)
    return (
      <EmptyState
        title="Sem dados no período"
        description="Ajuste os filtros ou selecione outro intervalo."
        actionLabel="Revisar filtros"
      />
    );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 8, right: 4, left: -12 }}>
        <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} dy={6} />
        <YAxis {...AXIS} tickFormatter={tickFmt} width={52} />
        <Tooltip content={<ChartTooltip directions={Object.fromEntries(series.map((s) => [s.key, s.direction]))} />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
        <Legend content={<ChartLegend />} wrapperStyle={{ left: 0, width: "100%" }} />
        {series.map((s, i) => (
          <Bar
            isAnimationActive={false}
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color ?? COLORS[i % COLORS.length]}
            radius={[5, 5, 0, 0]}
            maxBarSize={26}
          >
            {s.direction && data.map((entry, index) => <Cell key={index} fill={s.direction === "higher" && Number(entry[s.key]) < 0 ? "var(--destructive)" : s.color ?? COLORS[i % COLORS.length]} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineSeriesChart({
  data,
  xKey,
  series,
}: {
  data: ChartDatum[];
  xKey: string;
  series: { key: string; name: string; color?: string }[];
}) {
  if (data.length === 0)
    return (
      <EmptyState
        title="Sem dados no período"
        description="Ajuste os filtros ou selecione outro intervalo."
      />
    );
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 4, left: -12 }}>
        <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} dy={6} />
        <YAxis {...AXIS} tickFormatter={tickFmt} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
        <Legend content={<ChartLegend />} wrapperStyle={{ left: 0, width: "100%" }} />
        {series.map((s, i) => (
          <Line
            isAnimationActive={false}
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color ?? COLORS[i % COLORS.length]}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function AreaSeriesChart({
  data,
  xKey,
  areaKey,
  name,
  color,
}: {
  data: ChartDatum[];
  xKey: string;
  areaKey: string;
  name: string;
  color?: string;
}) {
  if (data.length === 0)
    return (
      <EmptyState
        title="Sem dados no período"
        description="Ajuste os filtros ou selecione outro intervalo."
      />
    );
  const stroke = color ?? "var(--chart-1)";
  const gradientId = `area-${areaKey.replace(/\W/g, "")}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -12 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS} dy={6} />
        <YAxis {...AXIS} tickFormatter={tickFmt} width={52} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey={areaKey}
          name={name}
          stroke={stroke}
          fill={`url(#${gradientId})`}
          strokeWidth={2.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarsChart({
  data,
  nameKey = "name",
  valueKey = "amount",
  direction,
}: {
  data: ChartDatum[];
  nameKey?: string;
  valueKey?: string;
  direction?: FinancialDirection;
}) {
  if (data.length === 0)
    return (
      <EmptyState
        title="Sem dados no período"
        description="Ajuste os filtros ou selecione outro intervalo."
      />
    );

  const max = data.reduce((acc, d) => Math.max(acc, Math.abs(Number(d[valueKey]) || 0)), 1);

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto pr-2">
      <div className="my-auto flex flex-col gap-3.5">
      {data.map((d, i) => {
        const value = Number(d[valueKey]) || 0;
        const pct = (Math.abs(value) / max) * 100;
        const color = direction === "lower" ? "var(--chart-2)" : direction === "higher" ? "var(--chart-1)" : COLORS[i % COLORS.length];
        return (
          <div key={`${d[nameKey]}-${i}`} className="group">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
                <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="truncate" title={String(d[nameKey])}>{String(d[nameKey])}</span>
              </span>
              <span className={`shrink-0 text-xs font-semibold tabular-nums ${financialAmountClass(value)}`}>
                {BRL.format(value)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(pct, 2)}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

export function DonutChart({
  data,
  nameKey = "name",
  valueKey = "amount",
  direction,
}: {
  data: ChartDatum[];
  nameKey?: string;
  valueKey?: string;
  direction?: FinancialDirection;
}) {
  if (data.length === 0)
    return (
      <EmptyState
        title="Sem dados no período"
        description="Ajuste os filtros ou selecione outro intervalo."
      />
    );
  const colorFor = (_entry: ChartDatum, index: number) => COLORS[index % COLORS.length];
  return (
    <div className="flex h-full min-w-0 flex-col">
    <div className="h-48 shrink-0">
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip content={<ChartTooltip />} />
        <Pie
          isAnimationActive={false}
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          innerRadius={52}
          outerRadius={80}
          paddingAngle={3}
          stroke="var(--card)"
          strokeWidth={2}
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={colorFor(entry, i)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    </div>
    <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-xs">
      {data.map((entry, i) => <li key={`${entry[nameKey]}-${i}`} className="flex items-start gap-2">
        <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: colorFor(entry, i) }} />
        <span className="min-w-0 flex-1 break-words">{String(entry[nameKey])}</span>
        <span className={`shrink-0 tabular-nums ${financialAmountClass(Number(entry[valueKey]) || 0)}`}>{BRL.format(Number(entry[valueKey]) || 0)}</span>
      </li>)}
    </ul>
    </div>
  );
}
