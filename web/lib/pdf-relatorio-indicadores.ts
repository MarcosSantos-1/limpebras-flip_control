/**
 * Geração de PDF - Relatório de Indicadores (Explicação dos Cálculos)
 * Documento formal renderizado com jsPDF (não screenshot).
 * Usa o mesmo esquema visual do Relatório de Contestação/Defesa (capa e capa final).
 */

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const MARGIN_TOP = 10; // margem superior (logo e conteúdo)
const MARGIN_LEFT = 15;
const MARGIN_RIGHT = 15;
const MARGIN_BOTTOM = 20;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT; // 180mm - garante 15mm de margem direita
const TEXT_MAX_W = CONTENT_W - 2; // pequena folga para evitar overflow de texto
const COLOR_TITLE = "#00215a";
const COLOR_HEADER_BG = [0, 48, 107] as const;
const COLOR_BAND_TEXT = "#edf4e3";
const ROW_H = 7;
const LINE_H = 6;
const BAND_H = 8;

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace(/^#/, "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function parseLocalDate(str: string): Date | null {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatarValor(valor?: number, casas = 2): string {
  return typeof valor === "number" ? valor.toFixed(casas) : "--";
}

/** Sanitiza texto para PDF: decodifica HTML entities e substitui Unicode problemático por ASCII */
function sanitizarTexto(str: unknown): string {
  if (str == null) return "";
  let s = String(str);
  try {
    const doc = new DOMParser().parseFromString("<!doctype html><body>" + s + "</body>", "text/html");
    s = doc.body?.textContent ?? s;
  } catch {
    s = s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  return s
    .replace(/×/g, "x")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/–/g, "-")
    .replace(/—/g, "-");
}

async function loadAsset(baseUrl: string, path: string): Promise<string> {
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Falha ao carregar: ${url}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fitImageDimensions(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number
): { w: number; h: number } {
  if (imgW <= 0 || imgH <= 0) return { w: maxW, h: maxH };
  const ratio = Math.min(maxW / imgW, maxH / imgH, 1);
  return { w: imgW * ratio, h: imgH * ratio };
}

async function getImageDimensions(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Falha ao carregar imagem"));
    img.src = dataUrl;
  });
}

export interface IfPorSub {
  subprefeitura: string;
  sem_irregularidades: number;
  vistorias_total: number;
  if_percentual: number;
  media_mesclada?: number;
  pontuacao_mesclada?: number;
}

export interface IrdPorRegional {
  subprefeitura: string;
  label: string;
  reclamacoes: number;
  domicilios: number;
  ird_valor: number;
}

export interface IptDetalhes {
  P: number;
  R: number;
  F: number;
  A: number;
  Z: number;
  N: number;
  Qb: number;
  sigma: number;
  C: number;
  cobertura: number;
  qualidade_ajustada: number;
  PF: number;
}

export interface IndicadorDetalhe {
  valor?: number;
  percentual?: number;
  pontuacao?: number;
  total_reclamacoes?: number;
  domicilios?: number;
  total_no_prazo?: number;
  total_fora_prazo?: number;
  total_fiscalizacoes?: number;
  total_sem_irregularidade?: number;
  total_com_irregularidade?: number;
  memoria_calculo?: string;
  filtros_aplicados?: string[];
  if_por_sub?: IfPorSub[];
  ird_por_regional?: IrdPorRegional[];
  ipt_detalhes?: IptDetalhes;
}

export interface ResumoADC {
  pontuacao_total: number;
  percentual_contrato: number;
  desconto: number;
  valor_mensal_contrato: number;
  glosa_real: number;
}

export interface IndicadoresDetalhesResponse {
  periodo: { inicial: string; final: string };
  ird?: IndicadorDetalhe;
  ia?: IndicadorDetalhe;
  if?: IndicadorDetalhe;
  ipt?: IndicadorDetalhe;
  resumo_adc?: ResumoADC;
}

export interface InfoDesconto {
  percentual: number;
  desconto: number;
  explicacao: string;
}

export interface ResumoIndicador {
  nome: string;
  valor: string;
  pontos: string;
}

export interface RelatorioIndicadoresInput {
  periodoInicial: string;
  periodoFinal: string;
  detalhes: IndicadoresDetalhesResponse | null;
  pontuacaoTotal: number;
  infoDesconto: InfoDesconto;
  resumoIndicadores: ResumoIndicador[];
  baseUrl?: string;
}

