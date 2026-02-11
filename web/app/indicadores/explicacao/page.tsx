"use client";

import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/main-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiService } from "@/lib/api";
import { endOfMonth, format, startOfMonth } from "date-fns";

interface IndicadorDetalhe {
  valor?: number;
  pontuacao?: number;
  total_reclamacoes?: number;
  domicilios?: number;
  tipos_considerados?: string[];
  total_procedentes?: number;
  total_no_prazo?: number;
  total_fora_prazo?: number;
  total_fiscalizacoes?: number;
  total_sem_irregularidade?: number;
  status_referencia?: string;
  servicos_nao_demandantes?: string[];
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
  const [error, setError] = useState<string | null>(null);

  const carregarDetalhes = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getIndicadoresDetalhes(periodoInicial, periodoFinal);
      console.log("Detalhes recebidos:", data);
      console.log("IPT recebido:", data?.ipt);
      console.log("Período solicitado:", periodoInicial, "->", periodoFinal);
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


  const periodoLabel = detalhes
    ? `${format(new Date(detalhes.periodo.inicial), "dd/MM/yyyy")} -> ${format(
        new Date(detalhes.periodo.final),
        "dd/MM/yyyy"
      )}`
    : `${format(new Date(periodoInicial), "dd/MM/yyyy")} -> ${format(new Date(periodoFinal), "dd/MM/yyyy")}`;

  const pontuacaoParcial =
    (detalhes?.ird?.pontuacao ?? 0) + (detalhes?.ia?.pontuacao ?? 0) + (detalhes?.if?.pontuacao ?? 0);
  const pontuacaoTotal = pontuacaoParcial + (detalhes?.ipt?.pontuacao ?? 0);

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

