"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import penalidadesData from "@/lib/data/clausulas-penalidades.json";
import { Search } from "lucide-react";

export type ClausulaPenalidade = {
  item: string;
  descricao: string;
  grau: number | null;
  incidencia: string;
  valor: number;
  searchText: string;
};

const CLAUSULAS = penalidadesData.clausulas as ClausulaPenalidade[];

function formatBr(valor: number): string {
  if (valor <= 0 || isNaN(valor)) return "R$ 0,00";
  const [int, dec] = valor.toFixed(2).split(".");
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `R$ ${intFormatted},${dec}`;
}

function parseBrInput(s: string): number {
  const t = String(s ?? "").trim().replace(/\s/g, "").replace(/R\$/gi, "");
  const normalized = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : Math.max(0, n);
}

export function formatClausulaPersistText(c: ClausulaPenalidade): string {
  const grauLine = c.grau != null ? `Grau: ${c.grau}` : "";
  return [
    `Item ${c.item}`,
    c.descricao,
    c.incidencia ? `Incidência: ${c.incidencia}` : "",
    grauLine,
    `Valor de referência (planilha): ${formatBr(c.valor)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Exibição compacta do texto persistido da cláusula (card na ficha da ACIC). */
export function ClausulaMultaPersistDisplay({ text }: { text: string }) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const blocks = trimmed.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);

  if (blocks.length === 1 && !/^Item\s+/i.test(blocks[0])) {
    return <p className="text-sm leading-snug text-foreground whitespace-pre-wrap">{trimmed}</p>;
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, idx) => {
        const itemOnly = block.match(/^Item\s+(\S+)\s*$/i);
        if (itemOnly) {
          return (
            <div key={idx} className="mb-0.5 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-emerald-600 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide text-white shadow-sm dark:bg-emerald-700">
                {itemOnly[1]}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-800/90 dark:text-emerald-300/90">
                Item contratual
              </span>
            </div>
          );
        }
        if (/^Incidência:/i.test(block)) {
          const body = block.replace(/^Incidência:\s*/i, "").trim();
          return (
            <div
              key={idx}
              className="rounded-md border border-amber-500/55 bg-amber-500/12 px-2 py-1.5 dark:border-amber-600/50 dark:bg-amber-950/45"
            >
              <p className="text-[9px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Incidência (fator / base de cálculo)
              </p>
              <p className="text-xs font-semibold leading-snug text-amber-950 dark:text-amber-50">{body}</p>
            </div>
          );
        }
        if (/^Grau:/i.test(block)) {
          return (
            <p key={idx} className="text-[11px] font-medium leading-tight text-muted-foreground">
              {block}
            </p>
          );
        }
        if (/^Valor de referência/i.test(block)) {
          return (
            <p key={idx} className="font-mono text-xs font-bold leading-tight text-red-600 dark:text-red-400">
              {block}
            </p>
          );
        }
        return (
          <p key={idx} className="text-sm font-medium leading-snug text-foreground">
            {block}
          </p>
        );
      })}
    </div>
  );
}

type EntendimentoDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialText: string;
  onSave: (text: string) => Promise<void>;
};

export function AcicEntendimentoDialog({ open, onOpenChange, initialText, onSave }: EntendimentoDialogProps) {
  const [draft, setDraft] = useState(initialText);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(initialText);
  }, [open, initialText]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Entendimento para defesa prévia</DialogTitle>
          <DialogDescription>
            Registre a visão consolidada da ACIC para apoio à defesa prévia. Os dados são gravados no banco
            (PostgreSQL / Neon) na tabela de overrides — importações de CSV não substituem este texto, mesmo com
            mudança de status ou arquivamento.
          </DialogDescription>
        </DialogHeader>
        <textarea
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Observações, entendimento jurídico, pontos para defesa…"
          className={cn(
            "flex min-h-[180px] w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saving}
            className="border-0 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handleSave}
          >
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ValorMultaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValorBr: string;
  initialEstimativa: boolean;
  suggestEstimativa: boolean;
  /** Já existe valor ou cláusula salvos — preserva o flag de estimativa do servidor ao reabrir. */
  hasSavedMulta: boolean;
  initialClausulaTexto: string | null;
  onSave: (payload: {
    valor: number;
    clausulaTexto: string | null;
    estimativa: boolean;
  }) => Promise<void>;
  onClear: () => Promise<void>;
};

export function AcicValorMultaDialog({
  open,
  onOpenChange,
  initialValorBr,
  initialEstimativa,
  suggestEstimativa,
  hasSavedMulta,
  initialClausulaTexto,
  onSave,
  onClear,
}: ValorMultaDialogProps) {
  const [search, setSearch] = useState("");
  const [valorStr, setValorStr] = useState("");
  const [estimativa, setEstimativa] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [clausulaTexto, setClausulaTexto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setValorStr(initialValorBr);
    setEstimativa(hasSavedMulta ? Boolean(initialEstimativa) : suggestEstimativa);
    setSelectedItem(null);
    setClausulaTexto(initialClausulaTexto);
  }, [open, initialValorBr, initialEstimativa, suggestEstimativa, hasSavedMulta, initialClausulaTexto]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return CLAUSULAS;
    return CLAUSULAS.filter((c) => c.searchText.includes(q) || c.item.includes(q));
  }, [search]);

  const selectClausula = (c: ClausulaPenalidade) => {
    setSelectedItem(c.item);
    setClausulaTexto(formatClausulaPersistText(c));
    setValorStr(formatBr(c.valor));
  };

  const valorNum = parseBrInput(valorStr);

  const handleSave = async () => {
    if (valorNum <= 0) return;
    setSaving(true);
    try {
      await onSave({
        valor: valorNum,
        clausulaTexto: clausulaTexto?.trim() ? clausulaTexto.trim() : null,
        estimativa,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onClear();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92vh,800px)] max-w-3xl flex-col gap-4 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Valor da multa e cláusula</DialogTitle>
          <DialogDescription>
            Busque na planilha VALORES MULTAS. A lista mostra a descrição completa e a incidência (ex.: por veículo,
            por dia). Ao selecionar, o valor de referência é preenchido; você pode ajustar manualmente. Alterações são
            salvas no Neon. Em solicitação, use estimativa quando for o caso.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 shrink-0">
          <Label className="text-xs text-muted-foreground">Buscar cláusula</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Item, descrição ou incidência…"
              className="pl-9"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Lista de cláusulas</p>
          <div className="max-h-[min(42vh,400px)] overflow-y-auto rounded-md border border-border/80 bg-muted/20">
            {filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma cláusula encontrada.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {filtered.map((c) => {
                  const active = selectedItem === c.item;
                  return (
                    <li key={c.item}>
                      <button
                        type="button"
                        onClick={() => selectClausula(c)}
                        className={cn(
                          "w-full px-3 py-3 text-left text-sm transition-colors hover:bg-muted/80",
                          active && "bg-emerald-600/15 ring-inset ring-1 ring-emerald-600/40"
                        )}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="font-mono text-sm font-bold text-primary">{c.item}</span>
                          <span className="text-sm font-semibold text-foreground">{formatBr(c.valor)}</span>
                        </div>
                        {c.incidencia ? (
                          <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs font-semibold leading-snug text-amber-950 dark:border-amber-600/35 dark:bg-amber-950/35 dark:text-amber-100">
                            <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                              Incidência
                            </span>
                            {c.incidencia}
                          </p>
                        ) : null}
                        <p className="mt-2 text-sm leading-snug text-foreground">{c.descricao}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 shrink-0">
          <div className="space-y-1.5">
            <Label htmlFor="acic-valor-manual">Valor (R$)</Label>
            <Input
              id="acic-valor-manual"
              inputMode="decimal"
              placeholder="0,00"
              value={valorStr}
              onChange={(e) => setValorStr(e.target.value)}
              className="font-mono font-semibold text-red-600 dark:text-red-400"
            />
          </div>
          <div className="flex items-end pb-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="acic-estimativa"
                checked={estimativa}
                onCheckedChange={(c) => setEstimativa(c === true)}
              />
              <Label htmlFor="acic-estimativa" className="cursor-pointer text-sm font-normal leading-snug">
                Valor estimativo (não homologado / referência)
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleClear} disabled={saving}>
            Limpar valor e cláusula
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving || valorNum <= 0}
              className="border-0 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={handleSave}
            >
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
