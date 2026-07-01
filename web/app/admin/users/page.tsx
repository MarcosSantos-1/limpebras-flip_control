"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Clock3, Eye, EyeOff, Pencil, Plus, ShieldCheck, UserCog } from "lucide-react";
import { MainLayout } from "@/components/layout/main-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiService, type AuthPageKey, type AuthUser } from "@/lib/api";
import { AUTH_PAGE_KEYS } from "@/lib/auth-shared";
import { useAuth } from "@/lib/auth";

type EditorState = {
  open: boolean;
  mode: "create" | "edit";
  user: AuthUser | null;
};

type FormState = {
  username: string;
  display_name: string;
  password: string;
  role: "host" | "user";
  access_profile: "default" | "cco";
  status: "active" | "inactive";
  blocked: boolean;
  page_permissions: Record<AuthPageKey, boolean>;
};

const PAGE_LABELS: Record<AuthPageKey, string> = {
  dashboard: "Dashboard",
  indicadores: "Indicadores",
  ipt: "IPT Geral",
  ipt_restrito: "IPT restrito",
  ipt_despachos: "Despachos SELIMP",
  plano_trabalho: "Plano de trabalho",
  cco: "CCO",
  sacs: "SACs",
  bfs: "BFSs",
  defesa: "Defesa / Contestação",
  acic: "ACICs",
  upload: "Upload",
  admin_users: "Administração de usuários",
};

const PERMISSION_PAGE_KEYS: AuthPageKey[] = [
  "dashboard",
  "indicadores",
  "ipt",
  "ipt_despachos",
  "plano_trabalho",
  "sacs",
  "bfs",
  "defesa",
  "acic",
  "upload",
  "admin_users",
];

const DEFAULT_USER_PAGE_KEYS: AuthPageKey[] = [
  "dashboard",
  "indicadores",
  "ipt",
  "ipt_despachos",
  "plano_trabalho",
  "sacs",
  "bfs",
  "acic",
];
/** CCO: acesso somente às páginas do IPT (a chave `cco` marca o perfil; `ipt` libera as subpáginas). */
const CCO_PAGE_KEYS: AuthPageKey[] = ["ipt", "ipt_despachos", "plano_trabalho", "upload", "cco"];

function formatLastAccess(value: string | null | undefined): { label: string; detail: string; recent: boolean; never: boolean } {
  if (!value) {
    return {
      label: "Nunca acessou",
      detail: "Sem registro de sessão",
      recent: false,
      never: true,
    };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      label: "Acesso registrado",
      detail: value,
      recent: false,
      never: false,
    };
  }

  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - date.getTime()) / 60000));
  const recent = diffMinutes <= 60;
  const label =
    diffMinutes < 1
      ? "Agora há pouco"
      : diffMinutes < 60
      ? `${diffMinutes} min atrás`
      : diffMinutes < 1440
      ? `${Math.round(diffMinutes / 60)} h atrás`
      : `${Math.round(diffMinutes / 1440)} d atrás`;

  return {
    label,
    detail: date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }),
    recent,
    never: false,
  };
}

function buildPagePermissions(allowedPageKeys: readonly AuthPageKey[]): Record<AuthPageKey, boolean> {
  const allowed = new Set(allowedPageKeys);
  return Object.fromEntries(AUTH_PAGE_KEYS.map((pageKey) => [pageKey, allowed.has(pageKey)])) as Record<AuthPageKey, boolean>;
}

function detectAccessProfile(user?: AuthUser | null): "default" | "cco" {
  if (user?.role === "host") return "default";
  if (user?.is_cco) return "cco";
  return "default";
}

function normalizePermissionsForRole(
  permissions: Record<AuthPageKey, boolean>,
  role: "host" | "user",
): Record<AuthPageKey, boolean> {
  if (role === "host") return buildPagePermissions(AUTH_PAGE_KEYS);
  return {
    ...permissions,
    admin_users: false,
  };
}

