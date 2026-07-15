"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { MapPin, Search, Pencil, RefreshCw, Hash, Radio, Loader2, AlertTriangle, CheckSquare, X, Check, Link2 } from "lucide-react";
import { toast } from "react-toastify";
import { apiService, type SetorModulo } from "@/lib/api";
import { servicoLabel } from "@/lib/ipt-utils";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/motion-ui/motion-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const SERVICO_BADGE: Record<string, string> = {
  "Praças": "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  "Sarjetas": "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400",
  "Sarjetas e Calçadas": "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400",
};

/** yyyy-MM-dd → dd/MM/yyyy (— quando vazio). */
function isoBr(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

interface EditForm {
  selimpCodigo: string;
  selimpInstalacao: string;
  ddmxCodigo: string;
  ddmxInstalacao: string;
}

interface BulkForm {
  selimpCodigo: string;
  selimpInstalacao: string;
  ddmxCodigo: string;
  ddmxInstalacao: string;
}

type BulkChangeKind = "novo" | "alteracao" | "atualizacao" | "igual";

function bulkChangeKind(s: SetorModulo, form: BulkForm): BulkChangeKind {
  const cur = (s.selimp_codigo ?? "").trim();
  const next = form.selimpCodigo.trim();
  const curDate = s.selimp_instalacao?.slice(0, 10) ?? "";
  const nextDate = form.selimpInstalacao.trim();
  if (!next && !nextDate) return "igual";
  if (!cur && next) return "novo";
  if (cur && next && cur !== next) return "alteracao";
  if (nextDate && nextDate !== curDate) return "atualizacao";
  if (next && cur === next && nextDate) return "atualizacao";
  return next || nextDate ? "atualizacao" : "igual";
}

const BULK_CHANGE_BADGE: Record<BulkChangeKind, string> = {
  novo: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
  alteracao: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
  atualizacao: "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
  igual: "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300",
};

const BULK_CHANGE_LABEL: Record<BulkChangeKind, string> = {
  novo: "Novo vínculo",
  alteracao: "Troca de módulo",
  atualizacao: "Atualização",
  igual: "Sem alteração",
};

export function SetoresTab() {
  const [setores, setSetores] = useState<SetorModulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState<string[]>([]);
  const [servicoFilter, setServicoFilter] = useState("all");
  const [semSelimp, setSemSelimp] = useState(false);

  const [editing, setEditing] = useState<SetorModulo | null>(null);
  const [form, setForm] = useState<EditForm>({ selimpCodigo: "", selimpInstalacao: "", ddmxCodigo: "", ddmxInstalacao: "" });
  const [saving, setSaving] = useState(false);

  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<BulkForm>({ selimpCodigo: "", selimpInstalacao: "", ddmxCodigo: "", ddmxInstalacao: "" });
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { setores } = await apiService.getSetores();
      setSetores(setores ?? []);
    } catch (err) {
      setError(apiService.extractErrorMessage(err, "Erro ao carregar setores"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const subs = useMemo(
    () => Array.from(new Set(setores.map((s) => s.subprefeitura).filter(Boolean) as string[])).sort(),
    [setores],
  );
  const servicos = useMemo(
    () => Array.from(new Set(setores.map((s) => servicoLabel(s.servico)))).sort(),
    [setores],
  );

  const filtered = useMemo(() => {
    let result = setores;
    if (subFilter.length > 0) result = result.filter((s) => subFilter.includes(s.subprefeitura ?? ""));
    if (servicoFilter !== "all") result = result.filter((s) => servicoLabel(s.servico) === servicoFilter);
    if (semSelimp) result = result.filter((s) => !s.selimp_codigo || !s.selimp_codigo.trim());
    const term = search.trim().toLowerCase();
    if (term) {
      result = result.filter(
        (s) =>
          s.setor.toLowerCase().includes(term) ||
          (s.selimp_codigo ?? "").toLowerCase().includes(term) ||
          (s.ddmx_codigo ?? "").toLowerCase().includes(term) ||
          (s.subprefeitura ?? "").toLowerCase().includes(term),
      );
    }
    return result;
  }, [setores, subFilter, servicoFilter, semSelimp, search]);

  const semSelimpCount = useMemo(
    () => setores.filter((s) => !s.selimp_codigo || !s.selimp_codigo.trim()).length,
    [setores],
  );

  const selectedSetores = useMemo(
    () => filtered.filter((s) => selected.has(s.id)),
    [filtered, selected],
  );

  function sairSelecao() {
    setSelMode(false);
    setSelected(new Set());
    setLastIdx(null);
  }

  function toggleSelMode() {
    if (selMode) sairSelecao();
    else setSelMode(true);
  }

  function handleRowSelect(id: number, index: number, e: MouseEvent) {
    const isShift = e.shiftKey;
    setSelected((prev) => {
      const next = new Set(prev);
      if (isShift && lastIdx != null) {
        const [a, b] = [Math.min(lastIdx, index), Math.max(lastIdx, index)];
        for (let i = a; i <= b; i++) next.add(filtered[i].id);
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    if (!isShift) setLastIdx(index);
  }

  function openBulkModal() {
    const items = selectedSetores;
    const first = items[0];
    const allSameSelimp = items.length > 0 && items.every((s) => (s.selimp_codigo ?? "").trim() === (first?.selimp_codigo ?? "").trim());
    const firstDate = first?.selimp_instalacao?.slice(0, 10) ?? "";
    const allSameDate = items.length > 0 && items.every((s) => (s.selimp_instalacao?.slice(0, 10) ?? "") === firstDate);
    setBulkForm({
      selimpCodigo: allSameSelimp ? (first?.selimp_codigo ?? "").trim() : "",
      selimpInstalacao: allSameDate ? firstDate : "",
      ddmxCodigo: "",
      ddmxInstalacao: "",
    });
    setBulkOpen(true);
  }

  async function confirmBulk() {
    if (selectedSetores.length === 0) return;
    const codigo = bulkForm.selimpCodigo.trim();
    if (!codigo) {
      toast.error("Informe o código SELIMP para vincular os setores.");
      return;
    }
    setBulkSaving(true);
    try {
      for (const s of selectedSetores) {
        await apiService.updateSetorModulo(s.id, {
          selimpCodigo: codigo,
          selimpInstalacao: bulkForm.selimpInstalacao || "",
          ...(bulkForm.ddmxCodigo.trim() ? { ddmxCodigo: bulkForm.ddmxCodigo.trim() } : {}),
          ...(bulkForm.ddmxInstalacao ? { ddmxInstalacao: bulkForm.ddmxInstalacao } : {}),
        });
      }
      toast.success(`${selectedSetores.length} setor(es) vinculado(s) ao módulo ${codigo}.`);
      setBulkOpen(false);
      sairSelecao();
      await load();
    } catch (err) {
      toast.error(apiService.extractErrorMessage(err, "Erro ao vincular setores ao módulo"));
    } finally {
      setBulkSaving(false);
    }
  }

  function openEdit(s: SetorModulo) {
    setEditing(s);
    setForm({
      selimpCodigo: s.selimp_codigo ?? "",
      selimpInstalacao: s.selimp_instalacao ? s.selimp_instalacao.slice(0, 10) : "",
      ddmxCodigo: s.ddmx_codigo ?? "",
      ddmxInstalacao: s.ddmx_instalacao ? s.ddmx_instalacao.slice(0, 10) : "",
    });
  }

  async function save() {
    if (!editing) return;
    try {
      setSaving(true);
      await apiService.updateSetorModulo(editing.id, {
        selimpCodigo: form.selimpCodigo.trim(),
        selimpInstalacao: form.selimpInstalacao || "",
        ddmxCodigo: form.ddmxCodigo.trim(),
        ddmxInstalacao: form.ddmxInstalacao || "",
      });
      setEditing(null);
      await load();
    } catch {
      console.error("Erro ao salvar atribuição do setor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-border/50 bg-card/80 shadow-sm backdrop-blur-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <MapPin className="h-5 w-5 text-emerald-500" /> Gestão de Setores
            </CardTitle>
            <CardDescription>
              Atribuição de módulos (SELIMP/DDMX) aos setores — {setores.length} setores, {semSelimpCount} sem SELIMP
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Atualizar
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar setor, SELIMP, DDMX..." className="h-9 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <MultiSelect
            compact
            className="w-[120px]"
            placeholder="Sub"
            emptyLabel="Todas as subs"
            options={subs.map((s) => ({ value: s, label: s }))}
            value={subFilter}
            onChange={setSubFilter}
          />
          <Select value={servicoFilter} onValueChange={setServicoFilter}>
            <SelectTrigger className="h-9 w-[190px]"><SelectValue placeholder="Serviço" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os serviços</SelectItem>
              {servicos.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-9 gap-1.5", semSelimp && "border-amber-500/50 text-amber-600 dark:text-amber-400")}
            onClick={() => setSemSelimp((v) => !v)}
          >
            Sem SELIMP ({semSelimpCount})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 gap-1.5",
              selMode && "border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
            )}
            onClick={toggleSelMode}
          >
            {selMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
            {selMode ? "Cancelar" : "Selecionar"}
          </Button>
          {selMode && selected.size > 0 && (
            <Button
              size="sm"
              className="h-9 gap-1.5 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
              onClick={openBulkModal}
            >
              <Link2 className="h-4 w-4" />
              Atribuir módulo ({selected.size})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && setores.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
            <p className="text-sm font-medium">Carregando setores…</p>
          </div>
        ) : error && setores.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <AlertTriangle className="h-10 w-10 text-red-500" />
            <p className="text-sm font-medium text-foreground">Erro ao carregar setores</p>
            <p className="max-w-md text-xs text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-1 gap-1.5" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>
        ) : (
        <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
          <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
            <TableHeader>
              <TableRow className="bg-muted/25 hover:bg-muted/25">
                {selMode && <TableHead className="w-9" />}
                <TableHead className="text-center">Sub</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Frequência</TableHead>
                <TableHead>SELIMP</TableHead>
                <TableHead>DDMX</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s, idx) => {
                const sel = selected.has(s.id);
                return (
                <TableRow
                  key={s.id}
                  className={cn("border-border/30 hover:bg-muted/20", selMode && sel && "bg-emerald-500/10")}
                  onClick={selMode ? (e) => handleRowSelect(s.id, idx, e) : undefined}
                  style={selMode ? { cursor: "pointer", userSelect: "none" } : undefined}
                >
                  {selMode && (
                    <TableCell className="text-center align-middle">
                      <span
                        className={cn(
                          "inline-flex h-4 w-4 items-center justify-center rounded border transition-colors",
                          sel ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-400 dark:border-zinc-600",
                        )}
                      >
                        {sel && <Check className="h-3 w-3" />}
                      </span>
                    </TableCell>
                  )}
                  <TableCell className="text-center font-medium align-top">{s.subprefeitura || "—"}</TableCell>
                  <TableCell className="align-top font-mono text-xs sm:text-sm">{s.setor}</TableCell>
                  <TableCell className="align-top">
                    <Badge className={SERVICO_BADGE[servicoLabel(s.servico)] ?? "bg-zinc-500/15 text-zinc-600 border-zinc-500/30 dark:text-zinc-300"}>
                      {servicoLabel(s.servico)}
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top text-xs text-muted-foreground">{s.frequencia || "—"}</TableCell>
                  <TableCell className="align-top">
                    {s.selimp_codigo ? (
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-1 font-mono text-xs"><Hash className="h-3 w-3 text-muted-foreground" />{s.selimp_codigo}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{isoBr(s.selimp_instalacao)}</span>
                      </div>
                    ) : (
                      <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400">Sem SELIMP</Badge>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {s.ddmx_codigo ? (
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-1 font-mono text-xs"><Radio className="h-3 w-3 text-muted-foreground" />{s.ddmx_codigo}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{isoBr(s.ddmx_instalacao)}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center align-top">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Editar atribuição"
                      disabled={selMode}
                      onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={selMode ? 8 : 7} className="py-10 text-center text-sm text-muted-foreground">Nenhum setor encontrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Edição individual pelo ícone de lápis. Use &quot;Selecionar&quot; para vincular vários setores ao mesmo módulo SELIMP e data de instalação.
        </p>
      </CardContent>

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Pencil className="h-5 w-5 text-emerald-500" /> Atribuição — {editing?.setor}
            </DialogTitle>
            <DialogDescription>
              {servicoLabel(editing?.servico)} · {editing?.subprefeitura || "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">SELIMP (código)</label>
              <Input value={form.selimpCodigo} placeholder="ex.: 03-0055" onChange={(e) => setForm((f) => ({ ...f, selimpCodigo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Instalação SELIMP</label>
              <DatePicker value={form.selimpInstalacao} onChange={(v) => setForm((f) => ({ ...f, selimpInstalacao: v }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">DDMX (código)</label>
              <Input value={form.ddmxCodigo} placeholder="ex.: LT-0123" onChange={(e) => setForm((f) => ({ ...f, ddmxCodigo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Instalação DDMX</label>
              <DatePicker value={form.ddmxInstalacao} onChange={(v) => setForm((f) => ({ ...f, ddmxInstalacao: v }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void save()} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={(o) => !o && !bulkSaving && setBulkOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-5 w-5 text-emerald-500" />
              Atribuir módulo — {selectedSetores.length} setor(es)
            </DialogTitle>
            <DialogDescription>
              Vincule os setores selecionados ao mesmo código SELIMP e data de instalação. Revise a lista antes de confirmar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
              {selectedSetores.map((s) => {
                const kind = bulkChangeKind(s, bulkForm);
                const cur = (s.selimp_codigo ?? "").trim() || "Sem SELIMP";
                const next = bulkForm.selimpCodigo.trim();
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "rounded-md border px-2.5 py-2 text-xs",
                      kind === "novo" && "border-emerald-500/30 bg-emerald-500/5",
                      kind === "alteracao" && "border-amber-500/30 bg-amber-500/5",
                      kind === "atualizacao" && "border-sky-500/30 bg-sky-500/5",
                      kind === "igual" && "border-border/40 bg-background/40",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">{s.setor}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {s.subprefeitura || "—"}
                        </Badge>
                        <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", BULK_CHANGE_BADGE[kind])}>
                          {BULK_CHANGE_LABEL[kind]}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-muted-foreground">{cur}</span>
                      {next && (
                        <>
                          <span className="text-muted-foreground">→</span>
                          <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-300">
                            <Hash className="h-3 w-3" />
                            {next}
                          </span>
                        </>
                      )}
                    </div>
                    {bulkForm.selimpInstalacao && (
                      <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                        Instalação: {isoBr(bulkForm.selimpInstalacao)}
                        {s.selimp_instalacao?.slice(0, 10) && s.selimp_instalacao.slice(0, 10) !== bulkForm.selimpInstalacao && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">(era {isoBr(s.selimp_instalacao)})</span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">SELIMP (código) *</label>
                <Input
                  value={bulkForm.selimpCodigo}
                  placeholder="ex.: 03-0055"
                  onChange={(e) => setBulkForm((f) => ({ ...f, selimpCodigo: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Instalação SELIMP</label>
                <DatePicker
                  value={bulkForm.selimpInstalacao}
                  onChange={(v) => setBulkForm((f) => ({ ...f, selimpInstalacao: v }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">DDMX (opcional)</label>
                <Input
                  value={bulkForm.ddmxCodigo}
                  placeholder="ex.: LT-0123"
                  onChange={(e) => setBulkForm((f) => ({ ...f, ddmxCodigo: e.target.value }))}
                />
              </div>
              {bulkForm.ddmxCodigo.trim() && (
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Instalação DDMX</label>
                  <DatePicker
                    value={bulkForm.ddmxInstalacao}
                    onChange={(v) => setBulkForm((f) => ({ ...f, ddmxInstalacao: v }))}
                  />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
              Cancelar
            </Button>
            <Button
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={bulkSaving || !bulkForm.selimpCodigo.trim()}
              onClick={() => void confirmBulk()}
            >
              {bulkSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvando…
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4" /> Vincular {selectedSetores.length}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
