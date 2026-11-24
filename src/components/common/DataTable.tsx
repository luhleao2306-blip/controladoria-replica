import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "./EmptyState";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  emptyTitle,
  rowKey,
  resetKey = "",
}: {
  columns: Column<T>[];
  rows: T[];
  emptyTitle?: string;
  rowKey?: (row: T) => string | number;
  resetKey?: string;
}) {
  const [pagination, setPagination] = useState({ key: resetKey, page: 0 });
  const page = pagination.key === resetKey ? pagination.page : 0;
  const setPage = (page: number) => setPagination({ key: resetKey, page });
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  if (rows.length === 0)
    return (
      <EmptyState
        title={emptyTitle ?? "Sem registros"}
        description="Ajuste os filtros ou selecione outro período para continuar."
        actionLabel="Revisar filtros"
      />
    );
  return (
    <div>
    <div className="overflow-hidden rounded-lg border border-border">
      <Table containerClassName="max-h-[640px]">
        <TableHeader className="sticky top-0 z-20 bg-card">
          <TableRow className="border-border/70 hover:bg-transparent">
            {columns.map((c, ci) => (
              <TableHead
                key={c.key}
                className={`h-11 whitespace-nowrap text-xs font-semibold text-muted-foreground ${
                  ci === 0 ? "md:sticky md:left-0 md:z-30 md:bg-card" : ""
                } ${c.className ?? ""}`}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((r, i) => (
            <TableRow
              key={rowKey ? rowKey(r) : currentPage * pageSize + i}
              className="group border-border/40 hover:bg-muted/40"
            >
              {columns.map((c, ci) => (
                <TableCell
                  key={c.key}
                  className={`py-3 text-sm tabular-nums ${ci === 0 ? "min-w-52 max-w-72 break-words font-medium md:sticky md:left-0 md:z-10 md:bg-card" : ""} ${c.className ?? ""}`}
                >
                  {c.cell(r)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <span>{rows.length.toLocaleString("pt-BR")} registros · {currentPage + 1} / {pages}</span>
      <div className="flex gap-2">
        <button type="button" title="Pagina anterior" aria-label="Pagina anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="p-2 border rounded disabled:opacity-30"><ChevronLeft size={18} /></button>
        <button type="button" title="Proxima pagina" aria-label="Proxima pagina" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} className="p-2 border rounded disabled:opacity-30"><ChevronRight size={18} /></button>
      </div>
    </div>
    </div>
  );
}
