import { pool } from "../db.js";
import {
  parseSetor,
  normalizarSetor,
  CRONOGRAMA_SERVICOS,
  toDateKey,
  parseDateKeyLocal,
  generateFrequencyDates,
} from "../constants/ipt.js";

export interface ReportLinhaRaw {
  plano: string;
  subprefeitura: string;
  tipo_servico: string;
  status: string;
  percentual_execucao: number | null;
  equipamentos: string;
  raw: Record<string, string>;
  posicao_original: number;
}

export interface ReportLinhaComData extends ReportLinhaRaw {
  data_estimada: string | null;
  metodo_estimativa: string;
  confianca_estimativa: "alta" | "media" | "baixa";
  frequencia: string;
  servico_codigo: string;
  despacho_esperado: boolean | null;
}

/**
 * Estima a data de cada linha do Report SELIMP dentro de um período.
 *
 * Estratégia em camadas (por plano):
 *   1. Cronograma cadastrado → confiança alta
 *   2. Se cronograma vazio, usa frequência do setor → confiança média
 *   3. Cross-ref com consolidado/DDMX → eleva qualquer método para alta
 *   4. Fallback: posição relativa entre vizinhos com data conhecida → baixa
 *
 * Pós-processamento global:
 *   - Linhas sem data são refinadas usando a posição entre vizinhos que JÁ
 *     têm data conhecida (alta/média) — se LE está entre GO(20/03) e
 *     MT(20/03), e sua frequência bate no dia 20/03, recebe essa data.
 */
export async function estimarDatasReport(
  linhas: ReportLinhaRaw[],
  periodoInicial: string,
  periodoFinal: string,
): Promise<ReportLinhaComData[]> {
  const cronogramaMap = await carregarCronograma(periodoInicial, periodoFinal);
  const consolidadoDatas = await carregarDatasConsolidado(periodoInicial, periodoFinal);

  const porPlano = new Map<string, ReportLinhaRaw[]>();
  for (const linha of linhas) {
    const plano = normalizarSetor(linha.plano);
    if (!plano) continue;
    const arr = porPlano.get(plano) ?? [];
    arr.push(linha);
    porPlano.set(plano, arr);
  }

  const resultado: ReportLinhaComData[] = [];

  for (const [plano, linhasDoPlano] of porPlano) {
    const parsed = parseSetor(plano);
    const frequencia = parsed?.frequencia ?? "";
    const servicoCodigo = parsed?.servico ?? "";

    const linhasOrdenadas = [...linhasDoPlano].sort(
      (a, b) => a.posicao_original - b.posicao_original,
    );

    // Passo 1: Tentar cronograma (só para serviços que TÊM cronograma cadastrado)
    const datasEsperadas = CRONOGRAMA_SERVICOS.has(servicoCodigo)
      ? (cronogramaMap.get(plano) ?? [])
      : [];
    const datasOrdenadas = [...datasEsperadas].sort();

    if (datasOrdenadas.length > 0) {
      for (let i = 0; i < linhasOrdenadas.length; i++) {
        const linha = linhasOrdenadas[i];
        const dataCronograma = datasOrdenadas[i] ?? datasOrdenadas[datasOrdenadas.length - 1];
        const crossRef = consolidadoDatas.has(`${plano}|${dataCronograma}`);
        resultado.push({
          ...linha,
          plano,
          frequencia,
          servico_codigo: servicoCodigo,
          data_estimada: dataCronograma,
          metodo_estimativa: crossRef ? "cronograma+cross_ref" : "cronograma",
          confianca_estimativa: "alta",
          despacho_esperado: null,
        });
      }
      continue;
    }

    // Passo 2: Frequência — para QUALQUER serviço que tenha código de frequência
    if (frequencia) {
      const datasValidas = generateFrequencyDates(frequencia, periodoInicial, periodoFinal);
      if (datasValidas.length > 0) {
        for (let i = 0; i < linhasOrdenadas.length; i++) {
          const linha = linhasOrdenadas[i];
          const dataIdx = Math.min(i, datasValidas.length - 1);
          const dataFreq = datasValidas[dataIdx];
          const crossRef = consolidadoDatas.has(`${plano}|${dataFreq}`);
          resultado.push({
            ...linha,
            plano,
            frequencia,
            servico_codigo: servicoCodigo,
            data_estimada: dataFreq,
            metodo_estimativa: crossRef ? "frequencia+cross_ref" : "frequencia",
            confianca_estimativa: crossRef ? "alta" : "media",
            despacho_esperado: null,
          });
        }
        continue;
      }
    }

    // Passo 3: Fallback — marca como pendente (será refinado no pós-processamento)
    for (let i = 0; i < linhasOrdenadas.length; i++) {
      resultado.push({
        ...linhasOrdenadas[i],
        plano,
        frequencia,
        servico_codigo: servicoCodigo,
        data_estimada: null,
        metodo_estimativa: "pendente",
        confianca_estimativa: "baixa",
        despacho_esperado: null,
      });
    }
  }

  // Pós-processamento: refinar linhas sem data usando vizinhos com data conhecida
  refinarPorVizinhanca(resultado, periodoInicial, periodoFinal, consolidadoDatas);

  resultado.sort((a, b) => a.posicao_original - b.posicao_original);
  return resultado;
}

/**
 * Para linhas sem data (pendente/baixa), olha vizinhos acima e abaixo na
 * ordem original da planilha que JÁ têm data (alta/média). Se a frequência
 * bate com alguma data no intervalo entre os vizinhos, usa essa data.
 * Caso contrário, interpola pela posição.
 */
