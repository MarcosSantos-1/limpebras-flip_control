"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "react-toastify";
import { apiService, type PortatilAtribuicao, type PortatilModulo } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { servicoCurto, SUBS, subLabel } from "./labels";

const BTN_EMERALD =
  "bg-linear-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-950/10 border-0 font-semibold";

const SEM_SUB = "__sem_sub__";
const SEM_SERVICO = "__sem_servico__";

interface ServicoTabProps {
  modulos: PortatilModulo[];
  servicos: string[];
  onSaved: (nome: string, atribuicao: PortatilAtribuicao | null) => void;
}

export function ServicoTab({ modulos, servicos, onSaved }: ServicoTabProps) {
  const [search, setSearch] = useState("");
  const [subFilter, setSubFilter] = useState("all");
  const [servicoFilter, setServicoFilter] = useState("all");
  const [semVinculo, setSemVinculo] = useState(false);
  const [editing, setEditing] = useState<PortatilModulo | null>(null);
  const [sub, setSub] = useState("");
  const [servico, setServico] = useState("");
  const [saving, setSaving] = useState(false);

  const semVinculoCount = useMemo(
    () => modulos.filter((modulo) => !modulo.atribuicao?.servico).length,
    [modulos],
  );

  const servicosDisponiveis = useMemo(() => {
    const set = new Set(servicos);
    for (const modulo of modulos) {
      if (modulo.atribuicao?.servico) set.add(modulo.atribuicao.servico);
    }
    return [...set].sort((a, b) => servicoCurto(a).localeCompare(servicoCurto(b), "pt-BR"));
  }, [modulos, servicos]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return modulos.filter((modulo) => {
      const atribuicao = modulo.atribuicao;
      if (semVinculo && atribuicao?.servico) return false;
      if (subFilter !== "all" && atribuicao?.subprefeitura !== subFilter) return false;
      if (servicoFilter !== "all" && atribuicao?.servico !== servicoFilter) return false;
      if (!term) return true;
      const blob = [modulo.nome, atribuicao?.subprefeitura, subLabel(atribuicao?.subprefeitura), servicoCurto(atribuicao?.servico), atribuicao?.servico]
        .join(" ")
        .toLowerCase();
      return blob.includes(term);
    });
  }, [modulos, search, semVinculo, servicoFilter, subFilter]);

  function openEdit(modulo: PortatilModulo) {
    setEditing(modulo);
    setSub(modulo.atribuicao?.subprefeitura ?? "");
    setServico(modulo.atribuicao?.servico ?? "");
  }

  async function save(nextSub: string, nextServico: string) {
    if (!editing) return;
    setSaving(true);
    try {
      const result = await apiService.updatePortatilVinculo(editing.nome, {
        subprefeitura: nextSub,
        servico: nextServico,
      });
      onSaved(result.nome, result.atribuicao);
      toast.success(result.atribuicao ? "Serviço atualizado." : "Vínculo removido.");
      setEditing(null);
    } catch (err) {
      toast.error(apiService.extractErrorMessage(err, "Erro ao salvar o serviço"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        O portátil vale para a equipe inteira daquele serviço e sub, sem mapa. O preenchimento automático usa o report SELIMP até julho de 2026, quando um par concentra pelo menos 80% das saídas.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar módulo, sub ou serviço"
          />
        </div>
        <Select value={subFilter} onValueChange={setSubFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Sub" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as subs</SelectItem>
            {SUBS.map((item) => (
              <SelectItem key={item.sigla} value={item.sigla}>{item.sigla}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={servicoFilter} onValueChange={setServicoFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Serviço" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os serviços</SelectItem>
            {servicosDisponiveis.map((item) => (
              <SelectItem key={item} value={item}>{servicoCurto(item)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant={semVinculo ? "default" : "outline"} onClick={() => setSemVinculo((prev) => !prev)}>
          Sem vínculo ({semVinculoCount})
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Módulo</TableHead>
              <TableHead>Sub</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead className="w-[90px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((modulo) => {
              const atribuicao = modulo.atribuicao;
              return (
                <TableRow key={modulo.nome}>
                  <TableCell className="font-medium">{modulo.nome}</TableCell>
                  <TableCell>{atribuicao?.subprefeitura ? atribuicao.subprefeitura : "—"}</TableCell>
                  <TableCell title={atribuicao?.servico ?? undefined}>{servicoCurto(atribuicao?.servico)}</TableCell>
                  <TableCell>
                    {atribuicao?.origem === "historico" ? (
                      <Badge variant="outline">Histórico</Badge>
                    ) : atribuicao?.origem === "manual" ? (
                      <Badge variant="outline">Manual</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(modulo)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum módulo neste filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing != null} onOpenChange={(open) => !open && !saving && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Serviço do portátil</DialogTitle>
            <DialogDescription>
              {editing?.nome}. A sub e o serviço valem para todos os mapas dessa equipe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={sub || SEM_SUB} onValueChange={(value) => setSub(value === SEM_SUB ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Sub" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SUB}>Sem sub</SelectItem>
                {SUBS.map((item) => (
                  <SelectItem key={item.sigla} value={item.sigla}>
                    {item.sigla} — {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={servico || SEM_SERVICO} onValueChange={(value) => setServico(value === SEM_SERVICO ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Serviço" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_SERVICO}>Sem serviço</SelectItem>
                {servicosDisponiveis.map((item) => (
                  <SelectItem key={item} value={item}>{servicoCurto(item)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => void save("", "")}>
              Limpar
            </Button>
            <Button
              type="button"
              className={cn(BTN_EMERALD)}
              disabled={saving || Boolean(sub) !== Boolean(servico)}
              onClick={() => void save(sub, servico)}
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
