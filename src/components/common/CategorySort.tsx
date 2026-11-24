import { ArrowDownAZ } from "lucide-react";
import type { CategoryOrder } from "@/lib/dre-details";

export function CategorySort({ value, onChange }: { value: CategoryOrder; onChange: (order: CategoryOrder) => void }) {
  return <label className="inline-flex max-w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span className="inline-flex items-center gap-1.5"><ArrowDownAZ size={16} />Ordenar categorias</span>
    <select aria-label="Ordenar categorias" value={value} onChange={event => onChange(event.target.value as CategoryOrder)}
      className="min-h-9 min-w-0 max-w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground">
      <option value="amount-desc">Valor: maior para menor</option>
      <option value="amount-asc">Valor: menor para maior</option>
      <option value="code-asc">Código / nome: A a Z</option>
      <option value="code-desc">Código / nome: Z a A</option>
    </select>
  </label>;
}
