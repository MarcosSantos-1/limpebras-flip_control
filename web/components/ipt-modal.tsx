"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiService } from "@/lib/api"
import { format, startOfMonth, endOfMonth } from "date-fns"

interface IPTModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
  currentValue?: number
  currentPontuacao?: number
  initialMes?: string
}

export function IPTModal({ open, onOpenChange, onSuccess, currentValue, currentPontuacao, initialMes }: IPTModalProps) {
  const [mes, setMes] = useState(initialMes ?? format(new Date(), "yyyy-MM"))
  const [percentualTotal, setPercentualTotal] = useState<string>("")
  const [calculandoPontuacao, setCalculandoPontuacao] = useState(false)
  const [pontuacaoCalculada, setPontuacaoCalculada] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMes(initialMes ?? format(new Date(), "yyyy-MM"))
      setPercentualTotal(currentValue?.toFixed(2) || "")
      setPontuacaoCalculada(currentPontuacao || null)
      setErro(null)
    }
  }, [open, currentValue, currentPontuacao, initialMes])

  // Calcular pontuação baseado no percentual
  const calcularPontuacao = (percentual: number): number => {
    if (percentual >= 90) return 40
    if (percentual >= 80) return 38
    if (percentual >= 70) return 36
    if (percentual >= 60) return 32
    if (percentual >= 50) return 28
    if (percentual >= 40) return 24
    if (percentual >= 30) return 20
    if (percentual >= 20) return 16
    if (percentual >= 10) return 12
    return 0
  }

  const handlePercentualChange = (value: string) => {
    setPercentualTotal(value)
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
      const pontuacao = calcularPontuacao(numValue)
      setPontuacaoCalculada(pontuacao)
    } else {
      setPontuacaoCalculada(null)
    }
  }

  const handleSalvar = async () => {
    const percentual = parseFloat(percentualTotal)
    
    if (isNaN(percentual) || percentual < 0 || percentual > 100) {
      setErro("Percentual deve ser um número entre 0 e 100")
      return
    }

    if (!mes) {
      setErro("Selecione um mês")
      return
    }

    try {
      setSalvando(true)
      setErro(null)

      // Criar período do mês selecionado sem shift de timezone
      // (new Date("yyyy-MM-01") pode cair no dia/mês anterior em alguns fusos)
      const [anoStr, mesStr] = mes.split("-")
      const ano = Number(anoStr)
      const mesNumero = Number(mesStr)
      const mesDate = new Date(ano, mesNumero - 1, 1)
      const periodoInicial = startOfMonth(mesDate)
      const periodoFinal = endOfMonth(mesDate)

      // Salvar IPT
      const resultado = await apiService.salvarIPT(
        format(periodoInicial, "yyyy-MM-dd"),
        format(periodoFinal, "yyyy-MM-dd"),
        percentual
      )

      console.log("IPT salvo com sucesso:", resultado)

      // Fechar modal primeiro
      onOpenChange(false)
      
      // Aguardar um pouco antes de recarregar para garantir que o backend processou
      setTimeout(() => {
        // Chamar callback de sucesso
        if (onSuccess) {
          onSuccess()
        }
      }, 500)
    } catch (error: any) {
      setErro(error.response?.data?.detail || error.message || "Erro ao salvar IPT")
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Atualizar IPT</DialogTitle>
          <DialogDescription>
            Informe o mês e o percentual total do IPT. A pontuação será calculada automaticamente.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label htmlFor="mes" className="text-sm font-medium">
              Mês
            </label>
            <input
              id="mes"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <label htmlFor="percentual" className="text-sm font-medium">
              Percentual Total (%)
            </label>
            <input
              id="percentual"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={percentualTotal}
              onChange={(e) => handlePercentualChange(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Percentual total do IPT (média ponderada de mão de obra e equipamentos)
            </p>
          </div>

          {pontuacaoCalculada !== null && (
            <div className="bg-accent p-3 rounded-md border border-border">
              <p className="text-sm font-medium text-accent-foreground">
                Pontuação calculada: <span className="text-lg font-bold">{pontuacaoCalculada} pontos</span>
              </p>
            </div>
          )}

          {erro && (
            <div className="bg-destructive/10 p-3 rounded-md border border-destructive/20">
              <p className="text-sm text-destructive">{erro}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-secondary-foreground bg-secondary rounded-md hover:bg-secondary/80 transition-colors"
            disabled={salvando}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={salvando || !percentualTotal || pontuacaoCalculada === null}
            className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

