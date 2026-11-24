import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useServerFn } from "@tanstack/react-start";
import {
  listCollaborators,
  getCollaboratorAvailability,
  updateCollaborator,
  deleteCollaborator,
  type Collaborator,
} from "@/lib/collaborators.functions";
import { Loader2, Pencil, RefreshCw, Trash2, Users, X, Check } from "lucide-react";
import { toast } from "sonner";
import { usePlatformAccess } from "@/context/PlatformAccessContext";
import { Checkbox } from "@/components/ui/checkbox";

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  controller: "Controller",
  viewer: "Visualizador",
};

export function CollaboratorsManager() {
  const access = usePlatformAccess();
  const fetchList = useServerFn(listCollaborators);
  const saveOne = useServerFn(updateCollaborator);
  const removeOne = useServerFn(deleteCollaborator);

  const [rows, setRows] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("viewer");
  const [editCompanies, setEditCompanies] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Collaborator | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (!access.securityReady) {
        setUnavailable("Liberacao de clientes bloqueada: falta aplicar a protecao por empresa no banco ativo.");
        return;
      }
      const availability = await getCollaboratorAvailability();
      if (!availability.isAdmin || !availability.configured) {
        setUnavailable(!availability.isAdmin ? "Acesso restrito a administradores." : "Gestao de colaboradores indisponivel: falta configurar a credencial administrativa do Supabase no servidor.");
        return;
      }
      setUnavailable(null);
      const data = await fetchList({ data: undefined } as never);
      setRows(data as Collaborator[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      const isAuthError = /authorization|unauthorized|sess[aã]o|login/i.test(message);
      setError(
        isAuthError
          ? "Não foi possível carregar os colaboradores agora. Atualize a página e tente novamente."
          : "Não foi possível carregar os colaboradores.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(row: Collaborator) {
    setEditingId(row.userId);
    setEditName(row.fullName);
    setEditRole(row.role);
    setEditCompanies(row.companyIds);
  }

  async function handleSave(row: Collaborator) {
    setSaving(true);
    try {
      await saveOne({ data: { userId: row.userId, fullName: editName, role: editRole, companyIds: editCompanies } });
      toast.success("Colaborador atualizado.");
      setEditingId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: Collaborator) {
    setSaving(true);
    try {
      await removeOne({ data: { userId: row.userId } });
      toast.success("Colaborador excluído.");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold">Colaboradores</h3>
            <p className="text-xs text-muted-foreground">
              Visualize, edite o perfil de acesso ou remova usuários do sistema.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" aria-label="Atualizar colaboradores" title="Atualizar colaboradores" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {unavailable ? <p role="status" className="text-sm text-muted-foreground">{unavailable}</p> : loading ? (
        <p className="text-sm text-muted-foreground">Carregando colaboradores…</p>
      ) : error ? null : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum colaborador encontrado.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isEditing = editingId === row.userId;
            return (
              <li
                key={row.userId}
                className="rounded-xl border border-border/60 px-3 py-2.5"
              >
                {isEditing ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome</Label>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Perfil</Label>
                      <Select value={editRole} onValueChange={setEditRole}>
                        <SelectTrigger className="font-normal normal-case">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="controller">Controller</SelectItem>
                          <SelectItem value="viewer">Visualizador</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <fieldset className="space-y-2 sm:col-span-3"><legend className="mb-2 text-xs font-medium">Empresas autorizadas</legend>
                      {editRole === "admin" ? <p className="text-sm text-muted-foreground">Administrador tem acesso a todas as empresas.</p> : access.companies.map(company => <label key={company.id} className="flex items-center gap-2 text-sm"><Checkbox checked={editCompanies.includes(company.id)} onCheckedChange={checked => setEditCompanies(previous => checked ? [...previous, company.id] : previous.filter(id => id !== company.id))} />{company.name}</label>)}
                      {editRole !== "admin" && !editCompanies.length && <p className="text-xs text-muted-foreground">Sem empresas autorizadas, o usuario nao ve dados financeiros.</p>}
                    </fieldset>
                    <div className="flex gap-2 sm:col-span-3">
                      <Button size="sm" onClick={() => void handleSave(row)} disabled={saving}>
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4" />
                        )}
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                        disabled={saving}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {row.fullName || row.email || "Sem nome"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{row.role === "admin" ? "Todas as empresas" : access.companies.filter(c => row.companyIds.includes(c.id)).map(c => c.name).join(", ") || "Aguardando liberacao de empresa"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={row.role === "admin" ? "positive" : "neutral"}>
                        {ROLE_LABEL[row.role] ?? row.role}
                      </StatusBadge>
                      <Button size="sm" variant="outline" onClick={() => startEdit(row)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setConfirmDelete(row)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir colaborador?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.email} perderá o acesso imediatamente. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) void handleDelete(confirmDelete);
              }}
              disabled={saving}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
