"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/motion-ui/motion-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { apiService } from "@/lib/api"
import { descontoADC, VALOR_MENSAL_CONTRATO } from "@/lib/adc-utils"
import { useAuth } from "@/lib/auth"
import { endOfMonth, format, startOfMonth } from "date-fns"
import { ptBR } from "date-fns/locale"
import { Database, Info, Calendar } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface AdcOverrideModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMes?: Date
  onSuccess?: () => void
}

type ModoEntrada = "por_indicador" | "total"

type AutoSnapshot = {
  ird: number
  ia: number
  if: number
  ipt: number
  total: number
  iaPercentual?: number
  ifPercentual?: number
  iptPercentual?: number
}

export function AdcOverrideModal({ open, onOpenChange, initialMes, onSuccess }: AdcOverrideModalProps) {
  const { user } = useAuth()
  const isHost = user?.role === "host"
  const monthInputRef = useRef<HTMLInputElement>(null)

  const [mes, setMes] = useState("")
  const [manualAtivo, setManualAtivo] = useState(false)
  const [modoEntrada, setModoEntrada] = useState<ModoEntrada>("por_indicador")
  const [pontuacaoIrd, setPontuacaoIrd] = useState("0")
  const [pontuacaoIa, setPontuacaoIa] = useState("0")
  const [pontuacaoIf, setPontuacaoIf] = useState("0")
  const [pontuacaoIpt, setPontuacaoIpt] = useState("0")
  const [adcTotalInput, setAdcTotalInput] = useState("0")
  const [observacao, setObservacao] = useState("")
  const [autoSnapshot, setAutoSnapshot] = useState<AutoSnapshot | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const anoMes = useMemo(() => {
    if (!mes) return null
    const [y, m] = mes.split("-").map(Number)
    if (!y || !m) return null
    return { ano: y, mes: m }
  }, [mes])

  const mesLabel = useMemo(() => {
    if (!anoMes) return "—"
    const d = new Date(anoMes.ano, anoMes.mes - 1, 1)
    const raw = format(d, "MMMM yyyy", { locale: ptBR })
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }, [anoMes])

  const adcTotalPreview = useMemo(() => {
    if (!manualAtivo) return autoSnapshot?.total ?? 0
    if (modoEntrada === "total") return Number(adcTotalInput) || 0
    return (
      (Number(pontuacaoIrd) || 0) +
      (Number(pontuacaoIa) || 0) +
      (Number(pontuacaoIf) || 0) +
      (Number(pontuacaoIpt) || 0)
    )
  }, [manualAtivo, modoEntrada, adcTotalInput, pontuacaoIrd, pontuacaoIa, pontuacaoIf, pontuacaoIpt, autoSnapshot?.total])

  const descontoInfo = useMemo(() => descontoADC(adcTotalPreview), [adcTotalPreview])
  const glosaPreview = useMemo(
    () => (VALOR_MENSAL_CONTRATO * (100 - descontoInfo.percentual)) / 100,
    [descontoInfo.percentual]
  )

  const applyAutoToInputs = useCallback((auto: AutoSnapshot) => {
    setPontuacaoIrd(String(auto.ird))
    setPontuacaoIa(String(auto.ia))
    setPontuacaoIf(String(auto.if))
    setPontuacaoIpt(String(auto.ipt))
    setAdcTotalInput(String(auto.total))
  }, [])

  const openNativeMonthPicker = () => {
    const el = monthInputRef.current
    if (!el) return
    const withPicker = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof withPicker.showPicker === "function") {
      try {
        withPicker.showPicker()
        return
      } catch {
        // fallback
      }
    }
    el.focus()
    el.click()
  }

  useEffect(() => {
    if (!open) return
    const mesStr = initialMes ? format(initialMes, "yyyy-MM") : format(new Date(), "yyyy-MM")
    setMes(mesStr)
    setErro(null)
  }, [open, initialMes])

  useEffect(() => {
    if (!open || !anoMes) return
    let cancelled = false

    const inicio = format(startOfMonth(new Date(anoMes.ano, anoMes.mes - 1, 1)), "yyyy-MM-dd")
    const fim = format(endOfMonth(new Date(anoMes.ano, anoMes.mes - 1, 1)), "yyyy-MM-dd")

    ;(async () => {
      setCarregando(true)
      try {
        const [override, auto] = await Promise.all([
          apiService.getAdcOverride(anoMes.ano, anoMes.mes),
          apiService.calcularADC(inicio, fim),
        ])
        if (cancelled) return

        const autoData: AutoSnapshot = {
          ird: Math.min(Number(auto.ird?.pontuacao ?? 0), 20),
          ia: Math.min(Number(auto.ia?.pontuacao ?? 0), 20),
          if: Math.min(Number(auto.if?.pontuacao ?? 0), 20),
          ipt: Number(auto.ipt?.pontuacao ?? 0),
          total: Number(auto.pontuacao_total ?? auto.total ?? 0),
          iaPercentual: auto.ia?.percentual ?? auto.ia?.valor,
          ifPercentual: auto.if?.percentual ?? auto.if?.valor,
          iptPercentual: auto.ipt?.percentual ?? auto.ipt?.valor,
        }
        setAutoSnapshot(autoData)

        if (override.ativo) {
          setManualAtivo(true)
          setModoEntrada(override.modo === "total" ? "total" : "por_indicador")
          setPontuacaoIrd(String(override.pontuacao_ird ?? autoData.ird))
          setPontuacaoIa(String(override.pontuacao_ia ?? autoData.ia))
          setPontuacaoIf(String(override.pontuacao_if ?? autoData.if))
          setPontuacaoIpt(String(override.pontuacao_ipt ?? autoData.ipt))
          setAdcTotalInput(String(override.adc_total ?? autoData.total))
          setObservacao(override.observacao ?? "")
        } else {
          setManualAtivo(false)
          setModoEntrada("por_indicador")
          applyAutoToInputs(autoData)
          setObservacao("")
        }
      } catch {
        if (!cancelled) setErro("Não foi possível carregar os dados do mês.")
      } finally {
        if (!cancelled) setCarregando(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, anoMes?.ano, anoMes?.mes, applyAutoToInputs])

  const handleManualToggle = (checked: boolean) => {
    setManualAtivo(checked)
    if (checked && autoSnapshot) {
      applyAutoToInputs(autoSnapshot)
    }
  }

  const handleUsarAutomaticos = () => {
    if (autoSnapshot) applyAutoToInputs(autoSnapshot)
  }

  const handleSalvar = async () => {
    if (!isHost) return
    if (!anoMes) {
      setErro("Selecione um mês válido.")
      return
    }

    try {
      setSalvando(true)
      setErro(null)

      if (!manualAtivo) {
        await apiService.deleteAdcOverride(anoMes.ano, anoMes.mes)
      } else {
        const obs = observacao.trim()
        if (!obs) {
          setErro("Informe o texto de observação para o modo manual.")
          return
        }
        if (modoEntrada === "total") {
          const total = Number(adcTotalInput)
          if (!Number.isFinite(total) || total < 0 || total > 100) {
            setErro("ADC total deve estar entre 0 e 100.")
            return
          }
          await apiService.saveAdcOverride({
            ano: anoMes.ano,
            mes: anoMes.mes,
            modo: "total",
            adc_total: total,
            observacao: obs,
          })
        } else {
          await apiService.saveAdcOverride({
            ano: anoMes.ano,
            mes: anoMes.mes,
            modo: "por_indicador",
            pontuacao_ird: Number(pontuacaoIrd) || 0,
            pontuacao_ia: Number(pontuacaoIa) || 0,
            pontuacao_if: Number(pontuacaoIf) || 0,
            pontuacao_ipt: Number(pontuacaoIpt) || 0,
            observacao: obs,
          })
        }
      }

      onOpenChange(false)
      onSuccess?.()
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } }; message?: string }
      setErro(err.response?.data?.detail || err.message || "Erro ao salvar configuração.")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuração ADC mensal</DialogTitle>
          <DialogDescription>
            Defina se o mês usa cálculo automático (SACs, BFS, IPT) ou valores manuais no dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
            <span>
              Override manual salvo no Postgres (Neon). Ao confirmar automático, o registro do mês é removido e o
              dashboard recalcula normalmente.
            </span>
          </p>

          <div className="space-y-1.5">
            <Label id="adc-override-mes-lbl" className="text-sm text-muted-foreground">
              Mês de referência
            </Label>
            <div
              className={cn(
                "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md bg-muted/30 px-3 text-sm shadow-sm transition-colors",
                "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                carregando || salvando ? "pointer-events-none opacity-60" : ""
              )}
              role="button"
              tabIndex={0}
              aria-labelledby="adc-override-mes-lbl"
              onClick={openNativeMonthPicker}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openNativeMonthPicker()
                }
              }}
            >
              <Calendar className="h-4 w-4 shrink-0 text-primary/80" />
              <span className="truncate text-foreground">{mesLabel}</span>
              <input
                ref={monthInputRef}
                type="month"
                value={mes}
                max={format(new Date(), "yyyy-MM")}
                tabIndex={-1}
                className="sr-only"
                onChange={(e) => {
                  const val = e.target.value
                  if (val) setMes(val)
                }}
              />
            </div>
          </div>

          {autoSnapshot && (
            <Card className="border-0 bg-linear-to-br from-emerald-500/10 via-muted/20 to-teal-500/5 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Cálculo automático atual</p>
                  <Badge variant="secondary" className="text-[10px] font-normal uppercase tracking-wide">
                    SACs · BFS · IPT
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { key: "ird", label: "IRD", pts: autoSnapshot.ird, pct: null },
                      { key: "ia", label: "IA", pts: autoSnapshot.ia, pct: autoSnapshot.iaPercentual },
                      { key: "if", label: "IF", pts: autoSnapshot.if, pct: autoSnapshot.ifPercentual },
                      { key: "ipt", label: "IPT", pts: autoSnapshot.ipt, pct: autoSnapshot.iptPercentual },
                    ] as const
                  ).map(({ key, label, pts, pct }) => (
                    <div key={key} className="rounded-lg bg-background/60 px-2 py-2 text-center shadow-sm">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                      <p className="text-sm font-bold tabular-nums">{pts} pts</p>
                      {pct != null && (
                        <p className="text-[10px] text-muted-foreground">{Number(pct).toFixed(1)}%</p>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  ADC automático:{" "}
                  <strong className="text-foreground">{autoSnapshot.total.toFixed(1)} pts</strong>
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/30 px-3 py-3">
            <div>
              <p className="text-sm font-medium">Usar valores manuais</p>
              <p className="text-xs text-muted-foreground">
                {manualAtivo ? "Dashboard exibe alerta + texto personalizado" : "Cálculo automático nos cards"}
              </p>
            </div>
            <Switch
              checked={manualAtivo}
              onCheckedChange={handleManualToggle}
              disabled={!isHost || carregando || salvando}
              aria-label="Ativar modo manual"
            />
          </div>

          {manualAtivo && (
            <div className="space-y-4">
              <Tabs
                value={modoEntrada}
                onValueChange={(v) => setModoEntrada(v as ModoEntrada)}
                className="w-full"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList className="h-9">
                    <TabsTrigger value="por_indicador" disabled={!isHost || carregando || salvando}>
                      Por indicador
                    </TabsTrigger>
                    <TabsTrigger value="total" disabled={!isHost || carregando || salvando}>
                      ADC total
                    </TabsTrigger>
                  </TabsList>
                  {isHost && autoSnapshot && modoEntrada === "por_indicador" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 text-muted-foreground"
                      onClick={handleUsarAutomaticos}
                      disabled={carregando || salvando}
                    >
                      Copiar automáticos
                    </Button>
                  )}
                </div>

                <TabsContent value="por_indicador" className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        { id: "p-ird", label: "IRD", max: 20, value: pontuacaoIrd, set: setPontuacaoIrd },
                        { id: "p-ia", label: "IA", max: 20, value: pontuacaoIa, set: setPontuacaoIa },
                        { id: "p-if", label: "IF", max: 20, value: pontuacaoIf, set: setPontuacaoIf },
                        { id: "p-ipt", label: "IPT", max: 40, value: pontuacaoIpt, set: setPontuacaoIpt },
                      ] as const
                    ).map(({ id, label, max, value, set }) => (
                      <div key={id} className="space-y-1.5">
                        <Label htmlFor={id} className="text-sm text-muted-foreground">
                          {label}{" "}
                          <span className="font-normal opacity-80">(0–{max})</span>
                        </Label>
                        <Input
                          id={id}
                          type="number"
                          min={0}
                          max={max}
                          step={0.1}
                          value={value}
                          onChange={(e) => set(e.target.value)}
                          disabled={!isHost || carregando || salvando}
                        />
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="total" className="mt-3 space-y-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="adc-total" className="text-sm text-muted-foreground">
                      ADC total <span className="font-normal opacity-80">(0–100 pts)</span>
                    </Label>
                    <Input
                      id="adc-total"
                      type="number"
                      min={0}
                      max={100}
                      step={0.1}
                      value={adcTotalInput}
                      onChange={(e) => setAdcTotalInput(e.target.value)}
                      disabled={!isHost || carregando || salvando}
                    />
                  </div>
                  {autoSnapshot && isHost && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto justify-start px-0 text-xs text-muted-foreground"
                      onClick={() => setAdcTotalInput(String(autoSnapshot.total))}
                    >
                      Usar total automático ({autoSnapshot.total.toFixed(1)} pts)
                    </Button>
                  )}
                </TabsContent>
              </Tabs>

              <div className="space-y-1.5">
                <Label htmlFor="observacao" className="text-sm text-muted-foreground">
                  Texto do tooltip (obrigatório)
                </Label>
                <Textarea
                  id="observacao"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex.: Valor oficial informado pela SELIMP em maio/2026"
                  rows={3}
                  disabled={!isHost || carregando || salvando}
                  className="min-h-[80px] resize-y bg-background"
                />
              </div>

              <div className="rounded-lg bg-accent/60 p-3 text-sm space-y-1">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                  Preview manual
                </div>
                <p>
                  <span className="text-muted-foreground">ADC total: </span>
                  <strong>{adcTotalPreview.toFixed(1)} pts</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Recebimento: </span>
                  <strong>{descontoInfo.percentual.toFixed(1)}%</strong>
                  <span className="text-muted-foreground"> — {descontoInfo.texto}</span>
                </p>
                <p>
                  <span className="text-muted-foreground">Glosa estimada: </span>
                  <strong>
                    R${" "}
                    {glosaPreview.toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </p>
              </div>
            </div>
          )}

          {!manualAtivo && autoSnapshot && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Modo automático. Ao salvar, os cards exibem IRD {autoSnapshot.ird}, IA {autoSnapshot.ia}, IF{" "}
              {autoSnapshot.if} e IPT {autoSnapshot.ipt} pts calculados dos dados importados.
            </p>
          )}

          {!isHost && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Apenas usuários host podem alterar. Você pode visualizar o estado e os valores automáticos.
            </p>
          )}

          {carregando && <p className="text-xs text-muted-foreground animate-pulse">Carregando dados do mês…</p>}

          {erro && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{erro}</div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          {isHost && (
            <Button type="button" onClick={handleSalvar} disabled={salvando || carregando}>
              {salvando ? "Salvando..." : manualAtivo ? "Salvar manual" : "Confirmar automático"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