function buildInitialForm(user?: AuthUser | null): FormState {
  const accessProfile = detectAccessProfile(user);
  const fallbackPermissions =
    user?.role === "host"
      ? buildPagePermissions(AUTH_PAGE_KEYS)
      : accessProfile === "cco"
      ? buildPagePermissions(CCO_PAGE_KEYS)
      : buildPagePermissions(DEFAULT_USER_PAGE_KEYS);
  const storedPermissions = Object.fromEntries(
    AUTH_PAGE_KEYS.map((pageKey) => [pageKey, user?.page_permissions?.[pageKey] ?? fallbackPermissions[pageKey]])
  ) as Record<AuthPageKey, boolean>;
  const resolvedPermissions = accessProfile === "cco" && user?.role !== "host" ? fallbackPermissions : storedPermissions;

  return {
    username: user?.username ?? "",
    display_name: user?.display_name ?? "",
    password: user?.visible_password ?? "",
    role: user?.role ?? "user",
    access_profile: accessProfile,
    status: user?.status ?? "active",
    blocked: user?.blocked ?? false,
    page_permissions: normalizePermissionsForRole(resolvedPermissions, user?.role ?? "user"),
  };
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [editor, setEditor] = useState<EditorState>({ open: false, mode: "create", user: null });
  const [form, setForm] = useState<FormState>(buildInitialForm());
  const [showPasswordInDialog, setShowPasswordInDialog] = useState(false);
  const [passwordVisibleByUserId, setPasswordVisibleByUserId] = useState<Record<number, boolean>>({});
  const [copiedUserId, setCopiedUserId] = useState<number | null>(null);

  async function loadUsers() {
    setLoading(true);
    setErrorMessage("");
    try {
      const data = await apiService.getUsers();
      setItems(data.items);
    } catch (error) {
      setErrorMessage(apiService.extractErrorMessage(error, "Não foi possível carregar os usuários."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    setForm(buildInitialForm(editor.user));
  }, [editor.user]);

  useEffect(() => {
    if (editor.open) setShowPasswordInDialog(false);
  }, [editor.open]);

  const canEditSelf = useMemo(() => {
    if (!editor.user || !user) return true;
    return editor.user.id !== user.id;
  }, [editor.user, user]);

  const isPermissionPresetLocked = form.role === "host" || form.access_profile === "cco";

  function applyAccessProfile(profile: "default" | "cco", role: "host" | "user") {
    if (role === "host") {
      return buildPagePermissions(AUTH_PAGE_KEYS);
    }
    if (profile === "cco") return buildPagePermissions(CCO_PAGE_KEYS);
    return buildPagePermissions(DEFAULT_USER_PAGE_KEYS);
  }

  function openCreateDialog() {
    setEditor({ open: true, mode: "create", user: null });
    setForm(buildInitialForm(null));
  }

  function openEditDialog(nextUser: AuthUser) {
    setEditor({ open: true, mode: "edit", user: nextUser });
  }

  async function handleSave() {
    setSaving(true);
    setErrorMessage("");
    try {
      const normalizedPermissions = normalizePermissionsForRole(form.page_permissions, form.role);
      const payload = { ...form, page_permissions: normalizedPermissions };
      if (editor.mode === "create") {
        await apiService.createUser(payload);
      } else if (editor.user) {
        await apiService.updateUser(editor.user.id, {
          display_name: payload.display_name,
          password: payload.password,
          role: payload.role,
          status: payload.status,
          blocked: payload.blocked,
          page_permissions: normalizedPermissions,
        });
      }
      setEditor({ open: false, mode: "create", user: null });
      await loadUsers();
    } catch (error) {
      setErrorMessage(apiService.extractErrorMessage(error, "Não foi possível salvar o usuário."));
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyAccess(item: AuthUser) {
    const text = `*ADC Control - Acesso:*\nusuário: ${item.username}\nsenha: ${item.visible_password}`;
    await navigator.clipboard.writeText(text);
    setCopiedUserId(item.id);
    window.setTimeout(() => setCopiedUserId((current) => (current === item.id ? null : current)), 1800);
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <Card className="border-blue-200/50 bg-linear-to-br from-blue-50 via-white to-cyan-50 dark:border-blue-900/40 dark:from-blue-950/30 dark:via-card dark:to-card">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-3 text-3xl font-bold tracking-tight">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg">
                  <UserCog className="h-6 w-6" />
                </span>
                Gestão de usuários
              </CardTitle>
              <CardDescription className="mt-3 max-w-2xl text-sm leading-relaxed">
                Área exclusiva do host para criar usuários, ajustar status, bloquear acesso e controlar permissões por página.
              </CardDescription>
            </div>
            <Button className="gap-2" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              Novo usuário
            </Button>
          </CardHeader>
        </Card>

        {errorMessage ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-4">
          {loading ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">Carregando usuários...</CardContent>
            </Card>
          ) : (
            items.map((item) => {
              const lastAccess = formatLastAccess(item.last_access_at);
              return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-4 pt-6 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{item.display_name || item.username}</span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        @{item.username}
                      </span>
                      {item.role === "host" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/20 dark:text-amber-100">
                          👑 Host
                        </span>
                      ) : item.is_cco ? (
                        <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-xs font-semibold text-cyan-900 dark:border-cyan-400/30 dark:bg-cyan-500/20 dark:text-cyan-100">
                          CCO
                        </span>
                      ) : (
                        <span className="rounded-full border border-violet-400/35 bg-violet-500/12 px-2.5 py-1 text-xs font-medium text-violet-900 dark:border-violet-400/25 dark:bg-violet-500/18 dark:text-violet-100">
                          Usuário
                        </span>
                      )}
                      <span className="rounded-full border border-emerald-400/35 bg-emerald-500/12 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:border-emerald-400/25 dark:bg-emerald-500/18 dark:text-emerald-100">
                        {item.status === "active" ? "Ativo" : "Inativo"}
                      </span>
                      {item.blocked ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-950/60 dark:text-red-200">
                          Bloqueado
                        </span>
                      ) : null}
                    </div>
                    <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                      <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-wide">Último acesso</div>
                          <span
                            className={[
                              "h-2.5 w-2.5 rounded-full",
                              lastAccess.never
                                ? "animate-pulse border border-slate-400 bg-transparent"
                                : lastAccess.recent
                                ? "animate-pulse bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]"
                                : "bg-cyan-500",
                            ].join(" ")}
                            aria-hidden="true"
                          />
                        </div>
                        <div className="flex items-center gap-2 text-foreground">
                          <Clock3 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{lastAccess.label}</span>
                        </div>
                        <div className="mt-1 text-xs">{lastAccess.detail}</div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-wide">Senha atual</div>
                          <button
                            type="button"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground"
                            onClick={() =>
                              setPasswordVisibleByUserId((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            aria-label={passwordVisibleByUserId[item.id] ? "Esconder senha" : "Mostrar senha"}
                          >
                            {passwordVisibleByUserId[item.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <div className="break-all font-mono text-foreground">
                          {passwordVisibleByUserId[item.id]
                            ? item.visible_password
                            : "•".repeat(Math.max(8, item.visible_password.length))}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2">
                        <div className="mb-1 text-xs font-semibold uppercase tracking-wide">Páginas liberadas</div>
                        <div className="text-foreground">
                          {PERMISSION_PAGE_KEYS.filter((pageKey) => item.page_permissions?.[pageKey])
                            .map((pageKey) => PAGE_LABELS[pageKey])
                            .join(", ")}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="gap-2" onClick={() => void handleCopyAccess(item)}>
                      {copiedUserId === item.id ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
                      {copiedUserId === item.id ? "Copiado" : "Copiar acesso"}
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={() => openEditDialog(item)}>
                      <Pencil className="h-4 w-4" />
                      Editar
                    </Button>
                  </div>
                </CardContent>
              </Card>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={editor.open} onOpenChange={(open) => setEditor((current) => ({ ...current, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {editor.mode === "create" ? "Novo usuário" : `Editar ${editor.user?.display_name || editor.user?.username}`}
            </DialogTitle>
            <DialogDescription>
              O host pode alterar status, bloquear acesso, redefinir senha e liberar páginas específicas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="user-name">Usuário</Label>
              <Input
                id="user-name"
                value={form.username}
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                disabled={editor.mode === "edit"}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="display-name">Nome exibido</Label>
              <Input
                id="display-name"
                value={form.display_name}
                onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPasswordInDialog ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  className="pr-11"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                  onClick={() => setShowPasswordInDialog((v) => !v)}
                  aria-label={showPasswordInDialog ? "Esconder senha" : "Mostrar senha"}
                >
                  {showPasswordInDialog ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="role">Perfil</Label>
              <Select
                value={form.role}
                onValueChange={(value: "host" | "user") =>
                  setForm((prev) => ({
                    ...prev,
                    role: value,
                    page_permissions: applyAccessProfile(prev.access_profile, value),
                  }))
                }
                disabled={!canEditSelf}
              >
                <SelectTrigger id="role" className="w-full bg-background">
                  <SelectValue placeholder="Perfil" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="host">👑 Host</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="access-profile">Acesso</Label>
              <Select
                value={form.access_profile}
                onValueChange={(value: "default" | "cco") =>
                  setForm((prev) => ({
                    ...prev,
                    access_profile: value,
                    page_permissions: applyAccessProfile(value, prev.role),
                  }))
                }
                disabled={form.role === "host"}
              >
                <SelectTrigger id="access-profile" className="w-full bg-background">
                  <SelectValue placeholder="Tipo de acesso" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Usuário padrão</SelectItem>
                  <SelectItem value="cco">CCO - IPT, Despachos, Upload e Plano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(value: "active" | "inactive") =>
                  setForm((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger id="status" className="w-full bg-background">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <Checkbox
                checked={form.blocked}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, blocked: checked === true }))}
              />
              <span className="text-sm text-muted-foreground">Usuário bloqueado</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4" />
              Permissões por página
            </div>
            <div className="grid gap-3 rounded-2xl border border-border/70 p-4 md:grid-cols-2">
              {PERMISSION_PAGE_KEYS.map((pageKey) => (
                <label key={pageKey} className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2">
                  <Checkbox
                    checked={form.role === "host" ? true : form.page_permissions[pageKey]}
                    disabled={isPermissionPresetLocked || (form.role !== "host" && pageKey === "admin_users")}
                    onCheckedChange={(checked) =>
                      setForm((prev) => ({
                        ...prev,
                        page_permissions: {
                          ...prev.page_permissions,
                          [pageKey]: checked === true,
                        },
                      }))
                    }
                  />
                  <span className="text-sm">{PAGE_LABELS[pageKey]}</span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor({ open: false, mode: "create", user: null })}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Salvando..." : editor.mode === "create" ? "Criar usuário" : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
