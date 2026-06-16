"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, Search, Pencil, RefreshCw, Hash, Radio } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export function SetoresTab() {
  const [setores, setSetores] = useState<SetorModulo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState("all");
  const [servicoFilter, setServicoFilter] = useState("all");
  const [semSelimp, setSemSelimp] = useState(false);

  const [editing, setEditing] = useState<SetorModulo | null>(null);
  const [form, setForm] = useState<EditForm>({ selimpCodigo: "", selimpInstalacao: "", ddmxCodigo: "", ddmxInstalacao: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { setores } = await apiService.getSetores();
      setSetores(setores ?? []);
    } catch {
      console.error("Erro ao carregar setores");
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
    if (subFilter !== "all") result = result.filter((s) => s.subprefeitura === subFilter);
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
          <Select value={subFilter} onValueChange={setSubFilter}>
            <SelectTrigger className="h-9 w-[120px]"><MapPin className="mr-1 h-4 w-4 text-muted-foreground" /><SelectValue placeholder="Sub" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as subs</SelectItem>
              {subs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl bg-muted/15 shadow-sm ring-1 ring-zinc-200/80 dark:ring-zinc-700/60">
          <Table className="[&_tbody_tr]:border-b [&_tbody_tr]:border-border/30 [&_thead_tr]:border-b [&_thead_tr]:border-border/30">
            <TableHeader>
              <TableRow className="bg-muted/25 hover:bg-muted/25">
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
              {filtered.map((s) => (
                <TableRow key={s.id} className="border-border/30 hover:bg-muted/20">
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar atribuição" onClick={() => openEdit(s)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Nenhum setor encontrado.</TableCell></TableRow>
              )}
              {loading && (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">Carregando…</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Edição apenas de atribuição de módulos. Ao salvar, o snapshot por módulo é reconstruído automaticamente.
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
    </Card>
  );
}