  return (
    <MainLayout>
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Explicacao dos Calculos dos Indicadores</h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Combine a teoria com os numeros reais vindos do backend para auditar qualquer mes ou subprefeitura.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Periodo analisado</CardTitle>
            <CardDescription>Use o mesmo range configurado na tela principal</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Periodo inicial</label>
                <input
                  type="date"
                  value={periodoInicial}
                  onChange={(e) => setPeriodoInicial(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Periodo final</label>
                <input
                  type="date"
                  value={periodoFinal}
                  onChange={(e) => setPeriodoFinal(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={carregarDetalhes}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading ? "Atualizando..." : "Atualizar explicacao"}
                </button>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-4">
              Sugestao: trabalhe com o mes corrente inteiro para replicar os calculos de IA e IRD do dashboard.
            </p>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>IRD - Indicador de Reclamacoes por Domicilio</CardTitle>
            <CardDescription>Pontuacao maxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Formula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IRD = (Reclamacoes Escalonadas Procedentes / Numero de Domicilios) x 1000
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Procedentes escalonados:</strong> {detalhes?.ird?.tipos_considerados?.join(", ") ?? "varricao, mutirao, bueiro e cata-bagulho"} finalizados ou confirmados.
                </li>
                <li>
                  <strong>Domicilios:</strong> 511093 ou o total especifico da subprefeitura filtrada.
                </li>
                <li>
                  <strong>Fator 1000:</strong> expressa o indicador por mil domicilios.
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              <p className="text-sm text-zinc-700 dark:text-zinc-200">
                {detalhes?.ird
                  ? `IRD = (${detalhes.ird.total_reclamacoes ?? 0} / ${detalhes.ird.domicilios ?? 0}) x 1000 = ${formatarValor(
                      detalhes.ird.valor,
                      3
                    )}`
                  : "Nenhum SAC escalonado procedente encontrado no periodo."}
              </p>
              <p className="text-sm">
                Pontuacao: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes?.ird?.pontuacao, 2)} pts</strong>
              </p>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuacao</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuacao</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretacao</th>
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

        <Card>
          <CardHeader>
            <CardTitle>IA - Indicador de Atendimento</CardTitle>
            <CardDescription>Pontuacao maxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Formula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IA = (Demandantes atendidos no prazo / Demandantes procedentes) x 100
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Tipos:</strong> {detalhes?.ia?.tipos_considerados?.join(", ") ?? "entulho, animal morto e papeleiras"}.
                </li>
                <li>
                  <strong>Procedentes:</strong> SACs executados/finalizados no periodo.
                </li>
                <li>
                  <strong>No prazo:</strong> diferenca entre execucao e abertura menor ou igual ao SLA do protocolo.
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              {detalhes?.ia ? (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    Procedentes: <strong>{detalhes.ia.total_procedentes}</strong>
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    No prazo: <strong>{detalhes.ia.total_no_prazo}</strong>
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    Fora do prazo: <strong>{detalhes.ia.total_fora_prazo}</strong>
                  </p>
                  <p className="text-sm">
                    IA = ({detalhes.ia.total_no_prazo} / {detalhes.ia.total_procedentes}) x 100 = {formatarValor(detalhes.ia.valor, 2)}%
                  </p>
                  <p className="text-sm">
                    Pontuacao: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes.ia.pontuacao, 2)} pts</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Nenhum SAC demandante procedente no periodo.</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuacao</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuacao</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretacao</th>
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

        <Card>
          <CardHeader>
            <CardTitle>IF - Indicador de Fiscalizacao</CardTitle>
            <CardDescription>Pontuacao maxima: 20 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Formula</h3>
              <div className="bg-zinc-50 dark:bg-zinc-900 p-4 rounded-lg font-mono text-sm">
                IF = (BFS sem irregularidade / Total de BFS) x 100
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Componentes</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  <strong>Status valido:</strong>{" "}
                  {detalhes?.if?.status_referencia ??
                    "BFS Não Demandantes sem irregularidade (tem_irregularidade = False)"}.
                </li>
                <li>
                  <strong>Total BFS:</strong> fiscalizacoes registradas no periodo,
                  apenas dos serviços classificados como BFS Nao Demandantes.
                </li>
                <li>
                  <strong>Servicos Nao Demandantes (SELIMP):</strong>{" "}
                  {detalhes?.if?.servicos_nao_demandantes?.length
                    ? detalhes.if.servicos_nao_demandantes.join("; ")
                    : "Varrição manual de vias e logradouros públicos; Varrição mecanizada de vias e logradouros públicos; Varrição de pós feiras livres e Lavagem e desinfecção de vias e logradouros públicos pós feiras livres; Operação dos Ecopontos; Equipe de Mutirão de Zeladoria de Vias e Logradouros Públicos; Lavagem especial de equipamentos públicos; Limpeza e desobstrução de bueiros, bocas de lobo e bocas de leão; Remoção dos Resíduos dos Ecopontos; Coleta programada e transporte de objetos volumosos e de entulho (Cata-Bagulho); Coleta manual de resíduos orgânicos de feiras-livres; Coleta e transporte de PEV-Ponto de Entrega Voluntária."}
                </li>
              </ul>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-sm">Resultado ({periodoLabel})</h3>
              {detalhes?.if ? (
                <>
                  <p className="text-sm text-zinc-700 dark:text-zinc-200">
                    Total BFS: <strong>{detalhes.if.total_fiscalizacoes}</strong>
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Sem irregularidade: <strong>{detalhes.if.total_sem_irregularidade}</strong>
                  </p>
                  <p className="text-sm">
                    IF = ({detalhes.if.total_sem_irregularidade} / {detalhes.if.total_fiscalizacoes}) x 100 = {formatarValor(detalhes.if.valor, 2)}%
                  </p>
                  <p className="text-sm">
                    Pontuacao: <strong className="text-violet-600 dark:text-violet-300">{formatarValor(detalhes.if.pontuacao, 2)} pts</strong>
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">Nao ha fiscalizacoes no periodo informado.</p>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-2">Tabela de pontuacao</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuacao</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretacao</th>
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

        <Card>
          <CardHeader>
            <CardTitle>IPT - Indicador de Execução dos Planos de Trabalho</CardTitle>
            <CardDescription>Pontuacao maxima: 40 pontos</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Formula</h3>
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
              <h3 className="font-semibold mb-2">Tabela de pontuacao</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-zinc-100 dark:bg-zinc-800">
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Faixa</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-center">Pontuacao</th>
                      <th className="border border-zinc-300 dark:border-zinc-700 p-2 text-left">Interpretacao</th>
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

        <Card className="border-2 border-violet-500">
          <CardHeader>
            <CardTitle>Resumo dos indicadores</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-zinc-50 dark:bg-zinc-900 rounded">
                <span className="font-medium">
                  IRD = {formatarValor(detalhes?.ird?.valor, 3)} | {detalhes?.ird?.total_reclamacoes ?? 0} procedentes
                </span>
                <span className="font-bold text-green-600 dark:text-green-400">
                  {formatarValor(detalhes?.ird?.pontuacao, 2)} pts
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-zinc-50 dark:bg-zinc-900 rounded">
                <span className="font-medium">
                  IA = {formatarValor(detalhes?.ia?.valor, 2)}% | {detalhes?.ia?.total_no_prazo ?? 0} dentro / {detalhes?.ia?.total_procedentes ?? 0} total
                </span>
                <span className="font-bold text-yellow-600 dark:text-yellow-400">
                  {formatarValor(detalhes?.ia?.pontuacao, 2)} pts
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-zinc-50 dark:bg-zinc-900 rounded">
                <span className="font-medium">
                  IF = {formatarValor(detalhes?.if?.valor, 2)}% | {detalhes?.if?.total_sem_irregularidade ?? 0} sem ocorrencia
                </span>
                <span className="font-bold text-green-600 dark:text-green-400">
                  {formatarValor(detalhes?.if?.pontuacao, 2)} pts
                </span>
              </div>
              <div className={`flex justify-between items-center p-3 rounded ${detalhes?.ipt ? 'bg-zinc-50 dark:bg-zinc-900' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'}`}>
                <span className="font-medium">
                  IPT = {detalhes?.ipt ? formatarValor(detalhes.ipt.valor, 2) + '%' : 'Não informado'}
                </span>
                <span className={`font-bold ${detalhes?.ipt ? 'text-violet-600 dark:text-violet-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                  {detalhes?.ipt ? formatarValor(detalhes.ipt.pontuacao, 2) + ' pts' : '0 pts'}
                </span>
              </div>
              <div className="flex justify-between items-center p-3 bg-violet-50 dark:bg-violet-900/20 rounded border-2 border-violet-500">
                <span className="font-bold text-lg">Total ADC (IRD + IA + IF + IPT)</span>
                <span className="font-bold text-lg text-violet-600 dark:text-violet-400">{formatarValor(pontuacaoTotal, 2)} pts</span>
              </div>
              
              {/* Informações de Desconto */}
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
                    </p>
                    <p className={`text-xs ${infoDesconto.desconto > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600 dark:text-green-400'}`}>
                      {infoDesconto.explicacao}
                    </p>
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
