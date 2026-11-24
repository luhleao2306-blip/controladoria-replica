import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { useFilters } from "@/context/FiltersContext";
import { useOperationalSettings } from "@/hooks/use-operational-settings";
import { EMPTY_SETTINGS, type OperationalSettings as Settings } from "@/lib/operational-settings";
import { saveOperationalSettings } from "@/lib/operational-settings.functions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function OperationalSettings() {
  const { company, companyLabel } = useFilters();
  const query = useOperationalSettings(company);
  const [draft, setDraft] = useState<Settings>(EMPTY_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDirty(false); setDraft(EMPTY_SETTINGS); }, [company]);
  useEffect(() => { if (query.data && !dirty) setDraft(query.data.settings); }, [query.data, dirty]);
  if (company === "all") return <p className="text-sm text-muted-foreground">Selecione uma empresa para consultar as metas.</p>;
  if (query.isPending) return <p role="status">Carregando metas...</p>;
  if (query.isError) return <div role="alert"><p>Metas indisponiveis. Nenhuma configuracao foi alterada.</p><Button variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button></div>;
  const fields = [
    ["revenueTarget", "Meta mensal de receita liquida (R$)"],
    ["expenseBudget", "Orcamento mensal de despesas operacionais (R$)"],
    ["minMargin", "Margem liquida minima (%)"],
  ] as const;
  const rules = [["revenue", "Receita abaixo da meta"], ["expense", "Despesa acima do orcamento"],
    ["margin", "Margem abaixo do minimo"], ["overdue", "Lancamentos vencidos em aberto"]] as const;
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); setBusy(true);
    try { await saveOperationalSettings({ data: { company, settings: draft } });
      await query.invalidate(); setDirty(false); toast.success("Metas e regras salvas.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Nao foi possivel salvar."); }
    finally { setBusy(false); }
  }}>
    <p className="text-sm font-medium">{companyLabel}</p>
    {fields.map(([field, label]) => <div key={field} className="space-y-1">
      <Label htmlFor={field}>{label}</Label>
      <Input id={field} type="number" min={0} max={field === "minMargin" ? 100 : 1e12} step="0.01"
        placeholder="Nao definida" value={draft[field] ?? ""} disabled={busy}
        onChange={event => { setDirty(true); setDraft(previous => ({ ...previous, [field]: event.target.value === "" ? null : Number(event.target.value) })); }} />
    </div>)}
    <div className="space-y-3">{rules.map(([key, label]) => <div key={key} className="flex items-center justify-between gap-3">
      <Label htmlFor={`rule-${key}`}>{label}</Label><Switch id={`rule-${key}`} checked={draft.rules[key]} disabled={busy}
        onCheckedChange={checked => { setDirty(true); setDraft(previous => ({ ...previous, rules: { ...previous.rules, [key]: checked } })); }} />
    </div>)}</div>
    <Button type="submit" disabled={busy || !dirty}><Save className="mr-2 h-4 w-4" />{busy ? "Salvando..." : "Salvar metas e regras"}</Button>
  </form>;
}
