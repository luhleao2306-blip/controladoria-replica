import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export function MultiSelect({ label, values, options, onChange, allLabel = "Todos", className = "", disabled = false }: {
  label: string; values: string[]; options: { value: string; label: string; disabled?: boolean }[];
  onChange: (values: string[]) => void; allLabel?: string; className?: string; disabled?: boolean;
}) {
  const selected = options.filter(option => values.includes(option.value));
  const text = values.length ? selected.map(option => option.label).join(", ") : allLabel;
  const [search, setSearch] = useState("");
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const visible = options.filter(option => normalize(option.label).includes(normalize(search)));
  return <Popover onOpenChange={open => { if (!open) setSearch(""); }}><PopoverTrigger asChild>
    <button type="button" aria-label={label} title={text} disabled={disabled} className={`flex h-12 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      <span className="line-clamp-2 min-w-0 break-words leading-tight">{values.length > 2 ? `${values.length} selecionados` : text}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  </PopoverTrigger><PopoverContent align="start" className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto p-2">
    {options.length > 8 && <Input type="search" aria-label={`Buscar em ${label}`} placeholder="Buscar" className="mb-2 h-9" value={search} onChange={event => setSearch(event.target.value)} />}
    <div role="group" aria-label={label} className="space-y-1">
      <label className="flex cursor-pointer items-center gap-2 rounded-sm p-2 hover:bg-muted"><Checkbox checked={!values.length} onCheckedChange={() => onChange([])} /><span className="text-sm">{allLabel}</span></label>
      {visible.map(option => <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-sm p-2 hover:bg-muted has-[:disabled]:opacity-50">
        <Checkbox className="mt-0.5" checked={values.includes(option.value)} disabled={option.disabled && !values.includes(option.value)}
          onCheckedChange={checked => onChange(checked ? [...values, option.value] : values.filter(value => value !== option.value))} />
        <span className="min-w-0 break-words text-sm">{option.label}</span>
      </label>)}
      {!visible.length && <p className="p-2 text-sm text-muted-foreground">Nenhuma opção encontrada</p>}
    </div>
  </PopoverContent></Popover>;
}
