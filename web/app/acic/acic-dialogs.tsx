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
            Registre a visão consolidada da ACIC para apoio à defesa prévia. O texto fica salvo no servidor.
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
      <DialogContent className="max-h-[min(90vh,720px)] max-w-2xl overflow-hidden flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Valor da multa e cláusula</DialogTitle>
          <DialogDescription>
            Busque a cláusula na planilha de penalidades (VALORES MULTAS). Ao selecionar, o valor de referência é
            preenchido; você pode ajustar o valor manualmente. Em solicitação, marque como estimativa quando for o caso.
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
          <div className="max-h-[220px] overflow-y-auto rounded-md border border-border/80 bg-muted/20">
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
                          "w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/80",
                          active && "bg-emerald-600/15 ring-inset ring-1 ring-emerald-600/40"
                        )}
                      >
                        <span className="font-mono font-semibold text-primary">{c.item}</span>
                        <span className="ml-2 font-medium text-foreground">{formatBr(c.valor)}</span>
                        <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{c.descricao}</p>
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
