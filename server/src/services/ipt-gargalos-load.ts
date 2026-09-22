/**
 * Agrega gargalos no Postgres: uma linha por setor, sem detalhe diário nem preview.
 */

import { pool } from "../db.js";
import {
  getFrequenciaDescricao,
  getSubFromPlano,
  normalizarSetor,
  parseSetor,
  registerVpCanonicalFromSelimp,
  resolveTipoServicoExibicao,
  resolveVpCanonicalFromDdmx,
} from "../constants/ipt.js";
import { classificarGargalos, type GargalosResultado, type SetorFato } from "./ipt-gargalos.js";

export interface GargaloDia {
  data: string;
  encerrado: boolean;
  naoEnviado: boolean;
  percentual: number | null;
}

export interface GargaloDetalhe {
  plano: string;
  dias: GargaloDia[];
}

const pctEncerradoSql = `
  CASE
    WHEN percentual_execucao IS NULL THEN NULL
    WHEN percentual_execucao > 1 THEN LEAST(percentual_execucao::float8, 100)
    ELSE percentual_execucao::float8 * 100
  END
`;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function comSinalDe(status: string, comunicacao: string): boolean {
  const s = status.trim();
  if (/com\s*sinal|^on$/i.test(s)) return true;
  return /^on$/i.test(comunicacao.trim());
}

function semSinalTexto(value: string | null): boolean {
  if (!value || !value.trim()) return false;
  return !/com\s*sinal|^on$/i.test(value.trim());
}

function frequenciaLabel(plano: string, frequencia: string | null): string {
  const code = parseSetor(plano)?.frequencia ?? "";
  if (code && getFrequenciaDescricao(code) !== code) return getFrequenciaDescricao(code);
  const col = (frequencia ?? "").trim();
  if (/^\d{4}$/.test(col) && getFrequenciaDescricao(col) !== col) return getFrequenciaDescricao(col);
  return col || "—";
}

interface ReportRow {
  plano: string;
  tipo_servico: string | null;
  frequencia: string | null;
  previstos: number;
  encerrados: number;
  nao_enviados: number;
  soma_percentual: number;
  contagem_percentual: number;
}

interface ModuloRow {
  setor: string;
  selimp: string | null;
  ddmx: string | null;
  status_sinal: string | null;
  comunicacao: string | null;
  bateria_percentual: number | null;
  produtividade_bateria: number | null;
  qtd_trocas: number | null;
}

interface TrocaRow {
  modulo: string;
  qtd: number;
  ultimo_sinal: string | null;
}

interface ManutRow {
  modulo: string;
  sem_sinal: boolean;
}

interface DdmxRow {
  setor: string;
  soma: number;
  n: number;
  linhas: number;
}

interface ObsRow {
  setor: string;
  titulo: string;
}

function emptyFato(plano: string, tipo: string, frequencia: string): SetorFato {
  return {
    plano,
    sub: getSubFromPlano(plano) || "—",
    tipoServico: tipo,
    frequencia,
    previstos: 0,
    encerrados: 0,
    naoEnviados: 0,
    somaPercentual: 0,
    contagemPercentual: 0,
    temModulo: false,
    comSinal: false,
    bateriaMedia: null,
    qtdTrocas: 0,
    trocaSemSinal: false,
    manutencaoSemSinal: false,
    percentualDdmx: null,
    temDdmx: false,
    obsTitulo: null,
  };
}