export async function gerarRelatorioIndicadoresPDF(input: RelatorioIndicadoresInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  }) as import("jspdf").jsPDF;

  const baseUrl = input.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const periodoLabel = (() => {
    const d1 = parseLocalDate(input.periodoInicial);
    const d2 = parseLocalDate(input.periodoFinal);
    const f = (d: Date) => format(d, "dd/MM/yyyy", { locale: ptBR });
    return `${d1 ? f(d1) : input.periodoInicial} a ${d2 ? f(d2) : input.periodoFinal}`;
  })();
  const mesAnoLabel = (() => {
    const d = parseLocalDate(input.periodoFinal) ?? new Date();
    return format(d, "MMMM 'de' yyyy", { locale: ptBR });
  })();

  const detalhes = input.detalhes;

  let logoBase64: string;
  let designCapaBase64: string;
  let designRodapeBase64: string;
  try {
    [logoBase64, designCapaBase64, designRodapeBase64] = await Promise.all([
      loadAsset(baseUrl, "/logotipo.png"),
      loadAsset(baseUrl, "/design_capa.png"),
      loadAsset(baseUrl, "/design_rodape_capafinal.png"),
    ]);
  } catch (e) {
    console.error("Erro ao carregar assets:", e);
    throw new Error("Não foi possível carregar logotipo ou designs. Verifique os arquivos em public/.");
  }

  let logoDimensions: { w: number; h: number };
  try {
    logoDimensions = await getImageDimensions(logoBase64);
  } catch {
    logoDimensions = { w: 200, h: 80 };
  }

  const [r1, g1, b1] = hexToRgb(COLOR_TITLE);
  const [r2, g2, b2] = hexToRgb(COLOR_BAND_TEXT);

  function addLogo(doc: typeof pdf, x: number, y: number, maxW: number, maxH: number) {
    const { w, h } = fitImageDimensions(logoDimensions.w, logoDimensions.h, maxW, maxH);
    doc.addImage(logoBase64, "PNG", x, y, w, h);
  }

  function addCapa(doc: typeof pdf) {
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    addLogo(doc, MARGIN, MARGIN, 100, 60);
    const designW = 100;
    const designExtraTop = 21;
    const designExtraRight = 26;
    doc.addImage(designCapaBase64, "PNG", PAGE_W - designW + designExtraRight, -designExtraTop, designW, designW);
    doc.setTextColor(r1, g1, b1);
    doc.setFontSize(44);
    doc.setFont("helvetica", "bold");
    doc.text("RELATÓRIO DE \n INDICADORES - ADC", PAGE_W / 2, 130, { align: "center" });
    doc.setFontSize(26);
    doc.text(`São Paulo, ${mesAnoLabel}`, PAGE_W / 2, 210, { align: "center" });
  }

  function addCapaFinal(doc: typeof pdf) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    const designW2 = 100;
    const designExtraTop2 = 21;
    const designExtraRight2 = 26;
    doc.addImage(designCapaBase64, "PNG", PAGE_W - designW2 + designExtraRight2, -designExtraTop2, designW2, designW2);
    const { w: lw, h: lh } = fitImageDimensions(logoDimensions.w, logoDimensions.h, 135, 80);
    doc.addImage(logoBase64, "PNG", (PAGE_W - lw) / 2, (PAGE_H - lh) / 2 - 20, lw, lh);
    const rodapeH = 30;
    doc.addImage(designRodapeBase64, "PNG", 0, PAGE_H - rodapeH + 1, PAGE_W, rodapeH);
  }

  type DocContext = { doc: typeof pdf; y: number };
  const maxY = PAGE_H - MARGIN_BOTTOM;

  function checkPage(ctx: DocContext, needSpace: number): void {
    if (ctx.y + needSpace > maxY) {
      ctx.doc.addPage();
      ctx.doc.setFillColor(255, 255, 255);
      ctx.doc.rect(0, 0, PAGE_W, PAGE_H, "F");
      addLogo(ctx.doc, PAGE_W - MARGIN - 30, MARGIN_TOP, 30, 16);
      ctx.y = MARGIN_TOP + 18;
    }
  }

  function addFaixaAzul(doc: typeof pdf, y: number, texto: string): void {
    const bandW = PAGE_W * 0.8;
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(0, y, bandW, BAND_H, "F");
    doc.setTextColor(r2, g2, b2);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(sanitizarTexto(texto), 15, y + 5.2);
  }

  function tituloSecao(ctx: DocContext, texto: string): void {
    checkPage(ctx, BAND_H + 18);
    addFaixaAzul(ctx.doc, ctx.y, texto);
    ctx.y += BAND_H + 10; // Espaço de pelo menos 10mm após a faixa azul
  }

  function paragrafo(ctx: DocContext, texto: string): void {
    checkPage(ctx, 20);
    ctx.doc.setFontSize(10);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setTextColor(0, 0, 0);
    const lines = ctx.doc.splitTextToSize(sanitizarTexto(texto), TEXT_MAX_W);
    ctx.doc.text(lines, MARGIN_LEFT, ctx.y, { align: "left", lineHeightFactor: 1.3 });
    ctx.y += lines.length * LINE_H + 4;
  }

  function subTitulo(ctx: DocContext, texto: string): void {
    checkPage(ctx, 8);
    ctx.doc.setFontSize(11);
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setTextColor(0, 0, 0);
    ctx.doc.text(sanitizarTexto(texto), MARGIN_LEFT, ctx.y);
    ctx.y += 7;
  }

  function textoNormal(ctx: DocContext, texto: string): void {
    checkPage(ctx, 8);
    ctx.doc.setFontSize(10);
    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setTextColor(0, 0, 0);
    const lines = ctx.doc.splitTextToSize(sanitizarTexto(texto), TEXT_MAX_W);
    ctx.doc.text(lines, MARGIN_LEFT, ctx.y, { lineHeightFactor: 1.2 });
    ctx.y += lines.length * LINE_H + 3;
  }

  function addNovaPaginaComCabecalho(ctx: DocContext): void {
    ctx.doc.addPage();
    ctx.doc.setFillColor(255, 255, 255);
    ctx.doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    addLogo(ctx.doc, PAGE_W - MARGIN - 30, MARGIN_TOP, 30, 16);
    ctx.y = MARGIN_TOP + 18;
  }

  // --- Resumo executivo ---
  function addResumoExecutivo(doc: typeof pdf, ctx: DocContext): void {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    addLogo(doc, PAGE_W - MARGIN - 30, MARGIN_TOP, 30, 16);
    ctx.y = MARGIN_TOP + 18;

    tituloSecao(ctx, "Resumo executivo do relatório");
    ctx.y += 5; // Espaço de pelo menos 5mm (~5.2px/mm para 72 dpi, mas abaixo usamos empiricamente)
    paragrafo(ctx, `Visão consolidada dos indicadores do período de ${periodoLabel}.`);
    ctx.y += 4;

    subTitulo(ctx, "Indicadores por tipo");
    const resumo = input.resumoIndicadores;
    const colW = CONTENT_W / 3;
    ctx.y += 6;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 4, CONTENT_W, ROW_H + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Indicador", MARGIN_LEFT + colW / 2, ctx.y + 2, { align: "center" });
    doc.text("Valor", MARGIN_LEFT + colW + colW / 2, ctx.y + 2, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colW * 2 + colW / 2, ctx.y + 2, { align: "center" });
    ctx.y += ROW_H + 4;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    for (let i = 0; i < resumo.length; i++) {
      const r = resumo[i];
      const bg = i % 2 === 0 ? [245, 248, 252] : [255, 255, 255];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 2, CONTENT_W, ROW_H, "F");
      doc.text(sanitizarTexto(r.nome), MARGIN_LEFT + colW / 2, ctx.y + 3, { align: "center" });
      doc.text(sanitizarTexto(r.valor), MARGIN_LEFT + colW + colW / 2, ctx.y + 3, { align: "center" });
      doc.text(sanitizarTexto(`${r.pontos} pts`), MARGIN_LEFT + colW * 2 + colW / 2, ctx.y + 3, { align: "center" });
      ctx.y += ROW_H;
    }

    ctx.y += 8;
    subTitulo(ctx, "Total ADC");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Pontuação total: ${formatarValor(input.pontuacaoTotal, 2)} pts`, MARGIN_LEFT, ctx.y);
    ctx.y += 8;
  }

  // --- C. IRD ---
  function addSecaoIRD(doc: typeof pdf, ctx: DocContext): void {
    addNovaPaginaComCabecalho(ctx);
    tituloSecao(ctx, "IRD - Indicador de Reclamações por Domicílio");
    paragrafo(ctx, "Pontuação máxima: 20 pontos.");
    subTitulo(ctx, "Fórmula");
    paragrafo(ctx, "IRD = (Reclamacoes Escalonadas Procedentes / Numero de Domicilios) x 1000");
    subTitulo(ctx, "Componentes");
    paragrafo(ctx, "Procedentes escalonados: varrição, mutirão, bueiro e cata-bagulho finalizados ou confirmados.");
    paragrafo(ctx, `Domicílios: ${(detalhes?.ird?.domicilios ?? 511093).toLocaleString("pt-BR")} (base IBGE 2024). O fator 1000 expressa o indicador por mil domicílios.`);

    if (detalhes?.ird?.memoria_calculo) {
      subTitulo(ctx, "Memória de cálculo");
      paragrafo(ctx, detalhes.ird.memoria_calculo);
    }

    subTitulo(ctx, "Resultado");
    const ird = detalhes?.ird;
    const formula = ird
      ? `IRD = (${ird.total_reclamacoes ?? 0} / ${(ird.domicilios ?? 0).toLocaleString("pt-BR")}) x 1000 = ${formatarValor(ird.valor, 3)}`
      : "Nenhum SAC escalonado procedente encontrado no período.";
    paragrafo(ctx, formula);
    paragrafo(ctx, `Pontuação: ${formatarValor(ird?.pontuacao, 2)} pts`);

    if (ird?.ird_por_regional && ird.ird_por_regional.length > 0) {
      ctx.y += 4;
      subTitulo(ctx, "IRD por regional");
      const headers = ["Regional", "Recl.", "Domicílios", "IRD"];
      const colW = [45, 25, 35, 30];
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 3, colW.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
      doc.setTextColor(255, 255, 255);
      let x = MARGIN_LEFT;
      headers.forEach((h, i) => {
        doc.text(h, x + colW[i] / 2, ctx.y + 2, { align: "center" });
        x += colW[i];
      });
      ctx.y += ROW_H + 4;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      for (let i = 0; i < ird.ird_por_regional.length; i++) {
        const row = ird.ird_por_regional[i];
        const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(MARGIN_LEFT, ctx.y - 2, colW.reduce((a, b) => a + b, 0), ROW_H - 1, "F");
        x = MARGIN_LEFT;
        doc.text(sanitizarTexto(row.label || row.subprefeitura), x + 3, ctx.y + 2);
        doc.text(String(row.reclamacoes), x + colW[0] + colW[1] / 2, ctx.y + 2, { align: "center" });
        doc.text(row.domicilios.toLocaleString("pt-BR"), x + colW[0] + colW[1] + colW[2] / 2, ctx.y + 2, { align: "center" });
        doc.text(row.ird_valor.toFixed(3), x + colW[0] + colW[1] + colW[2] + colW[3] / 2, ctx.y + 2, { align: "center" });
        ctx.y += ROW_H - 1;
      }
      ctx.y += 6;
    }

    subTitulo(ctx, "Tabela de pontuação IRD");
    const faixasIRD = [
      ["IRD <= 1,0", "20 pts", "Excelente"],
      ["1,0 < IRD <= 2,0", "15 pts", "Bom"],
      ["2,0 < IRD <= 5,0", "10 pts", "Regular"],
      ["5,0 < IRD <= 10,0", "5 pts", "Insatisfatório"],
      ["IRD > 10,0", "0 pts", "Crítico"],
    ];
    const colWird = [55, 35, 85];
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 3, colWird.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Faixa", MARGIN_LEFT + colWird[0] / 2, ctx.y + 2, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colWird[0] + colWird[1] / 2, ctx.y + 2, { align: "center" });
    doc.text("Interpretação", MARGIN_LEFT + colWird[0] + colWird[1] + colWird[2] / 2, ctx.y + 2, { align: "center" });
    ctx.y += ROW_H + 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    faixasIRD.forEach((row, i) => {
      checkPage(ctx, ROW_H);
      const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWird.reduce((a, b) => a + b, 0), ROW_H, "F");
      doc.text(row[0], MARGIN_LEFT + colWird[0] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[1], MARGIN_LEFT + colWird[0] + colWird[1] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[2], MARGIN_LEFT + colWird[0] + colWird[1] + colWird[2] / 2, ctx.y + 3, { align: "center" });
      ctx.y += ROW_H;
    });
    ctx.y += 8;
  }

  // --- D. IA ---
  function addSecaoIA(doc: typeof pdf, ctx: DocContext): void {
    addNovaPaginaComCabecalho(ctx);
    tituloSecao(ctx, "IA - Indicador de Atendimento");
    paragrafo(ctx, "Pontuação máxima: 20 pontos.");
    subTitulo(ctx, "Fórmula");
    paragrafo(ctx, "IA = (No prazo / (No prazo + Fora do prazo)) x 100");
    subTitulo(ctx, "Componentes");
    paragrafo(ctx, "Data de Registro: período selecionado. Classificação: Solicitação (demandantes). Finalizado fora de escopo: NÃO. No prazo = Responsividade_Execução SIM; Fora do prazo = NÃO.");

    if (detalhes?.ia?.memoria_calculo) {
      subTitulo(ctx, "Memória de cálculo");
      paragrafo(ctx, detalhes.ia.memoria_calculo);
    }

    subTitulo(ctx, "Resultado");
    const ia = detalhes?.ia;
    const noPrazo = ia?.total_no_prazo ?? 0;
    const foraPrazo = ia?.total_fora_prazo ?? 0;
    const total = noPrazo + foraPrazo;
    const pct = ia ? formatarValor(ia.percentual ?? ia.valor ?? 0, 2) : "--";
    paragrafo(ctx, total > 0
      ? `No prazo: ${noPrazo} | Fora do prazo: ${foraPrazo} | IA = (${noPrazo} / ${total}) x 100 = ${pct}%`
      : "Nenhum SAC demandante no período.");
    paragrafo(ctx, `Pontuação: ${formatarValor(ia?.pontuacao, 2)} pts`);

    subTitulo(ctx, "Tabela de pontuação IA");
    const faixasIA = [
      ["IA >= 90%", "20 pts", "Quase tudo no prazo"],
      ["80% <= IA < 90%", "16 pts", "Maioria no prazo"],
      ["70% <= IA < 80%", "12 pts", "Parte atrasada"],
      ["60% <= IA < 70%", "8 pts", "Muitos atrasos"],
      ["50% <= IA < 60%", "4 pts", "Critico"],
      ["IA < 50%", "0 pts", "Inaceitavel"],
    ];
    const colWia = [45, 35, 95];
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 3, colWia.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Faixa", MARGIN_LEFT + colWia[0] / 2, ctx.y + 2, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colWia[0] + colWia[1] / 2, ctx.y + 2, { align: "center" });
    doc.text("Interpretação", MARGIN_LEFT + colWia[0] + colWia[1] + colWia[2] / 2, ctx.y + 2, { align: "center" });
    ctx.y += ROW_H + 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    faixasIA.forEach((row, i) => {
      checkPage(ctx, ROW_H);
      const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWia.reduce((a, b) => a + b, 0), ROW_H, "F");
      doc.text(row[0], MARGIN_LEFT + colWia[0] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[1], MARGIN_LEFT + colWia[0] + colWia[1] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[2], MARGIN_LEFT + colWia[0] + colWia[1] + colWia[2] / 2, ctx.y + 3, { align: "center" });
      ctx.y += ROW_H;
    });
    ctx.y += 8;
  }

  // --- E. IF ---
  function addSecaoIF(doc: typeof pdf, ctx: DocContext): void {
    addNovaPaginaComCabecalho(ctx);
    tituloSecao(ctx, "IF - Indicador de Fiscalização");
    paragrafo(ctx, "Pontuação máxima: 20 pontos.");
    subTitulo(ctx, "Fórmula");
    paragrafo(ctx, "IF por sub = (sem irregularidades / total BFS escalonados) x 100. \nMedia dos 4 percentuais (JT, CV, ST, MG) = IF final.");
    subTitulo(ctx, "Excluídos do cálculo");
    paragrafo(ctx, "Coleta e transporte de entulho; Fornecimento de papeleiras; Remoção de animais mortos não identificados.");

    if (detalhes?.if?.memoria_calculo) {
      subTitulo(ctx, "Memória de cálculo");
      paragrafo(ctx, detalhes.if.memoria_calculo);
    }

    const ifPorSub = detalhes?.if?.if_por_sub ?? [];
    if (ifPorSub.length > 0) {
      subTitulo(ctx, "IF por subprefeitura");
      const headers = ["Sub", "Sem irreg.", "Vistorias", "IF (%)", "Média", "Pontuação"];
      const colW = [28, 28, 28, 28, 28, 30];
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 3, colW.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
      doc.setTextColor(255, 255, 255);
      let x = MARGIN_LEFT;
      headers.forEach((h, i) => {
        doc.text(h, x + colW[i] / 2, ctx.y + 2, { align: "center" });
        x += colW[i];
      });
      ctx.y += ROW_H + 4;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      const tabelaHif = ifPorSub.length * (ROW_H - 1);
      const mediaVal = ifPorSub[0]?.media_mesclada != null ? `${ifPorSub[0].media_mesclada.toFixed(1)}%` : "--";
      const pontVal = ifPorSub[0]?.pontuacao_mesclada ?? detalhes?.if?.pontuacao ?? "--";
      const baseX = MARGIN_LEFT + colW[0] + colW[1] + colW[2] + colW[3];
      doc.setFillColor(248, 250, 252);
      doc.rect(baseX, ctx.y - 2, colW[4], tabelaHif, "F");
      doc.rect(baseX + colW[4], ctx.y - 2, colW[5], tabelaHif, "F");
      doc.text(mediaVal, baseX + colW[4] / 2, ctx.y + tabelaHif / 2, { align: "center", baseline: "middle" });
      doc.text(`${pontVal} pts`, baseX + colW[4] + colW[5] / 2, ctx.y + tabelaHif / 2, { align: "center", baseline: "middle" });
      for (let i = 0; i < ifPorSub.length; i++) {
        const row = ifPorSub[i];
        const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(MARGIN_LEFT, ctx.y - 2, colW[0] + colW[1] + colW[2] + colW[3], ROW_H - 1, "F");
        x = MARGIN_LEFT;
        doc.text(sanitizarTexto(row.subprefeitura), x + 3, ctx.y + 2);
        doc.text(String(row.sem_irregularidades), x + colW[0] + colW[1] / 2, ctx.y + 2, { align: "center" });
        doc.text(String(row.vistorias_total), x + colW[0] + colW[1] + colW[2] / 2, ctx.y + 2, { align: "center" });
        doc.text(`${row.if_percentual.toFixed(1)}%`, x + colW[0] + colW[1] + colW[2] + colW[3] / 2, ctx.y + 2, { align: "center" });
        ctx.y += ROW_H - 1;
      }
      ctx.y += 6;
    }

    subTitulo(ctx, "Resultado");
    const iff = detalhes?.if;
    const pctIf = formatarValor(iff?.percentual ?? ((iff?.valor ?? 0) / 10), 2);
    paragrafo(ctx, `Total BFS: ${iff?.total_fiscalizacoes ?? "--"} | Sem irregularidade: ${iff?.total_sem_irregularidade ?? "--"} | IF = ${pctIf}%`);
    paragrafo(ctx, `Pontuação: ${formatarValor(iff?.pontuacao, 2)} pts`);

    subTitulo(ctx, "Tabela de pontuação IF");
    const faixasIF = [
      ["IF >= 90%", "20 pts"], ["80% <= IF < 90%", "18 pts"], ["70% <= IF < 80%", "16 pts"],
      ["60% <= IF < 70%", "14 pts"], ["50% <= IF < 60%", "12 pts"], ["40% <= IF < 50%", "10 pts"],
      ["30% <= IF < 40%", "8 pts"], ["20% <= IF < 30%", "6 pts"], ["10% <= IF < 20%", "4 pts"], ["IF < 10%", "0 pts"],
    ];
    const colWif = [60, 40];
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 3, colWif.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Faixa", MARGIN_LEFT + colWif[0] / 2, ctx.y + 2, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colWif[0] + colWif[1] / 2, ctx.y + 2, { align: "center" });
    ctx.y += ROW_H + 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    faixasIF.forEach((row, i) => {
      checkPage(ctx, ROW_H);
      const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWif.reduce((a, b) => a + b, 0), ROW_H, "F");
      doc.text(row[0], MARGIN_LEFT + colWif[0] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[1], MARGIN_LEFT + colWif[0] + colWif[1] / 2, ctx.y + 3, { align: "center" });
      ctx.y += ROW_H;
    });
    ctx.y += 8;
  }

  // --- F. IPT ---
  function addSecaoIPT(doc: typeof pdf, ctx: DocContext): void {
    addNovaPaginaComCabecalho(ctx);
    tituloSecao(ctx, "IPT - Indicador de Execução dos Planos de Trabalho");
    paragrafo(ctx, "Pontuação máxima: 40 pontos. Algoritmo oficial SELIMP.");
    subTitulo(ctx, "Fórmula (SELIMP)");
    paragrafo(ctx, "PF = 0,7 x min(Q + min(sigma, 0,08), 1) + 0,3 x min(A/C, 1) | C = PxR/F, Q = (1/N)x soma Qi, N = A - Z");

    const iptDet = detalhes?.ipt?.ipt_detalhes;
    if (iptDet) {
      subTitulo(ctx, "Valores utilizados");
      const vars = [
        ["P", String(iptDet.P), "ordens planejadas"],
        ["R", String(iptDet.R), "rastreadores"],
        ["F", String(iptDet.F), "frota"],
        ["A", String(iptDet.A), "ordens atribuídas"],
        ["Z", String(iptDet.Z), "zeradas"],
        ["N", String(iptDet.N), "com conclusão >0%"],
        ["Q", `${(iptDet.Qb * 100).toFixed(2)}%`, "qualidade bruta"],
        ["sigma", `${(iptDet.sigma * 100).toFixed(2)}%`, "desvio padrao"],
        ["Cobertura", `${(iptDet.cobertura * 100).toFixed(2)}%`, "min(A/C, 1)"],
        ["PF", `${(iptDet.PF * 100).toFixed(2)}%`, "Percentual Final"],
      ];
      const colWipt = [35, 35, 105];
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 3, colWipt.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.text("Variável", MARGIN_LEFT + colWipt[0] / 2, ctx.y + 2, { align: "center" });
      doc.text("Valor", MARGIN_LEFT + colWipt[0] + colWipt[1] / 2, ctx.y + 2, { align: "center" });
      doc.text("Descrição", MARGIN_LEFT + colWipt[0] + colWipt[1] + colWipt[2] / 2, ctx.y + 2, { align: "center" });
      ctx.y += ROW_H + 4;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      vars.forEach((v, i) => {
        checkPage(ctx, ROW_H);
        const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
        doc.setFillColor(bg[0], bg[1], bg[2]);
        doc.rect(MARGIN_LEFT, ctx.y - 2, colWipt.reduce((a, b) => a + b, 0), ROW_H, "F");
        doc.text(v[0], MARGIN_LEFT + colWipt[0] / 2, ctx.y + 3, { align: "center" });
        doc.text(v[1], MARGIN_LEFT + colWipt[0] + colWipt[1] / 2, ctx.y + 3, { align: "center" });
        doc.text(v[2], MARGIN_LEFT + colWipt[0] + colWipt[1] + colWipt[2] / 2, ctx.y + 3, { align: "center" });
        ctx.y += ROW_H;
      });
      ctx.y += 6;
    }

    subTitulo(ctx, "Resultado");
    const ipt = detalhes?.ipt;
    paragrafo(ctx, ipt
      ? `PF (IPT) = ${formatarValor(ipt.valor, 2)}%  |  Pontuação: ${formatarValor(ipt.pontuacao, 2)} pts`
      : "IPT não informado para este período.");

    subTitulo(ctx, "Tabela de pontuação IPT");
    const faixasIPT = [
      ["IPT >= 90%", "40 pts"], ["80% <= IPT < 90%", "38 pts"], ["70% <= IPT < 80%", "36 pts"],
      ["60% <= IPT < 70%", "32 pts"], ["50% <= IPT < 60%", "28 pts"], ["40% <= IPT < 50%", "24 pts"],
      ["30% <= IPT < 40%", "20 pts"], ["20% <= IPT < 30%", "16 pts"], ["10% <= IPT < 20%", "12 pts"], ["IPT < 10%", "0 pts"],
    ];
    const colWiptFaixa = [60, 40];
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 3, colWiptFaixa.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Faixa", MARGIN_LEFT + colWiptFaixa[0] / 2, ctx.y + 2, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colWiptFaixa[0] + colWiptFaixa[1] / 2, ctx.y + 2, { align: "center" });
    ctx.y += ROW_H + 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    faixasIPT.forEach((row, i) => {
      checkPage(ctx, ROW_H);
      const bg = i % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWiptFaixa.reduce((a, b) => a + b, 0), ROW_H, "F");
      doc.text(row[0], MARGIN_LEFT + colWiptFaixa[0] / 2, ctx.y + 3, { align: "center" });
      doc.text(row[1], MARGIN_LEFT + colWiptFaixa[0] + colWiptFaixa[1] / 2, ctx.y + 3, { align: "center" });
      ctx.y += ROW_H;
    });
    ctx.y += 8;
  }

  // --- Resumo dos indicadores (página estilizada) ---
  const COR_VERDE = [34, 197, 94] as const;
  const COR_AMARELO = [234, 179, 8] as const;
  const COR_VIOLETA = [139, 92, 246] as const;
  const COR_EMERALD = [16, 185, 129] as const;
  const COR_BLUE = [59, 130, 246] as const;
  const COR_AMBER = [245, 158, 11] as const;
  const COR_FUCHSIA = [217, 70, 239] as const;

  function addResumoIndicadores(doc: typeof pdf, ctx: DocContext): void {
    addNovaPaginaComCabecalho(ctx);
    tituloSecao(ctx, "Resumo dos indicadores");
    doc.setFont("helvetica", "bold");
    paragrafo(ctx, `Período analisado: ${periodoLabel}.`);
    doc.setFont("helvetica", "normal");

    const coresPorIndicador = [COR_EMERALD, COR_BLUE, COR_AMBER, COR_FUCHSIA];
    const colWRes = [50, 55, 50];
    const resumo = input.resumoIndicadores;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(COLOR_HEADER_BG[0], COLOR_HEADER_BG[1], COLOR_HEADER_BG[2]);
    doc.rect(MARGIN_LEFT, ctx.y - 3, colWRes.reduce((a, b) => a + b, 0), ROW_H + 3, "F");
    doc.setTextColor(255, 255, 255);
    doc.text("Indicador", MARGIN_LEFT + colWRes[0] / 2, ctx.y + 3, { align: "center" });
    doc.text("Valor", MARGIN_LEFT + colWRes[0] + colWRes[1] / 2, ctx.y + 3, { align: "center" });
    doc.text("Pontuação", MARGIN_LEFT + colWRes[0] + colWRes[1] + colWRes[2] / 2, ctx.y + 3, { align: "center" });
    ctx.y += ROW_H + 5;

    resumo.forEach((r, i) => {
      const [cr, cg, cb] = coresPorIndicador[i] ?? [200, 200, 200];
      doc.setFillColor(cr, cg, cb);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWRes[0], ROW_H + 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(sanitizarTexto(r.nome), MARGIN_LEFT + colWRes[0] / 2, ctx.y + 4, { align: "center" });
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(cr, cg, cb);
      doc.setLineWidth(0.3);
      doc.rect(MARGIN_LEFT + colWRes[0], ctx.y - 2, colWRes[1] + colWRes[2], ROW_H + 2, "FD");
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "normal");
      doc.text(sanitizarTexto(r.valor), MARGIN_LEFT + colWRes[0] + colWRes[1] / 2, ctx.y + 4, { align: "center" });
      doc.text(sanitizarTexto(`${r.pontos} pts`), MARGIN_LEFT + colWRes[0] + colWRes[1] + colWRes[2] / 2, ctx.y + 4, { align: "center" });
      doc.setFont("helvetica", "bold");
      ctx.y += ROW_H + 4;
    });

    ctx.y += 6;
    checkPage(ctx, 18);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Total ADC (IRD + IA + IF + IPT):", MARGIN_LEFT, ctx.y);
    doc.text(`${formatarValor(input.pontuacaoTotal, 2)} pts`, MARGIN_LEFT + 95, ctx.y);
    ctx.y += 15; // espaçamento antes do status/desconto

    const tableW = colWRes.reduce((a, b) => a + b, 0);
    const boxTotalW = tableW;
    const temDesconto = input.infoDesconto.desconto > 0;
    const corDesconto = temDesconto ? COR_AMARELO : COR_VERDE;
    doc.setFillColor(corDesconto[0], corDesconto[1], corDesconto[2]);
    doc.roundedRect(MARGIN_LEFT, ctx.y - 2, boxTotalW, 18, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.text(temDesconto ? "Desconto aplicado" : "Sem desconto", MARGIN_LEFT + 13, ctx.y + 5);
    if (temDesconto) {
      doc.text(`-${formatarValor(input.infoDesconto.desconto, 2)}%`, MARGIN_LEFT + boxTotalW - 15, ctx.y + 5, { align: "right" });
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const linesDesc = doc.splitTextToSize(sanitizarTexto(input.infoDesconto.explicacao), boxTotalW - 20);
    doc.text(linesDesc, MARGIN_LEFT + 10, ctx.y + 11);
    ctx.y += 20;

    // Adiciona espaçamento extra entre o card de status "Sem desconto" e o texto "Percentual contratual"
    ctx.y += 8;

    subTitulo(ctx, "Percentual contratual");
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(`Valor a receber: ${formatarValor(input.infoDesconto.percentual, 2)}% do contrato`, MARGIN_LEFT, ctx.y);
    ctx.y += 10;

    const resumoAdc = input.detalhes?.resumo_adc;
    if (resumoAdc && typeof resumoAdc.valor_mensal_contrato === "number") {
      addFaixaAzul(doc, ctx.y, "Resumo financeiro");
      ctx.y += BAND_H + 6;

      const valorReceber = (resumoAdc.valor_mensal_contrato ?? 0) - (resumoAdc.glosa_real ?? 0);
      const colWFin = [70, 85];
      doc.setFontSize(10);
      doc.setFillColor(245, 248, 252);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWFin.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
      doc.setTextColor(0, 0, 0);
      doc.text("Valor mensal contrato", MARGIN_LEFT + 8, ctx.y + 4);
      doc.text(`R$ ${(resumoAdc.valor_mensal_contrato ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MARGIN_LEFT + colWFin[0] + colWFin[1] / 2, ctx.y + 4, { align: "center" });
      ctx.y += ROW_H + 4;

      doc.setFillColor(254, 252, 232);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWFin.reduce((a, b) => a + b, 0), ROW_H + 2, "F");
      doc.text("Glosa (desconto)", MARGIN_LEFT + 8, ctx.y + 4);
      doc.text(`R$ ${(resumoAdc.glosa_real ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MARGIN_LEFT + colWFin[0] + colWFin[1] / 2, ctx.y + 4, { align: "center" });
      ctx.y += ROW_H + 4;

      doc.setFillColor(220, 252, 231);
      doc.rect(MARGIN_LEFT, ctx.y - 2, colWFin.reduce((a, b) => a + b, 0), ROW_H + 3, "F");
      doc.setFont("helvetica", "bold");
      doc.text("Valor a receber", MARGIN_LEFT + 8, ctx.y + 5);
      doc.text(`R$ ${valorReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, MARGIN_LEFT + colWFin[0] + colWFin[1] / 2, ctx.y + 5, { align: "center" });
      ctx.y += ROW_H + 8;
    }
  }

  // ---- Execução ----
  addCapa(pdf);
  const ctx: DocContext = { doc: pdf, y: MARGIN_TOP + 18 };
  addResumoExecutivo(pdf, ctx);
  addSecaoIRD(pdf, ctx);
  addSecaoIA(pdf, ctx);
  addSecaoIF(pdf, ctx);
  addSecaoIPT(pdf, ctx);
  addResumoIndicadores(pdf, ctx);
  addCapaFinal(pdf);

  const mesNome = format(parseLocalDate(input.periodoFinal) ?? new Date(), "MMMM", { locale: ptBR });
  const mesCapitalizado = mesNome.charAt(0).toUpperCase() + mesNome.slice(1);
  pdf.save(`Relatório de Indicadores Limpebras - ${mesCapitalizado}.pdf`);
}
