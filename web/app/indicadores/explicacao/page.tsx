"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/api";
import { endOfMonth, format, isValid, startOfMonth } from "date-fns";
import { AdcDonutChart } from "@/components/adc-donut-chart";
import { Download, Printer, CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";

interface IfPorSub {
  subprefeitura: string;
  sem_irregularidades: number;
  vistorias_total: number;
  if_percentual: number;
  media_mesclada?: number;
  pontuacao_mesclada?: number;
}

interface IrdPorRegional {
  subprefeitura: string;
  label: string;
  reclamacoes: number;
  domicilios: number;
  ird_valor: number;
}

interface IndicadorDetalhe {
  valor?: number;
  percentual?: number;
  pontuacao?: number;
  total_reclamacoes?: number;
  domicilios?: number;
  tipos_considerados?: string[];
  total_procedentes?: number;
  total_no_prazo?: number;
  total_fora_prazo?: number;
  total_solicitacoes?: number;
  total_fiscalizacoes?: number;
  total_sem_irregularidade?: number;
  total_com_irregularidade?: number;
  status_referencia?: string;
  servicos_nao_demandantes?: string[];
  if_por_sub?: IfPorSub[];
  ird_por_regional?: IrdPorRegional[];
  /** Fórmula preenchida com os números (memória de cálculo) */
  memoria_calculo?: string;
  /** Filtros usados na base para o indicador */
  filtros_aplicados?: string[];
}

interface ResumoADC {
  pontuacao_total: number;
  percentual_contrato: number;
  desconto: number;
  valor_mensal_contrato: number;
  glosa_real: number;
}

interface IndicadoresDetalhesResponse {
  periodo: {
    inicial: string;
    final: string;
  };
  subprefeitura?: string | null;
  ird?: IndicadorDetalhe;
  ia?: IndicadorDetalhe;
  if?: IndicadorDetalhe;
  ipt?: IndicadorDetalhe;
  resumo_adc?: ResumoADC;
}

const formatarValor = (valor?: number, casas = 2) =>
  typeof valor === "number" ? valor.toFixed(casas) : "--";

// Funções auxiliares para determinar qual linha destacar baseado na pontuação
const getIARowIndex = (pontuacao?: number): number => {
  if (!pontuacao && pontuacao !== 0) return -1;
  if (pontuacao === 20) return 0;
  if (pontuacao === 16) return 1;
  if (pontuacao === 12) return 2;
  if (pontuacao === 8) return 3;
  if (pontuacao === 4) return 4;
  if (pontuacao === 0) return 5;
  return -1;
};

const getIFRowIndex = (pontuacao?: number): number => {
  if (!pontuacao && pontuacao !== 0) return -1;
  if (pontuacao === 20) return 0;
  if (pontuacao === 18) return 1;
  if (pontuacao === 16) return 2;
  if (pontuacao === 14) return 3;
  if (pontuacao === 12) return 4;
  if (pontuacao === 10) return 5;
  if (pontuacao === 8) return 6;
  if (pontuacao === 6) return 7;
  if (pontuacao === 4) return 8;
  if (pontuacao === 0) return 9;
  return -1;
};

const getIRDRowIndex = (pontuacao?: number): number => {
  if (!pontuacao && pontuacao !== 0) return -1;
  if (pontuacao === 20) return 0;
  if (pontuacao === 15) return 1;
  if (pontuacao === 10) return 2;
  if (pontuacao === 5) return 3;
  if (pontuacao === 0) return 4;
  return -1;
};

const getIPTRowIndex = (pontuacao?: number): number => {
  if (!pontuacao && pontuacao !== 0) return -1;
  if (pontuacao === 40) return 0;
  if (pontuacao === 38) return 1;
  if (pontuacao === 36) return 2;
  if (pontuacao === 32) return 3;
  if (pontuacao === 28) return 4;
  if (pontuacao === 24) return 5;
  if (pontuacao === 20) return 6;
  if (pontuacao === 16) return 7;
  if (pontuacao === 12) return 8;
  if (pontuacao === 0) return 9;
  return -1;
};

export default function ExplicacaoIndicadoresPage() {
  const [periodoInicial, setPeriodoInicial] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [periodoFinal, setPeriodoFinal] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [detalhes, setDetalhes] = useState<IndicadoresDetalhesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carregarDetalhes = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getIndicadoresDetalhes(periodoInicial, periodoFinal);
      setDetalhes(data);
    } catch (err) {
      console.error(err);
      setError("Nao foi possivel carregar os indicadores. Verifique as datas e tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  // Recarregar quando o período mudar
  useEffect(() => {
    carregarDetalhes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoInicial, periodoFinal]);


  const safeFormat = (d: string | Date | undefined) => {
    let date: Date | undefined;
    if (typeof d === "string") {
      // Evita shift de timezone em "yyyy-MM-dd" (ex.: 01/01 virar 31/12)
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else {
        date = new Date(d);
      }
    } else {
      date = d;
    }
    return date && isValid(date) ? format(date, "dd/MM/yyyy") : "--";
  };
  const periodoLabel = detalhes?.periodo
    ? `${safeFormat(detalhes.periodo.inicial)} -> ${safeFormat(detalhes.periodo.final)}`
    : `${safeFormat(periodoInicial)} -> ${safeFormat(periodoFinal)}`;

  const pontuacaoParcial =
    (detalhes?.ird?.pontuacao ?? 0) + (detalhes?.ia?.pontuacao ?? 0) + (detalhes?.if?.pontuacao ?? 0);
  const pontuacaoTotal = pontuacaoParcial + (detalhes?.ipt?.pontuacao ?? 0);
  const percentualADC = Math.max(0, Math.min(100, pontuacaoTotal));
  const resumoIndicadores = useMemo(
    () => [
      { nome: "IRD", valor: formatarValor(detalhes?.ird?.valor, 3), pontos: formatarValor(detalhes?.ird?.pontuacao, 2), cor: "text-emerald-700 dark:text-emerald-400" },
      {
        nome: "IA",
        valor: `${formatarValor(detalhes?.ia?.percentual ?? detalhes?.ia?.valor ?? 0, 2)}%`,
        pontos: formatarValor(detalhes?.ia?.pontuacao, 2),
        cor: "text-blue-700 dark:text-blue-400",
      },
      {
        nome: "IF",
        valor: `${formatarValor(detalhes?.if?.percentual ?? ((detalhes?.if?.valor ?? 0) / 10), 2)}%`,
        pontos: formatarValor(detalhes?.if?.pontuacao, 2),
        cor: "text-amber-700 dark:text-amber-400",
      },
      {
        nome: "IPT",
        valor: detalhes?.ipt ? `${formatarValor(detalhes?.ipt?.valor, 2)}%` : "Não informado",
        pontos: formatarValor(detalhes?.ipt?.pontuacao, 2),
        cor: "text-fuchsia-700 dark:text-fuchsia-400",
      },
    ],
    [detalhes]
  );
  const reportRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => window.print();

  const handleDownloadPDF = async () => {
    const el = reportRef.current;
    if (!el) return;
    setPdfLoading(true);
    const { default: html2canvas } = await import("html2canvas-pro");
    const { jsPDF } = await import("jspdf");
    document.body.classList.add("pdf-exporting");
    await new Promise((r) => setTimeout(r, 150));
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      document.body.classList.remove("pdf-exporting");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const pageW = 210;
      const pageH = 297;
      const margin = 15;
      const contentW = pageW - 2 * margin;
      const contentH = pageH - 2 * margin;
      const imgRatio = canvas.height / canvas.width;
      const imgW = contentW;
      const imgH = imgW * imgRatio;
      const totalPages = Math.ceil(imgH / contentH);
      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage();
        const srcY = (p * contentH / imgH) * canvas.height;
        const srcH = (contentH / imgH) * canvas.height;
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.ceil(srcH);
        const ctx = sliceCanvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, 0, canvas.width, srcH);
        const sliceData = sliceCanvas.toDataURL("image/png");
        const sliceH = Math.min(contentH, imgH - p * contentH);
        pdf.addImage(sliceData, "PNG", margin, margin, imgW, sliceH);
      }
      pdf.save(`relatorio-indicadores-${format(new Date(), "yyyy-MM-dd")}.pdf`);
    } catch (err) {
      document.body.classList.remove("pdf-exporting");
      console.error(err);
    } finally {
      setPdfLoading(false);
    }
  };

  // Calcular desconto baseado na pontuação total
  const calcularDesconto = (pontuacao: number): { percentual: number; desconto: number; explicacao: string } => {
    if (pontuacao >= 90) {
      return { percentual: 100.0, desconto: 0.0, explicacao: "100% do valor mensal previsto - Sem desconto" };
    } else if (pontuacao >= 70) {
      const pontosAbaixo = 90 - pontuacao;
      const desconto = pontosAbaixo * 0.20;
      const percentual = Math.max(95.0, 100.0 - desconto);
      return {
        percentual,
        desconto,
        explicacao: `Redução de 0,20% por ponto abaixo de 90 (${pontosAbaixo.toFixed(1)} pontos abaixo). Limite mínimo: 95%`
      };
    } else if (pontuacao >= 50) {
      const pontosAbaixo = 70 - pontuacao;
      const descontoBase = (90 - 70) * 0.20; // 4%
      const desconto = descontoBase + (pontosAbaixo * 0.25);
      const percentual = Math.max(90.0, 100.0 - desconto);
      return {
        percentual,
        desconto,
        explicacao: `Redução de 0,25% por ponto abaixo de 70 (${pontosAbaixo.toFixed(1)} pontos abaixo). Desconto base da faixa anterior: 4%. Limite mínimo: 90%`
      };
    } else if (pontuacao >= 30) {
      const pontosAbaixo = 50 - pontuacao;
      const descontoBase = (90 - 50) * 0.20 + (50 - 30) * 0.25; // 8% + 5% = 13%
      const desconto = descontoBase + (pontosAbaixo * 0.5);
      const percentual = Math.max(80.0, 100.0 - desconto);
      return {
        percentual,
        desconto,
        explicacao: `Redução de 0,5% por ponto abaixo de 50 (${pontosAbaixo.toFixed(1)} pontos abaixo). Descontos anteriores: 13%. Limite mínimo: 80%`
      };
    } else {
      return {
        percentual: 70.0,
        desconto: 30.0,
        explicacao: "Abaixo de 30 pontos: 70% do valor mensal (desconto fixo de 30%)"
      };
    }
  };

  const infoDesconto = calcularDesconto(pontuacaoTotal);
  const getPontosStyle = (pontos: number, max: number) => {
    if (pontos >= max) {
      return "bg-green-50 dark:bg-green-900/25 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300";
    }
    if (pontos <= Math.max(4, max * 0.25)) {
      return "bg-red-50 dark:bg-red-900/25 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300";
    }
    if (pontos <= max * 0.6) {
      return "bg-amber-50 dark:bg-amber-900/25 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300";
    }
    return "bg-zinc-50 dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300";
  };

  return (
    <MainLayout>
      <div ref={reportRef} className="space-y-6 w-full max-w-7xl mx-auto report-print-area">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 report-screen-only">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Explicação dos Cálculos dos Indicadores</h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-2">
              Combine a teoria com os números reais vindos do backend para auditar qualquer mês ou subprefeitura.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition shadow-sm"
            >
              <Printer className="h-4 w-4" />
              Imprimir relatório
            </button>
            <button
              onClick={handleDownloadPDF}
              disabled={pdfLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-violet-400/50 bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {pdfLoading ? "Gerando PDF…" : "Baixar PDF"}
            </button>
          </div>
        </div>

        <div className="hidden print:flex report-print-cover">
          <h1 className="text-3xl font-bold text-black">Explicação dos Cálculos dos Indicadores</h1>
          <p className="text-lg text-black mt-4">Período: {periodoLabel}</p>
          <p className="text-sm text-black mt-2">Gerado em {format(new Date(), "dd/MM/yyyy HH:mm")}</p>
        </div>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow report-screen-only">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5 text-violet-500" />
              Período analisado
            </CardTitle>
            <CardDescription className="font-medium">{periodoLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 report-screen-only">
              <div>
                <label className="block text-sm font-medium mb-2">Período inicial</label>
                <Input
                  type="date"
                  value={periodoInicial}
                  onChange={(e) => setPeriodoInicial(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Período final</label>
                <Input
                  type="date"
                  value={periodoFinal}
                  onChange={(e) => setPeriodoFinal(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={carregarDetalhes}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading ? "Atualizando..." : "Atualizar explicação"}
                </button>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-4 report-screen-only">
              Sugestão: trabalhe com o mês corrente inteiro para replicar os cálculos de IA e IRD do dashboard.
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-0 shadow-lg shadow-violet-500/15 dark:shadow-violet-500/10 report-print-break-before">
          <CardHeader className="py-3">
            <CardTitle className="text-2xl">Resumo executivo do relatório</CardTitle>
            <CardDescription className="text-sm">Visão consolidada dos indicadores do período selecionado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {resumoIndicadores.map((item) => (
                <div
                  key={item.nome}
                  className="rounded-xl  bg-card px-4 py-3 flex flex-col items-center justify-center data-cell"
                >
                  <div className={`text-2xl font-bold uppercase tracking-wider flex items-center justify-center ${item.cor}`}>{item.nome}</div>
                  <div className="text-3xl font-bold flex items-center justify-center">{item.valor}</div>
                  <div className="text-lg text-muted-foreground flex items-center justify-center">{item.pontos} pts</div>
                </div>
              ))}
            <div className="flex flex-wrap items-center gap-6 rounded-xl shadow-md  dark:bg-violet-950/30 px-5 py-4">

              <AdcDonutChart total={pontuacaoTotal} percentual={percentualADC} />
            </div>
            </div>
          </CardContent>
        </Card>



        {error && (
          <div className="rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow report-print-indicator">
          <CardHeader>
            <CardTitle>IRD - Indicador de Reclamações por Domicílio</CardTitle>
            <CardDescription>Pontuação máxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Fórmula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IRD = (Reclamações Escalonadas Procedentes / Número de Domicílios) x 1000
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Procedentes escalonados:</strong> {detalhes?.ird?.tipos_considerados?.join(", ") ?? "varrição, mutirão, bueiro e cata-bagulho"} finalizados ou confirmados.
                </li>
                <li>
                  <strong>Domicílios:</strong> {detalhes?.ird?.domicilios?.toLocaleString("pt-BR") ?? "511.093"} (base IBGE 2024).
                </li>
                <li>
                  <strong>Fator 1000:</strong> expressa o indicador por mil domicílios.
                </li>
              </ul>
            </div>

            {detalhes?.ird?.filtros_aplicados && detalhes.ird.filtros_aplicados.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Filtros aplicados (base de dados)</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {detalhes.ird.filtros_aplicados.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Memória de cálculo – IRD</h3>
              <p className="text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {detalhes?.ird?.memoria_calculo ?? "Aguardando dados do período."}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-200">
                {detalhes?.ird
                  ? `IRD = (${detalhes.ird.total_reclamacoes ?? 0} / ${detalhes.ird.domicilios?.toLocaleString("pt-BR") ?? 0}) x 1000 = ${formatarValor(
                      detalhes.ird.valor,
                      3
                    )}`
                  : "Nenhum SAC escalonado procedente encontrado no período."}
              </p>
              <p className="text-sm">
                Pontuação: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes?.ird?.pontuacao, 2)} pts</strong>
              </p>
            </div>

            {detalhes?.ird?.ird_por_regional && detalhes.ird.ird_por_regional.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">IRD por regional (visualização)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800">
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Regional</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Reclamações</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Domicílios</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">IRD</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">IRD Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalhes.ird.ird_por_regional.map((row, idx, arr) => (
                        <tr key={row.subprefeitura}>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2">{row.label}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.reclamacoes.toLocaleString("pt-BR")}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.domicilios.toLocaleString("pt-BR")}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.ird_valor.toFixed(3)}</td>
                          {idx === 0 ? (
                            <td
                              className="border border-zinc-300 dark:border-zinc-700 p-2 text-center font-semibold bg-emerald-50 dark:bg-emerald-900/20"
                              rowSpan={arr.length}
                            >
                              {typeof detalhes?.ird?.valor === "number" && detalhes?.ird?.pontuacao != null
                                ? `${(detalhes?.ird?.valor ?? 0).toFixed(3)} / ${detalhes?.ird?.pontuacao ?? "--"} pts`
                                : "--"}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuação</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuação</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={getIRDRowIndex(detalhes?.ird?.pontuacao) === 0 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IRD &lt;= 1,0</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIRDRowIndex(detalhes?.ird?.pontuacao) === 0 ? "text-green-600 dark:text-green-400" : ""}`}>20 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Excelente</td>
                    </tr>
                    <tr className={getIRDRowIndex(detalhes?.ird?.pontuacao) === 1 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">1,0 &lt; IRD &lt;= 2,0</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIRDRowIndex(detalhes?.ird?.pontuacao) === 1 ? "text-green-600 dark:text-green-400" : ""}`}>15 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Bom</td>
                    </tr>
                    <tr className={getIRDRowIndex(detalhes?.ird?.pontuacao) === 2 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">2,0 &lt; IRD &lt;= 5,0</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIRDRowIndex(detalhes?.ird?.pontuacao) === 2 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>10 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Regular</td>
                    </tr>
                    <tr className={getIRDRowIndex(detalhes?.ird?.pontuacao) === 3 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">5,0 &lt; IRD &lt;= 10,0</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIRDRowIndex(detalhes?.ird?.pontuacao) === 3 ? "text-orange-600 dark:text-orange-400" : ""}`}>5 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Insatisfatorio</td>
                    </tr>
                    <tr className={getIRDRowIndex(detalhes?.ird?.pontuacao) === 4 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IRD &gt; 10,0</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIRDRowIndex(detalhes?.ird?.pontuacao) === 4 ? "text-red-600 dark:text-red-400" : ""}`}>0 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Critico</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow report-print-indicator">
          <CardHeader>
            <CardTitle>IA - Indicador de Atendimento</CardTitle>
            <CardDescription>Pontuação máxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Fórmula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IA = (No prazo / (No prazo + Fora do prazo)) x 100
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes (Filtros)</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Data de Registro:</strong> período selecionado (inicial e final).
                </li>
                <li>
                  <strong>Classificação_do_Serviço:</strong> &quot;Solicitação&quot; (demandantes).
                </li>
                <li>
                  <strong>Finalizado_como_fora_de_escopo:</strong> &quot;NÃO&quot; (incluídos no IA).
                </li>
                <li>
                  <strong>No prazo:</strong> Responsividade_Execução = &quot;SIM&quot;. Fora do prazo = &quot;NÃO&quot;.
                </li>
              </ul>
            </div>

            {detalhes?.ia?.filtros_aplicados && detalhes.ia.filtros_aplicados.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Filtros aplicados (base de dados)</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {detalhes.ia.filtros_aplicados.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Memória de cálculo – IA</h3>
              <p className="text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {detalhes?.ia?.memoria_calculo ?? "Aguardando dados do período."}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              {detalhes?.ia ? (
                <>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    No prazo: <strong>{detalhes.ia.total_no_prazo}</strong>
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    Fora do prazo: <strong>{detalhes.ia.total_fora_prazo}</strong>
                  </p>
                  <p className="text-sm">
                    IA = ({detalhes.ia.total_no_prazo} / {(detalhes.ia.total_no_prazo ?? 0) + (detalhes.ia.total_fora_prazo ?? 0)}) × 100 = {formatarValor(detalhes.ia.percentual ?? detalhes.ia.valor ?? 0, 2)}%
                  </p>
                  <p className="text-sm">
                    Pontuação: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes.ia.pontuacao, 2)} pts</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Nenhum SAC demandante no período.</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuação</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuação</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 0 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IA &gt;= 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 0 ? "text-green-600 dark:text-green-400" : ""}`}>20 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Quase tudo no prazo</td>
                    </tr>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 1 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">80% &lt;= IA &lt; 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 1 ? "text-green-600 dark:text-green-400" : ""}`}>16 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Maioria no prazo</td>
                    </tr>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 2 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">70% &lt;= IA &lt; 80%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 2 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>12 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Parte atrasada</td>
                    </tr>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 3 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">60% &lt;= IA &lt; 70%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 3 ? "text-orange-600 dark:text-orange-400" : ""}`}>8 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Muitos atrasos</td>
                    </tr>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 4 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">50% &lt;= IA &lt; 60%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 4 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>4 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Critico</td>
                    </tr>
                    <tr className={getIARowIndex(detalhes?.ia?.pontuacao) === 5 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IA &lt; 50%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIARowIndex(detalhes?.ia?.pontuacao) === 5 ? "text-red-600 dark:text-red-400" : ""}`}>0 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Inaceitavel</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow report-print-indicator">
          <CardHeader>
            <CardTitle>IF - Indicador de Fiscalização</CardTitle>
            <CardDescription>Pontuação máxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Fórmula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IF por sub = (sem irregularidades / total BFS escalonados) × 100
              </div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                Média dos 4 percentuais (JT, CV, ST, MG) = IF final. Todos os BFS do período, exceto 3 serviços excluídos.
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Por sub (JT, CV, ST, MG):</strong> IF_sub = (sem irregularidades / vistorias total) × 100 (percentual).
                </li>
                <li>
                  <strong>IF final:</strong> média dos 4 percentuais (soma ÷ 4). Ex: 67%.
                </li>
                <li>
                  <strong>Excluídos do cálculo (apenas 3 serviços):</strong>
                  <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                    <li>Coleta e transporte de entulho e grandes objetos depositados irregularmente nas vias, logradouros e áreas públicas</li>
                    <li>Fornecimento, instalação e reposição de papeleiras e outros equipamentos de recepção de resíduos</li>
                    <li>Remoção de animais mortos de proprietários não identificados em vias e logradouros públicos</li>
                  </ul>
                </li>
              </ul>
            </div>

            {detalhes?.if?.filtros_aplicados && detalhes.if.filtros_aplicados.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Filtros aplicados (base de dados)</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {detalhes.if.filtros_aplicados.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 rounded-lg">
              <h3 className="font-semibold text-sm mb-2">Memória de cálculo – IF</h3>
              <p className="text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                {detalhes?.if?.memoria_calculo ?? "Aguardando dados do período."}
              </p>
            </div>

            {detalhes?.if?.if_por_sub && detalhes.if.if_por_sub.length > 0 && (() => {
              const ifPorSub = detalhes.if?.if_por_sub ?? [];
              return (
              <div>
                <h3 className="font-semibold mb-2">IF por subprefeitura</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-zinc-100 dark:bg-zinc-800">
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Subprefeitura</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Sem Irregularidades</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Vistorias Total</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">IF (%)</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Média</th>
                        <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ifPorSub.map((row, idx) => (
                        <tr key={row.subprefeitura}>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2">{row.subprefeitura}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.sem_irregularidades.toLocaleString("pt-BR")}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.vistorias_total.toLocaleString("pt-BR")}</td>
                          <td className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">{row.if_percentual.toFixed(1)}%</td>
                          {idx === 0 ? (
                            <td
                              className="border border-zinc-300 dark:border-zinc-700 p-2 text-center font-semibold bg-zinc-50 dark:bg-zinc-900"
                              rowSpan={ifPorSub.length}
                              style={{ verticalAlign: "middle" }}
                            >
                              {ifPorSub[0].media_mesclada != null
                                ? ifPorSub[0].media_mesclada.toFixed(1) + "%"
                                : "--"}
                            </td>
                          ) : null}
                          {idx === 0 ? (
                            <td
                              className="border border-zinc-300 dark:border-zinc-700 p-2 text-center font-semibold bg-zinc-50 dark:bg-zinc-900"
                              rowSpan={ifPorSub.length}
                              style={{ verticalAlign: "middle" }}
                            >
                              {(ifPorSub[0].pontuacao_mesclada ?? detalhes?.if?.pontuacao ?? "--") + " pts"}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              );
            })()}

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              {detalhes?.if ? (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    Total BFS (escalonados): <strong>{detalhes.if.total_fiscalizacoes}</strong>
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Sem irregularidade: <strong>{detalhes.if.total_sem_irregularidade}</strong>
                  </p>
                  {typeof detalhes.if.total_com_irregularidade === "number" && (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Com irregularidade: <strong>{detalhes.if.total_com_irregularidade}</strong>
                    </p>
                  )}
                  <p className="text-sm">
                    IF = média dos 4 percentuais = {formatarValor(detalhes.if.percentual ?? ((detalhes.if.valor ?? 0) / 10), 2)}%
                  </p>
                  <p className="text-sm">
                    Pontuação: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes.if.pontuacao, 2)} pts</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Nenhuma fiscalização BFS escalonada no período.</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuação</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuação</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 0 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IF &gt;= 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 0 ? "text-green-600 dark:text-green-400" : ""}`}>20 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Quase todas sem irregularidade</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 1 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">80% &lt;= IF &lt; 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 1 ? "text-green-600 dark:text-green-400" : ""}`}>18 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Poucas irregularidades</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 2 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">70% &lt;= IF &lt; 80%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 2 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>16 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Maioria ok</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 3 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">60% &lt;= IF &lt; 70%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 3 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>14 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Alguns problemas</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 4 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">50% &lt;= IF &lt; 60%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 4 ? "text-orange-600 dark:text-orange-400" : ""}`}>12 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Varias ocorrencias</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 5 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">40% &lt;= IF &lt; 50%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 5 ? "text-orange-600 dark:text-orange-400" : ""}`}>10 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Muitas irregularidades</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 6 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">30% &lt;= IF &lt; 40%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 6 ? "text-red-600 dark:text-red-400" : ""}`}>8 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Metade problematica</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 7 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">20% &lt;= IF &lt; 30%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 7 ? "text-red-600 dark:text-red-400" : ""}`}>6 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho muito baixo</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 8 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">10% &lt;= IF &lt; 20%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 8 ? "text-red-600 dark:text-red-400" : ""}`}>4 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Deficiente</td>
                    </tr>
                    <tr className={getIFRowIndex(detalhes?.if?.pontuacao) === 9 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IF &lt; 10%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIFRowIndex(detalhes?.if?.pontuacao) === 9 ? "text-red-600 dark:text-red-400" : ""}`}>0 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Inaceitavel</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg hover:shadow-xl transition-shadow report-print-indicator">
          <CardHeader>
            <CardTitle>IPT - Indicador de Execução dos Planos de Trabalho</CardTitle>
            <CardDescription>Pontuação máxima: 40 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Fórmula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IPT = Media ponderada (Mao de obra 50% + Equipamentos 50%)
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Mao de obra:</strong> Rastreamento dos portateis (50%).
                </li>
                <li>
                  <strong>Equipamentos:</strong> Rastreamento dos equipamentos intermediarios (50%).
                </li>
                <li>
                  <strong>Fonte:</strong> Sistema de monitoramento da SELIMP.
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              {detalhes?.ipt ? (
                <>
                  <p className="text-sm">
                    IPT = {formatarValor(detalhes.ipt.valor, 2)}%
                  </p>
                  <p className="text-sm">
                    Pontuacao: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes.ipt.pontuacao, 2)} pts</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">IPT nao informado para este periodo. Atualize na tela principal do dashboard.</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuação</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuação</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 0 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IPT &gt;= 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 0 ? "text-green-600 dark:text-green-400" : ""}`}>40 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Execucao excelente</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 1 ? "bg-green-50 dark:bg-green-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">80% &lt;= IPT &lt; 90%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 1 ? "text-green-600 dark:text-green-400" : ""}`}>38 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Otimo desempenho</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 2 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">70% &lt;= IPT &lt; 80%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 2 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>36 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Bom desempenho</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 3 ? "bg-yellow-50 dark:bg-yellow-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">60% &lt;= IPT &lt; 70%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 3 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>32 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho regular</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 4 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">50% &lt;= IPT &lt; 60%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 4 ? "text-orange-600 dark:text-orange-400" : ""}`}>28 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho mediano</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 5 ? "bg-orange-50 dark:bg-orange-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">40% &lt;= IPT &lt; 50%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 5 ? "text-orange-600 dark:text-orange-400" : ""}`}>24 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho insatisfatorio</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 6 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">30% &lt;= IPT &lt; 40%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 6 ? "text-red-600 dark:text-red-400" : ""}`}>20 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho critico</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 7 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">20% &lt;= IPT &lt; 30%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 7 ? "text-red-600 dark:text-red-400" : ""}`}>16 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho muito baixo</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 8 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">10% &lt;= IPT &lt; 20%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 8 ? "text-red-600 dark:text-red-400" : ""}`}>12 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho deficiente</td>
                    </tr>
                    <tr className={getIPTRowIndex(detalhes?.ipt?.pontuacao) === 9 ? "bg-red-50 dark:bg-red-900/20" : ""}>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">IPT &lt; 10%</td>
                      <td className={`border border-zinc-300 dark:border-zinc-700 p-2 text-center font-bold ${getIPTRowIndex(detalhes?.ipt?.pontuacao) === 9 ? "text-red-600 dark:text-red-400" : ""}`}>0 pts</td>
                      <td className="border border-zinc-300 dark:border-zinc-700 p-2">Desempenho inaceitavel</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg shadow-violet-500/20 report-print-indicator">
          <CardHeader>
            <CardTitle>Resumo dos indicadores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className={`flex justify-between items-center p-3 rounded border ${getPontosStyle(detalhes?.ird?.pontuacao ?? 0, 20)}`}>
                <span className="font-medium">
                  IRD = {formatarValor(detalhes?.ird?.valor, 3)} | {detalhes?.ird?.total_reclamacoes ?? 0} procedentes
                </span>
                <span className="font-bold">
                  {formatarValor(detalhes?.ird?.pontuacao, 2)} pts
                </span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded border ${getPontosStyle(detalhes?.ia?.pontuacao ?? 0, 20)}`}>
                <span className="font-medium">
                  IA = {formatarValor(detalhes?.ia?.percentual ?? detalhes?.ia?.valor ?? 0, 2)}% | {detalhes?.ia?.total_no_prazo ?? 0} no prazo, {detalhes?.ia?.total_fora_prazo ?? 0} fora
                </span>
                <span className="font-bold">
                  {formatarValor(detalhes?.ia?.pontuacao, 2)} pts
                </span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded border ${getPontosStyle(detalhes?.if?.pontuacao ?? 0, 20)}`}>
                <span className="font-medium">
                  IF = {formatarValor(detalhes?.if?.percentual ?? ((detalhes?.if?.valor ?? 0) / 10), 2)}% | {detalhes?.if?.total_sem_irregularidade ?? 0} sem irregularidade
                </span>
                <span className="font-bold">
                  {formatarValor(detalhes?.if?.pontuacao, 2)} pts
                </span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded border ${detalhes?.ipt ? getPontosStyle(detalhes.ipt.pontuacao ?? 0, 40) : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'}`}>
                <span className="font-medium">
                  IPT = {detalhes?.ipt ? formatarValor(detalhes.ipt.valor, 2) + '%' : 'Não informado'}
                </span>
                <span className="font-bold">
                  {detalhes?.ipt ? formatarValor(detalhes.ipt.pontuacao, 2) + ' pts' : '0 pts'}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-violet-50 dark:bg-violet-900/20 rounded border-2 border-violet-500">
                <span className="font-bold text-lg">Total ADC (IRD + IA + IF + IPT)</span>
                <span className="font-bold text-lg text-violet-600 dark:text-violet-400">{formatarValor(pontuacaoTotal, 2)} pts</span>
              </div>
              
              {/* Informações de Desconto e Glosa */}
              <div className={`p-4 rounded-lg border-2 ${infoDesconto.desconto > 0 ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700' : 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700'}`}>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className={`font-semibold text-lg ${infoDesconto.desconto > 0 ? 'text-yellow-800 dark:text-yellow-200' : 'text-green-800 dark:text-green-200'}`}>
                      {infoDesconto.desconto > 0 ? '⚠️ Desconto Aplicado' : '✅ Sem Desconto'}
                    </span>
                    {infoDesconto.desconto > 0 && (
                      <span className="text-lg font-bold text-yellow-800 dark:text-yellow-200">
                        -{formatarValor(infoDesconto.desconto, 2)}%
                      </span>
                    )}
                  </div>
                  <div className="text-sm space-y-1">
                    <p className={`font-medium ${infoDesconto.desconto > 0 ? 'text-yellow-700 dark:text-yellow-300' : 'text-green-700 dark:text-green-300'}`}>
                      Percentual do valor contratual a receber: <strong>{formatarValor(infoDesconto.percentual, 2)}%</strong>
                      {detalhes?.resumo_adc && typeof detalhes.resumo_adc.valor_mensal_contrato === "number" && (
                        <> — <strong>R$ {((detalhes.resumo_adc.valor_mensal_contrato ?? 0) - (detalhes.resumo_adc.glosa_real ?? 0)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></>
                      )}
                    </p>
                    <p className={`text-xs ${infoDesconto.desconto > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                      {infoDesconto.explicacao}
                    </p>
                    {detalhes?.resumo_adc && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-current/20">
                        <div>
                          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Desconto real</div>
                          <div className="text-lg font-bold">{formatarValor(detalhes.resumo_adc.desconto, 2)}%</div>
                        </div>
                        <div>
                          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-0.5">Valor da glosa (R$)</div>
                          <div className="text-lg font-bold">
                            {typeof detalhes.resumo_adc.glosa_real === "number"
                              ? detalhes.resumo_adc.glosa_real.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : "0,00"}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Base: R$ {(detalhes.resumo_adc.valor_mensal_contrato ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {!detalhes?.ipt && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Informe o IPT na tela principal do dashboard para concluir o ADC. Use o filtro de SACs fora do prazo para justificar descontos.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