export async function loadGargalos(inicio: string, fim: string): Promise<GargalosResultado & { periodo: { inicial: string; final: string } }> {
  const [reportRes, moduloRes, trocaRes, manutRes, ddmxRes, obsRes] = await Promise.all([
    pool.query<ReportRow>(
      `SELECT plano,
              MAX(tipo_servico) FILTER (WHERE tipo_servico IS NOT NULL AND btrim(tipo_servico) <> '') AS tipo_servico,
              MAX(frequencia) FILTER (WHERE frequencia IS NOT NULL AND btrim(frequencia) <> '') AS frequencia,
              COUNT(*) FILTER (
                WHERE lower(COALESCE(status, '')) NOT LIKE '%cancel%'
              )::int AS previstos,
              COUNT(*) FILTER (
                WHERE lower(COALESCE(status, '')) LIKE '%encerrad%'
              )::int AS encerrados,
              COUNT(*) FILTER (
                WHERE translate(lower(COALESCE(status, '')), 'áàãâéêíóôõúç', 'aaaaeeiooouc') LIKE '%nao despach%'
              )::int AS nao_enviados,
              COALESCE(SUM(
                CASE
                  WHEN lower(COALESCE(status, '')) LIKE '%encerrad%' AND percentual_execucao IS NOT NULL THEN
                    ${pctEncerradoSql}
                  ELSE 0
                END
              ), 0)::float8 AS soma_percentual,
              COUNT(*) FILTER (
                WHERE lower(COALESCE(status, '')) LIKE '%encerrad%' AND percentual_execucao IS NOT NULL
              )::int AS contagem_percentual
         FROM ipt_report_linhas
        WHERE data_estimada >= $1::date AND data_estimada <= $2::date
        GROUP BY plano`,
      [inicio, fim],
    ),
    pool.query<ModuloRow>(
      `SELECT sm.setor,
              NULLIF(btrim(sm.selimp_codigo), '') AS selimp,
              NULLIF(btrim(sm.ddmx_codigo), '') AS ddmx,
              COALESCE(m.status_sinal_manual, m.status_sinal_calculado) AS status_sinal,
              m.comunicacao,
              m.bateria_percentual::float8 AS bateria_percentual,
              m.produtividade_bateria::float8 AS produtividade_bateria,
              m.qtd_trocas
         FROM setores_modulos sm
         LEFT JOIN modulo_selimp m
           ON btrim(m.modulo_selimp) = btrim(sm.selimp_codigo)`,
    ),
    pool.query<TrocaRow>(
      `SELECT btrim(modulo_selimp) AS modulo,
              COUNT(*)::int AS qtd,
              (ARRAY_AGG(status_sinal_depois ORDER BY COALESCE(data_troca, created_at::date) DESC, id DESC))[1] AS ultimo_sinal
         FROM bateria_trocas_eventos
        WHERE status = 'concluida'
        GROUP BY btrim(modulo_selimp)`,
    ),
    pool.query<ManutRow>(
      `SELECT btrim(modulo_selimp) AS modulo,
              BOOL_OR(COALESCE(status, '') = 'REALIZADA' AND NOT COALESCE(sinal_recuperado, false)) AS sem_sinal
         FROM modulo_manutencoes
        GROUP BY btrim(modulo_selimp)`,
    ),
    pool.query<DdmxRow>(
      `WITH src AS (
         SELECT setor, raw FROM ipt_ddmx_varricao
          WHERE data_referencia >= $1::date AND data_referencia <= $2::date
         UNION ALL
         SELECT setor, raw FROM ipt_ddmx_veiculos
          WHERE data_referencia >= $1::date AND data_referencia <= $2::date
       ),
       parsed AS (
         SELECT COALESCE(
                  NULLIF(btrim(setor), ''),
                  NULLIF(btrim(raw->>'rota'), ''),
                  NULLIF(btrim(raw->>'plano'), ''),
                  NULLIF(btrim(raw->>'setor'), '')
                ) AS setor,
                replace(replace(btrim(COALESCE(
                  NULLIF(raw->>'percentual_execucao', ''),
                  NULLIF(raw->>'percentual_de_execucao', ''),
                  NULLIF(raw->>'percentual_conclusao', ''),
                  NULLIF(raw->>'percentual', ''),
                  NULLIF(raw->>'de_execucao', ''),
                  NULLIF(raw->>'percentual_executado', ''),
                  ''
                )), '%', ''), ',', '.') AS cleaned
           FROM src
       )
       SELECT setor,
              COALESCE(SUM(
                CASE
                  WHEN cleaned ~ '^[0-9]+([.][0-9]+)?$' THEN
                    LEAST(100, CASE WHEN cleaned::numeric > 1 THEN cleaned::numeric ELSE cleaned::numeric * 100 END)
                  ELSE NULL
                END
              ), 0)::float8 AS soma,
              COUNT(*) FILTER (WHERE cleaned ~ '^[0-9]+([.][0-9]+)?$')::int AS n,
              COUNT(*)::int AS linhas
         FROM parsed
        WHERE setor IS NOT NULL AND setor <> ''
        GROUP BY setor`,
      [inicio, fim],
    ),
    pool.query<ObsRow>(
      `SELECT setor, titulo
         FROM ipt_observacoes_globais
        WHERE data_cancelamento IS NULL
        ORDER BY setor, id`,
    ),
  ]);

  const registry = new Map<string, string>();
  const byPlano = new Map<string, SetorFato>();

  for (const row of reportRes.rows) {
    const raw = normalizarSetor(String(row.plano ?? ""));
    if (!raw) continue;
    const plano = registerVpCanonicalFromSelimp(raw, registry);
    const tipo = resolveTipoServicoExibicao(plano, row.tipo_servico ?? "") || row.tipo_servico || "Não informado";
    const freq = frequenciaLabel(plano, row.frequencia);
    const atual = byPlano.get(plano) ?? emptyFato(plano, tipo, freq);
    atual.previstos += num(row.previstos);
    atual.encerrados += num(row.encerrados);
    atual.naoEnviados += num(row.nao_enviados);
    atual.somaPercentual += num(row.soma_percentual);
    atual.contagemPercentual += num(row.contagem_percentual);
    if (!atual.tipoServico || atual.tipoServico === "Não informado") atual.tipoServico = tipo;
    if (atual.frequencia === "—" && freq !== "—") atual.frequencia = freq;
    byPlano.set(plano, atual);
  }

  const trocaPorModulo = new Map<string, TrocaRow>();
  for (const row of trocaRes.rows) {
    const key = String(row.modulo ?? "").trim().toUpperCase();
    if (key) trocaPorModulo.set(key, row);
  }
  const manutPorModulo = new Map<string, boolean>();
  for (const row of manutRes.rows) {
    const key = String(row.modulo ?? "").trim().toUpperCase();
    if (key) manutPorModulo.set(key, Boolean(row.sem_sinal));
  }

  for (const row of moduloRes.rows) {
    const raw = normalizarSetor(String(row.setor ?? ""));
    if (!raw) continue;
    const plano = resolveVpCanonicalFromDdmx(raw, registry);
    const fato = byPlano.get(plano);
    if (!fato) continue;
    const selimp = String(row.selimp ?? "").trim().toUpperCase();
    if (selimp) {
      fato.temModulo = true;
      const status = String(row.status_sinal ?? "");
      fato.comSinal = fato.comSinal || comSinalDe(status, String(row.comunicacao ?? ""));
      const bat = numOrNull(row.bateria_percentual) ?? numOrNull(row.produtividade_bateria);
      if (bat != null) {
        fato.bateriaMedia = fato.bateriaMedia == null ? bat : (fato.bateriaMedia + bat) / 2;
      }
      const troca = trocaPorModulo.get(selimp);
      const qtdEventos = troca ? num(troca.qtd) : 0;
      fato.qtdTrocas += qtdEventos > 0 ? qtdEventos : num(row.qtd_trocas);
      if (troca && semSinalTexto(troca.ultimo_sinal)) fato.trocaSemSinal = true;
      if (manutPorModulo.get(selimp)) fato.manutencaoSemSinal = true;
    }
    if (row.ddmx) fato.temDdmx = true;
  }

  const ddmxAcc = new Map<string, { soma: number; n: number }>();
  for (const row of ddmxRes.rows) {
    const raw = normalizarSetor(String(row.setor ?? ""));
    if (!raw) continue;
    const plano = resolveVpCanonicalFromDdmx(raw, registry);
    const fato = byPlano.get(plano);
    if (!fato) continue;
    if (num(row.linhas) > 0) fato.temDdmx = true;
    const n = num(row.n);
    if (n <= 0) continue;
    const acc = ddmxAcc.get(plano) ?? { soma: 0, n: 0 };
    acc.soma += num(row.soma);
    acc.n += n;
    ddmxAcc.set(plano, acc);
  }
  for (const [plano, acc] of ddmxAcc) {
    const fato = byPlano.get(plano);
    if (fato && acc.n > 0) fato.percentualDdmx = acc.soma / acc.n;
  }

  for (const row of obsRes.rows) {
    const raw = normalizarSetor(String(row.setor ?? ""));
    if (!raw) continue;
    const plano = resolveVpCanonicalFromDdmx(raw, registry);
    const fato = byPlano.get(plano) ?? byPlano.get(raw);
    if (fato && !fato.obsTitulo && row.titulo) fato.obsTitulo = row.titulo;
  }

  const resultado = classificarGargalos([...byPlano.values()]);
  return { periodo: { inicial: inicio, final: fim }, ...resultado };
}