function refinarPorVizinhanca(
  resultado: ReportLinhaComData[],
  periodoInicial: string,
  periodoFinal: string,
  consolidadoDatas: Set<string>,
): void {
  const porPosicao = [...resultado].sort(
    (a, b) => a.posicao_original - b.posicao_original,
  );

  const pendentes = porPosicao.filter((r) => r.data_estimada === null);
  if (pendentes.length === 0) return;

  const conhecidos = porPosicao.filter(
    (r) => r.data_estimada !== null && r.confianca_estimativa !== "baixa",
  );

  for (const item of pendentes) {
    const pos = item.posicao_original;

    // Acha vizinho mais próximo ACIMA (posição menor) com data conhecida
    let vizinhoAntes: ReportLinhaComData | null = null;
    for (let i = conhecidos.length - 1; i >= 0; i--) {
      if (conhecidos[i].posicao_original < pos) {
        vizinhoAntes = conhecidos[i];
        break;
      }
    }

    // Acha vizinho mais próximo ABAIXO (posição maior) com data conhecida
    let vizinhoDepois: ReportLinhaComData | null = null;
    for (let i = 0; i < conhecidos.length; i++) {
      if (conhecidos[i].posicao_original > pos) {
        vizinhoDepois = conhecidos[i];
        break;
      }
    }

    const dataMin = vizinhoAntes?.data_estimada ?? periodoInicial;
    const dataMax = vizinhoDepois?.data_estimada ?? periodoFinal;

    // Se tem frequência, gera datas válidas dentro do intervalo dos vizinhos
    if (item.frequencia) {
      const datasNoIntervalo = generateFrequencyDates(item.frequencia, dataMin, dataMax);
      if (datasNoIntervalo.length > 0) {
        // Pega a data mais próxima do meio do intervalo
        const midIdx = Math.floor(datasNoIntervalo.length / 2);
        const dataEscolhida = datasNoIntervalo[midIdx];
        const crossRef = consolidadoDatas.has(`${item.plano}|${dataEscolhida}`);
        item.data_estimada = dataEscolhida;
        item.metodo_estimativa = crossRef ? "vizinhanca+frequencia+cross_ref" : "vizinhanca+frequencia";
        item.confianca_estimativa = crossRef ? "alta" : "media";
        continue;
      }
    }

    // Sem frequência ou sem data válida: interpola pela posição
    if (dataMin === dataMax) {
      item.data_estimada = dataMin;
      item.metodo_estimativa = "vizinhanca";
      item.confianca_estimativa = "media";
    } else {
      const posMin = vizinhoAntes?.posicao_original ?? 0;
      const posMax = vizinhoDepois?.posicao_original ?? (porPosicao[porPosicao.length - 1]?.posicao_original ?? pos);
      const range = posMax - posMin;
      const frac = range > 0 ? (pos - posMin) / range : 0.5;
      const dMin = parseDateKeyLocal(dataMin);
      const dMax = parseDateKeyLocal(dataMax);
      const totalMs = dMax.getTime() - dMin.getTime();
      const estimatedMs = dMin.getTime() + Math.round(frac * totalMs);
      const estimatedDate = new Date(estimatedMs);
      item.data_estimada = toDateKey(estimatedDate);
      item.metodo_estimativa = "vizinhanca+interpolacao";
      item.confianca_estimativa = "baixa";
    }
  }
}

export async function carregarCronograma(
  inicio: string,
  fim: string,
): Promise<Map<string, string[]>> {
  const res = await pool.query(
    `SELECT setor, data_esperada::text AS data_esperada
     FROM ipt_cronograma
     WHERE data_esperada >= $1::date AND data_esperada <= $2::date
     ORDER BY data_esperada`,
    [inicio, fim],
  );
  const map = new Map<string, string[]>();
  for (const row of res.rows) {
    const setor = normalizarSetor(row.setor);
    const dateKey = row.data_esperada?.slice(0, 10);
    if (!setor || !dateKey) continue;
    const arr = map.get(setor) ?? [];
    arr.push(dateKey);
    map.set(setor, arr);
  }
  return map;
}

/**
 * Carrega datas de setores presentes no consolidado de veículos/varrição e no DDMX.
 * Retorna um Set de chaves "SETOR|YYYY-MM-DD" para cross-reference rápido.
 */
async function carregarDatasConsolidado(
  inicio: string,
  fim: string,
): Promise<Set<string>> {
  const chaves = new Set<string>();

  const veicRes = await pool.query(
    `SELECT setor, data_referencia::text AS data_referencia
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_veiculos'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim],
  );
  for (const row of veicRes.rows) {
    const setor = normalizarSetor(row.setor);
    const dk = row.data_referencia?.slice(0, 10);
    if (setor && dk) chaves.add(`${setor}|${dk}`);
  }

  const varrRes = await pool.query(
    `SELECT setor, data_referencia::text AS data_referencia
     FROM ipt_imports
     WHERE file_type = 'ipt_consolidado_varricao'
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim],
  );
  for (const row of varrRes.rows) {
    const setor = normalizarSetor(row.setor);
    const dk = row.data_referencia?.slice(0, 10);
    if (setor && dk) chaves.add(`${setor}|${dk}`);
  }

  const ddmxRes = await pool.query(
    `SELECT setor, data_referencia::text AS data_referencia
     FROM ipt_imports
     WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores')
       AND data_referencia >= $1::date AND data_referencia <= $2::date`,
    [inicio, fim],
  );
  for (const row of ddmxRes.rows) {
    const setor = normalizarSetor(row.setor ?? "");
    const dk = row.data_referencia?.slice(0, 10);
    if (setor && dk) chaves.add(`${setor}|${dk}`);
  }

  return chaves;
}