interface DiaRow {
  plano: string;
  data: string;
  status: string | null;
  percentual: number | null;
}

export async function loadGargaloDetalhe(plano: string, inicio: string, fim: string): Promise<GargaloDetalhe> {
  const alvo = normalizarSetor(plano);
  const parsed = parseSetor(alvo);
  const prefixo = parsed?.servico === "VP" ? parsed.sub : alvo;
  const res = await pool.query<DiaRow>(
    `SELECT plano,
            to_char(data_estimada, 'YYYY-MM-DD') AS data,
            status,
            ${pctEncerradoSql} AS percentual
       FROM ipt_report_linhas
      WHERE data_estimada >= $1::date AND data_estimada <= $2::date
        AND upper(regexp_replace(btrim(plano), '\\s+', '', 'g')) LIKE $3 || '%'
      ORDER BY data_estimada`,
    [inicio, fim, prefixo],
  );

  const porData = new Map<string, { encerrado: boolean; naoEnviado: boolean; soma: number; n: number }>();
  for (const row of res.rows) {
    const norm = normalizarSetor(String(row.plano ?? ""));
    if (parsed?.servico === "VP") {
      const rowParsed = parseSetor(norm);
      if (!rowParsed || rowParsed.sub !== parsed.sub || rowParsed.servico !== "VP" || rowParsed.mapa !== parsed.mapa) {
        continue;
      }
    } else if (norm !== alvo) {
      continue;
    }
    const status = String(row.status ?? "");
    if (fold(status).includes("cancel")) continue;
    const atual = porData.get(row.data) ?? { encerrado: false, naoEnviado: false, soma: 0, n: 0 };
    const encerrado = fold(status).includes("encerrad");
    if (encerrado) {
      atual.encerrado = true;
      const pct = numOrNull(row.percentual);
      if (pct != null) {
        atual.soma += pct;
        atual.n += 1;
      }
    } else if (fold(status).includes("nao despach")) {
      atual.naoEnviado = true;
    }
    porData.set(row.data, atual);
  }

  const dias = [...porData.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([data, d]) => ({
      data,
      encerrado: d.encerrado,
      naoEnviado: !d.encerrado && d.naoEnviado,
      percentual: d.n > 0 ? Math.round((d.soma / d.n) * 10) / 10 : null,
    }));

  return { plano: alvo, dias };
}
