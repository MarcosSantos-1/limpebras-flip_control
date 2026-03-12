/**
 * Geração de PDF - Relatório de Contestação IF
 * Usa jsPDF (mesma tech de indicadores/explicacao)
 * Formato A4 retrato, margens em mm.
 */

import type { jsPDF } from "jspdf";
import { format, isValid } from "date-fns";
import { ptBR } from "date-fns/locale";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const MARGIN_LEFT = 15;
const MARGIN_RIGHT = 20;
const MARGIN_BOTTOM = 15;
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;
const COLOR_TITLE = "#00215a";
const COLOR_BAND = "#00306b";
const COLOR_BAND_TEXT = "#edf4e3";
const COLOR_DATE_ALERT = "#ff5757";

export interface IfPorSub {
  subprefeitura: string;
  sem_irregularidades: number;
  vistorias_total: number;
  if_percentual: number;
  media_mesclada?: number;
  pontuacao_mesclada?: number;
}

export interface CncDetalhe {
  numero_cnc?: string;
  data_execucao?: string | null;
  data_sincronizacao?: string | null;
  setor?: string;
  fiscal_contratada?: string;
}

export interface BFSContestar {
  id: string;
  bfs: string;
  subprefeitura: string;
  setor?: string;
  setor_resolvido?: string | null;
  cronograma_resolvido?: string | null;
  tipo_servico?: string;
  data_abertura: string;
  endereco?: string;
  fiscal?: string;
  cnc_detalhes?: CncDetalhe[];
}

export interface ItemFiscalizadoBfs {
  item: string;
  proatividade: string;
  turno?: string;
  observacoes: string;
}

export interface FotosContestarBfs {
  agente_sub: string[];
  itens_fiscalizados?: ItemFiscalizadoBfs[];
  nosso_agente: string[];
  justificativa?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace(/^#/, "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Pontuação do IF conforme faixas oficiais (0-20 pts) */
function pontuacaoFromIF(percentual: number): number {
  if (percentual >= 90) return 20;
  if (percentual >= 80) return 18;
  if (percentual >= 70) return 16;
  if (percentual >= 60) return 14;
  if (percentual >= 50) return 12;
  if (percentual >= 40) return 10;
  if (percentual >= 30) return 8;
  if (percentual >= 20) return 6;
  if (percentual >= 10) return 4;
  return 0;
}

/** Parse yyyy-MM-dd como data local (evita shift UTC) */
function parseLocalDate(str: string): Date | null {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function safeFormatDate(d: string | Date | undefined): string {
  if (!d) return "--";
  let date: Date | null = null;
  if (typeof d === "string") {
    date = parseLocalDate(d) ?? new Date(d);
  } else {
    date = d;
  }
  return date && isValid(date) ? format(date, "dd/MM/yyyy", { locale: ptBR }) : "--";
}

function safeFormatDateTime(d: string | Date | undefined): string {
  if (!d) return "--";
  let date: Date | null = null;
  if (typeof d === "string") {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    } else {
      date = new Date(d);
    }
  } else {
    date = d;
  }
  if (!date || !isValid(date)) return "--";
  const dStr = format(date, "dd/MM/yyyy - HH:mm", { locale: ptBR });
  const weekday = format(date, "EEEE", { locale: ptBR });
  return `${dStr} (${weekday.charAt(0).toUpperCase() + weekday.slice(1)})`;
}

function isFirebaseStorageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "firebasestorage.googleapis.com" ||
      u.hostname.endsWith(".firebasestorage.app")
    );
  } catch {
    return false;
  }
}

async function loadImageAsBase64(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const isFirebase = url.startsWith("http") && isFirebaseStorageUrl(url);
  const proxyUrl =
    isFirebase && typeof window !== "undefined"
      ? `${window.location.origin}/api/proxy-image?url=${encodeURIComponent(url)}`
      : url;
  const res = await fetch(proxyUrl, { mode: "cors" });
  if (!res.ok) throw new Error(`Falha ao carregar imagem: ${url} (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getImageFormat(dataUrl: string): "PNG" | "JPEG" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "PNG"; // WEBP convertido para PNG
  return "PNG";
}

/** Converte WEBP para PNG via canvas (jsPDF não suporta WEBP bem) */
async function ensurePngOrJpeg(dataUrl: string): Promise<string> {
  if (
    dataUrl.startsWith("data:image/png") ||
    dataUrl.startsWith("data:image/jpeg") ||
    dataUrl.startsWith("data:image/jpg")
  ) {
    return dataUrl;
  }
  if (dataUrl.startsWith("data:image/webp")) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas não disponível"));
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  return dataUrl;
}

async function loadAsset(baseUrl: string, path: string): Promise<string> {
  const url = path.startsWith("http") ? path : `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;
  return loadImageAsBase64(url);
}

/** Retorna dimensões da imagem preservando aspect ratio para caber em maxW x maxH */
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

const FOTO_MAX_SIZE = 75;

export interface RelatorioContestacaoInput {
  periodoInicial: string;
  periodoFinal: string;
  contratada?: string;
  contratoNumero?: string;
  bfssContestar: BFSContestar[];
  fotosMap: Record<string, FotosContestarBfs>;
  ifPorSub?: IfPorSub[];
  baseUrl?: string;
}

export async function gerarRelatorioContestacaoPDF(
  input: RelatorioContestacaoInput
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  }) as jsPDF & { addImage: (img: string, fmt: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string, rotation?: number) => void };

  const baseUrl = input.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "");
  const periodoLabel = `${safeFormatDate(input.periodoInicial)} - ${safeFormatDate(input.periodoFinal)}`;
  const mesAnoLabel = (() => {
    const d = parseLocalDate(input.periodoFinal) ?? new Date();
    return format(d, "MMMM 'de' yyyy", { locale: ptBR });
  })();
  const dataEmissao = format(new Date(), "dd/MM/yyyy", { locale: ptBR });

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

  function addLogo(doc: typeof pdf, x: number, y: number, maxW: number, maxH: number) {
    const { w, h } = fitImageDimensions(logoDimensions.w, logoDimensions.h, maxW, maxH);
    doc.addImage(logoBase64, "PNG", x, y, w, h);
  }

  const [r1, g1, b1] = hexToRgb(COLOR_TITLE);
  const [r2, g2, b2] = hexToRgb(COLOR_BAND_TEXT);
  const [r3, g3, b3] = hexToRgb(COLOR_DATE_ALERT);

  function addCapa(doc: typeof pdf, subprefeitura?: string, isFirst = false) {
    if (!isFirst) doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    addLogo(doc, MARGIN, MARGIN, 100, 60);

    const designW = 100;
    const designH = 100;
    const designExtraTop = 21;
    const designExtraRight = 26;
    doc.addImage(designCapaBase64, "PNG", PAGE_W - designW + designExtraRight, -designExtraTop, designW, designH);

    doc.setTextColor(r1, g1, b1);
    doc.setFontSize(50);
    doc.setFont("helvetica", "bold");

    // Adiciona espaço extra se for exibir subprefeitura
    let tituloY = subprefeitura ? 120 : 140;
    doc.text("RELATÓRIO DE \n CONTESTAÇÃO - IF", PAGE_W / 2, tituloY, { align: "center" });

    if (subprefeitura) {
      doc.setFontSize(36);
      // Espaço extra entre o título e a subprefeitura
      const subprefeituraY = tituloY + 80;
      doc.text(subprefeitura, PAGE_W / 2, subprefeituraY, { align: "center" });
      doc.setFontSize(22);
      doc.text(`São Paulo, ${mesAnoLabel}`, PAGE_W / 2, subprefeituraY + 17, { align: "center" });
    } else {
      doc.setFontSize(26);
      doc.text(`São Paulo, ${mesAnoLabel}`, PAGE_W / 2, tituloY + 80, { align: "center" });
    }
  }

  function addContracapa(doc: typeof pdf) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    addLogo(doc, MARGIN, MARGIN, 80, 40);
    const tituloY = 70; // mais espaço entre logo e título

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("RELATÓRIO DE CONTESTAÇÃO – IF", MARGIN, tituloY);

    doc.setFontSize(14);

    // Contratada
    doc.setFont("helvetica", "bold");
    doc.text("Contratada:", MARGIN, 80);
    doc.setFont("helvetica", "normal");
    doc.text(`${input.contratada ?? "Limpebras Engenharia Ambiental"}`, MARGIN + 34, 80);

    // Termo de Contrato
    doc.setFont("helvetica", "bold");
    doc.text("Termo de Contrato n° 40 / SMSUB / COGEL / 2025", MARGIN, 87);

    // Período Avaliado
    doc.setFont("helvetica", "bold");
    doc.text("Período Avaliado", MARGIN, 94);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${periodoLabel}`, MARGIN + 42, 94);

    // Data de emissão
    doc.setFont("helvetica", "bold");
    doc.text("Data de emissão", MARGIN, 101);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${dataEmissao}`, MARGIN + 40, 101);

    doc.setFontSize(14);

    // Define uma margem direita de pelo menos 20mm
    const MARGIN_DIREITA_MINIMA = 20; // mm
    const larguraTexto = PAGE_W - MARGIN - MARGIN_DIREITA_MINIMA;

    const paragrafo =
      `O presente relatório tem como objetivo contestar as BFS classificadas como irregulares no cálculo do IF referente ao período de ${periodoLabel}, apresentando justificativas técnicas individualizadas e demonstrando o impacto percentual na Subprefeitura.`;
    const lines = doc.splitTextToSize(paragrafo, larguraTexto);

    doc.text(lines, MARGIN, 115, { align: "justify", maxWidth: larguraTexto, lineHeightFactor: 1.4 });
  }

  function addTabelaIf(doc: typeof pdf) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    addLogo(doc, PAGE_W - MARGIN - 40, MARGIN, 40, 25);

    doc.setTextColor(r1, g1, b1);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Comparativo do IF antes x após os ajustes", MARGIN, 50);

    // Espaço de aproximadamente 15mm (equivalente a ~15 pontos na vertical)
    let tabelaTituloY = 65; // 50 + 15 = 65
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    const soMes = (() => {
      if (!mesAnoLabel) return "";
      // Espera mesAnoLabel no formato "Março/2026" ou "Março de 2026"
      const match = mesAnoLabel.match(/^([^\s\/]+)/);
      return match ? match[1] : mesAnoLabel;
    })();
    const subtituloTabela = `IF (Índice de Fiscalização) - ${soMes} -  ${periodoLabel}`;
    doc.text(subtituloTabela, PAGE_W / 2, tabelaTituloY, { align: "center" });

    const rows = input.ifPorSub ?? [];

    // Define uma margem direita de pelo menos 20mm
    const MARGIN_DIREITA_MINIMA = 20; // mm
    const TABELA_DISPONIVEL_W = PAGE_W - MARGIN - MARGIN_DIREITA_MINIMA;

    const ROW_H = 8;
    const colW = [32, 38, 38, 28, 42]; // SUB menor, outras maiores, Média/Ponto. centralizado
    const headers = ["SUB", "Sem irregularidades", "Vistorias Total", "IF", "Média (Pontuação)"];
    const colWSum = colW.reduce((a,b)=>a+b,0);
    let scale = TABELA_DISPONIVEL_W / colWSum;
    let adjColW = colW.map(w => Math.floor(w * scale));

    const tabelaW = adjColW.reduce((a,b)=>a+b,0);
    let tabelaY = 75; // espaço entre subtítulo e tabela
    if (rows.length > 0) {
      let y = tabelaY;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255,255,255);
      let x = MARGIN;
      doc.setFillColor(0, 48, 107);
      const tabelaW = adjColW.reduce((a,b)=>a+b,0);
      doc.rect(x, y-4, tabelaW, ROW_H + 2, "F");
      headers.forEach((h, i) => {
        doc.text(h, x + adjColW[i]/2, y+2, { align: "center", baseline: "middle" });
        x += adjColW[i];
      });
      y += ROW_H + 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const mediaPontuacaoVal = (() => {
        const r = rows[0];
        let s = '';
        if (r?.media_mesclada != null) s += `${r.media_mesclada.toFixed(1)}%`;
        if (r?.pontuacao_mesclada != null) {
          if (s) s += '  ';
          s += `(${r.pontuacao_mesclada} pts)`;
        }
        return s || "--";
      })();

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        x = MARGIN;
        const corFundoLinha = idx % 2 === 0 ? [240,245,252] : [255,255,255];
        doc.setFillColor(corFundoLinha[0], corFundoLinha[1], corFundoLinha[2]);
        doc.rect(x, y-2, tabelaW - adjColW[4], ROW_H, 'F');
        doc.setTextColor(0,0,0);

        const cells = [
          row.subprefeitura ?? "--",
          String(row.sem_irregularidades ?? 0),
          String(row.vistorias_total ?? 0),
          `${(row.if_percentual ?? 0).toFixed(1)}%`,
        ];
        let currX = MARGIN;
        for (let i = 0; i < 4; i++) {
          const align: "left" | "center" = "center";
          const isBold = i === 0 || i === 3;
          if (isBold) doc.setFont("helvetica", "bold");
          doc.text(
            cells[i],
            currX + adjColW[i]/2,
            y + ROW_H/2,
            { align, baseline: "middle" }
          );
          if (isBold) doc.setFont("helvetica", "normal");
          currX += adjColW[i];
        }
        if (idx === 0) {
          doc.setFillColor(245, 248, 252);
          const mediaCellY = tabelaY + 4;
          doc.rect(currX, mediaCellY, adjColW[4], rows.length * ROW_H, "F");
          doc.setTextColor(0,0,0);
          doc.setFont("helvetica", "bold");
          doc.text(mediaPontuacaoVal, currX + adjColW[4]/2, mediaCellY + (rows.length * ROW_H) / 2, { align: "center", baseline: "middle" });
          doc.setFont("helvetica", "normal");
        }
        y += ROW_H;
      }

      const tabelaH = ROW_H + 2 + rows.length * ROW_H + 6;
      doc.setDrawColor(0,48,107);
      doc.setLineWidth(0.4);
      doc.rect(MARGIN, tabelaY-4, tabelaW, tabelaH);

      let accW = MARGIN;
      for (let i = 1; i < adjColW.length; i++) {
        accW += adjColW[i-1];
        doc.line(accW, tabelaY-4, accW, tabelaY-4 + tabelaH);
      }
      doc.line(MARGIN, tabelaY+4, MARGIN+tabelaW, tabelaY+4);

      // --- Tabela IF Ajustado (desconsiderando BFS contestados) ---
      // ifPorSub usa siglas (ST, CV, JT, MG); bfssContestar usa nomes completos (Santana/Tucuruvi, etc)
      const normalizeSub = (s: string) =>
        (s ?? "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[\s\/\-_]+/g, "");
      const FULL_TO_SIGLA: Record<string, string> = {
        santanatucuruvi: "ST",
        casaverdecachoeirinha: "CV",
        casaverdelimaocachoeirinha: "CV", // variante com Limão
        jacanatremembe: "JT",
        vilamariavilaguilherme: "MG",
      };
      const contestedPorSigla = new Map<string, number>();
      for (const b of input.bfssContestar) {
        const key = normalizeSub(b.subprefeitura ?? "");
        const sigla = FULL_TO_SIGLA[key] ?? key.slice(0, 2).toUpperCase();
        contestedPorSigla.set(sigla, (contestedPorSigla.get(sigla) ?? 0) + 1);
      }
      const getContested = (sub: string) => {
        const k = (sub ?? "").trim();
        return contestedPorSigla.get(k) ?? contestedPorSigla.get(k.toUpperCase()) ?? 0;
      };
      const rowsAjustado = rows.map((row) => {
        const contested = getContested(row.subprefeitura ?? "");
        const vistAjustado = Math.max(0, (row.vistorias_total ?? 0) - contested);
        const ifAjustado = vistAjustado > 0
          ? ((row.sem_irregularidades ?? 0) / vistAjustado) * 100
          : 0;
        return {
          subprefeitura: row.subprefeitura ?? "--",
          sem_irregularidades: row.sem_irregularidades ?? 0,
          vistorias_total: vistAjustado,
          if_percentual: ifAjustado,
        };
      });
      const mediaAjustada = rowsAjustado.length > 0
        ? rowsAjustado.reduce((s, r) => s + r.if_percentual, 0) / rowsAjustado.length
        : 0;
      const pontuacaoAjustada = pontuacaoFromIF(mediaAjustada);

      let yAjust = y + 15; // espaço entre tabelas
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text("IF ajustado (desconsiderando BFS em contestação)", PAGE_W / 2, yAjust, { align: "center" });
      yAjust += 10;

      let tabelaYAjust = yAjust;
      let yRow = tabelaYAjust;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.setFillColor(0, 92, 46); // verde escuro #005c2e
      doc.rect(MARGIN, yRow - 4, tabelaW, ROW_H + 2, "F");
      let xA = MARGIN;
      headers.forEach((h, i) => {
        doc.text(h, xA + adjColW[i] / 2, yRow + 2, { align: "center", baseline: "middle" });
        xA += adjColW[i];
      });
      yRow += ROW_H + 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      const mediaPontuacaoAjustVal = `${mediaAjustada.toFixed(1)}%  (${pontuacaoAjustada} pts)`;

      for (let idx = 0; idx < rowsAjustado.length; idx++) {
        const row = rowsAjustado[idx];
        xA = MARGIN;
        const corFundo = idx % 2 === 0 ? [240, 245, 252] : [255, 255, 255];
        doc.setFillColor(corFundo[0], corFundo[1], corFundo[2]);
        doc.rect(xA, yRow - 2, tabelaW - adjColW[4], ROW_H, "F");
        doc.setTextColor(0, 0, 0);

        const cellsA = [
          row.subprefeitura,
          String(row.sem_irregularidades),
          String(row.vistorias_total),
          `${row.if_percentual.toFixed(1)}%`,
        ];
        let currXA = MARGIN;
        for (let i = 0; i < 4; i++) {
          const isBold = i === 0 || i === 3;
          if (isBold) doc.setFont("helvetica", "bold");
          if (i === 3) doc.setTextColor(200, 0, 0); // vermelho para IF
          doc.text(
            cellsA[i],
            currXA + adjColW[i] / 2,
            yRow + ROW_H / 2,
            { align: "center" as const, baseline: "middle" }
          );
          if (i === 3) doc.setTextColor(0, 0, 0);
          if (isBold) doc.setFont("helvetica", "normal");
          currXA += adjColW[i];
        }
        if (idx === 0) {
          doc.setFillColor(245, 248, 252);
          const mediaCellYA = tabelaYAjust + 4;
          doc.rect(currXA, mediaCellYA, adjColW[4], rowsAjustado.length * ROW_H, "F");
          doc.setTextColor(200, 0, 0); // vermelho para Média
          doc.setFont("helvetica", "bold");
          doc.text(mediaPontuacaoAjustVal, currXA + adjColW[4] / 2, mediaCellYA + (rowsAjustado.length * ROW_H) / 2, { align: "center", baseline: "middle" });
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
        }
        yRow += ROW_H;
      }

      const tabelaHAjust = ROW_H + 2 + rowsAjustado.length * ROW_H + 6;
      doc.setDrawColor(0, 92, 46);
      doc.setLineWidth(0.4);
      doc.rect(MARGIN, tabelaYAjust - 4, tabelaW, tabelaHAjust);
      let accWA = MARGIN;
      for (let i = 1; i < adjColW.length; i++) {
        accWA += adjColW[i - 1];
        doc.line(accWA, tabelaYAjust - 4, accWA, tabelaYAjust - 4 + tabelaHAjust);
      }
      doc.line(MARGIN, tabelaYAjust + 4, MARGIN + tabelaW, tabelaYAjust + 4);

    } else {
      doc.setFontSize(12);
      doc.text("Dados do IF por subprefeitura não disponíveis para o período.", MARGIN, tabelaY+10);
    }
  }

  function addFaixaAzul(doc: typeof pdf, y: number, texto: string) {
    const bandH = 8;
    const bandW = PAGE_W * 0.8;
    const bandX = 0;
    doc.setFillColor(0, 48, 107); // #00306b
    doc.rect(bandX, y, bandW, bandH, "F");
    doc.setTextColor(r2, g2, b2);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(texto, bandX + 15, y + 5.5);
  }

  async function addPaginaNotificacao(
    doc: typeof pdf,
    bfs: BFSContestar,
    fotos: FotosContestarBfs | undefined
  ) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    addLogo(doc, PAGE_W - MARGIN - 40, MARGIN, 40, 25);

    const cnc = bfs.cnc_detalhes?.[0];
    const cncNum = cnc?.numero_cnc ?? "--";
    addFaixaAzul(doc, 32, `BFS n°: ${bfs.bfs}  |  CNC: ${cncNum}`);

    let y = 50;
    doc.setTextColor(r1, g1, b1);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Notificação", MARGIN, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    doc.text(`Subprefeitura: ${bfs.subprefeitura ?? "--"}`, MARGIN, y);
    y += 6;
    doc.text(`Serviço: ${bfs.tipo_servico ?? "--"}`, MARGIN, y);
    y += 6;
    doc.text(`Setor: ${bfs.setor_resolvido ?? cnc?.setor ?? bfs.setor ?? "--"}  |  Cronograma (do setor): ${bfs.cronograma_resolvido ?? "--"}`, MARGIN, y);
    y += 6;
    doc.setTextColor(r3, g3, b3);
    doc.text(`Data Registro: ${safeFormatDateTime(bfs.data_abertura)}`, MARGIN, y);
    y += 6;
    doc.setTextColor(0, 0, 0);
    doc.text(`Endereço: ${bfs.endereco ?? "--"}`, MARGIN, y);
    y += 6;
    doc.text(`Fiscal: ${bfs.fiscal ?? "--"}`, MARGIN, y);
    y += 10;

    const fotosAgente = fotos?.agente_sub ?? [];
    if (fotosAgente.length > 0) {
      const gap = 4;
      const maxPorFoto = (CONTENT_W - gap) / 2;
      const drawn: { x: number; w: number; h: number }[] = [];
      for (let i = 0; i < Math.min(2, fotosAgente.length); i++) {
        try {
          let src = await loadImageAsBase64(fotosAgente[i]);
          src = await ensurePngOrJpeg(src);
          const dim = await getImageDimensions(src);
          const { w, h } = fitImageDimensions(dim.w, dim.h, maxPorFoto, FOTO_MAX_SIZE);
          const x = MARGIN_LEFT + i * (maxPorFoto + gap);
          doc.addImage(src, getImageFormat(src), x, y, w, h);
          drawn.push({ x, w, h });
        } catch (err) {
          console.warn("Falha ao carregar foto agente_sub:", fotosAgente[i]?.slice?.(0, 50), err);
        }
      }
      if (drawn.length > 0) {
        const maxH = Math.max(...drawn.map((d) => d.h));
        y += maxH + 5; // 5mm entre fotos e legenda
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        for (const d of drawn) {
          doc.text("Foto da fiscalização (agente da sub)", d.x + d.w / 2, y, { align: "center" });
        }
        y += 8;
      }
      doc.setFont("helvetica", "normal");
    }

    const itensFiscalizados = fotos?.itens_fiscalizados ?? [];
    if (itensFiscalizados.length > 0) {
      addFaixaAzul(doc, y, "Itens Fiscalizados");
      y += 8 + 10; // altura da faixa (8mm) + espaço até tabela (10mm)
      const tableTopY = y;

      const getTurnoFromSetor = (setor: string): string => {
        const s = String(setor ?? "").trim().replace(/\s+/g, "");
        if (s.length >= 3) {
          const t = s.charAt(2);
          if (t === "1") return "1° turno";
          if (t === "2") return "2° turno";
          if (t === "3") return "3° turno";
        }
        return "--";
      };

      const ROW_H = 17; // altura da linha (11 +50% ≈ 17)
      const colW = [22, 55, 35, 25, 55];
      const headers = ["Item", "Serviço", "Proatividade", "Turno", "Observações"];
      const tabelaW = Math.min(CONTENT_W, colW.reduce((a, b) => a + b, 0));
      const scale = tabelaW / colW.reduce((a, b) => a + b, 0);
      const adjColW = colW.map((w) => Math.floor(w * scale));

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.setFillColor(0, 48, 107);
      doc.rect(MARGIN_LEFT, tableTopY, tabelaW, ROW_H + 2, "F");
      let xH = MARGIN_LEFT;
      headers.forEach((h, i) => {
        doc.text(h, xH + adjColW[i] / 2, y + (ROW_H + 2) / 2, { align: "center", baseline: "middle" });
        xH += adjColW[i];
      });
      y += ROW_H + 2;

      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      const servicoNome = bfs.tipo_servico ?? "--";
      const centerCols = [0, 1, 2, 3]; // Item, Serviço, Proatividade, Turno — centralizados

      for (let idx = 0; idx < itensFiscalizados.length; idx++) {
        const row = itensFiscalizados[idx];
        const turno = row.turno?.trim() || getTurnoFromSetor(bfs.setor_resolvido ?? bfs.cnc_detalhes?.[0]?.setor ?? bfs.setor ?? "");
        const cells = [
          row.item?.trim() || "--",
          servicoNome,
          row.proatividade?.trim() || "--",
          turno || "--",
          row.observacoes?.trim() || "--",
        ];
        const corFundo = idx % 2 === 0 ? [248, 250, 252] : [255, 255, 255];
        doc.setFillColor(corFundo[0], corFundo[1], corFundo[2]);
        doc.rect(MARGIN_LEFT, y - 2, tabelaW, ROW_H, "F");
        doc.setTextColor(0, 0, 0);

        const cellTopY = y - 2;
        const cellCenterY = cellTopY + ROW_H / 2;
        let xC = MARGIN_LEFT;
        for (let i = 0; i < cells.length; i++) {
          const txt = doc.splitTextToSize(cells[i], adjColW[i] - 2);
          const align = centerCols.includes(i) ? "center" : "left";
          const cellCenterX = xC + adjColW[i] / 2;
          doc.text(txt, align === "center" ? cellCenterX : xC + 2, cellCenterY, {
            align: align as "left" | "center",
            baseline: "middle",
            maxWidth: adjColW[i] - 2,
          });
          xC += adjColW[i];
        }
        y += ROW_H;
      }

      doc.setDrawColor(0, 48, 107);
      doc.setLineWidth(0.3);
      doc.rect(MARGIN_LEFT, tableTopY, tabelaW, y - tableTopY);
    }
  }

  async function addPaginaExecucaoJustificativa(
    doc: typeof pdf,
    bfs: BFSContestar,
    fotos: FotosContestarBfs | undefined
  ) {
    doc.addPage();
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");

    addLogo(doc, PAGE_W - MARGIN - 40, MARGIN, 40, 25);

    const cnc = bfs.cnc_detalhes?.[0];
    const cncNum = cnc?.numero_cnc ?? "--";
    addFaixaAzul(doc, 32, `BFS n°: ${bfs.bfs}  |  CNC: ${cncNum}`);

    let y = 50;
    doc.setTextColor(r1, g1, b1);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Execução do agente", MARGIN, y);
    y += 8;

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    const agente = cnc?.fiscal_contratada ?? "--";
    doc.text(`Agente: ${agente}`, MARGIN, y);
    y += 6;
    doc.text(`Subprefeitura: ${bfs.subprefeitura ?? "--"}`, MARGIN, y);
    y += 6;
    doc.setTextColor(r3, g3, b3);
    doc.text(`Data Finalização: ${cnc?.data_execucao ? safeFormatDateTime(cnc.data_execucao) : "--"}`, MARGIN, y);
    y += 6;
    doc.setTextColor(0, 0, 0);
    doc.text(`Endereço: ${bfs.endereco ?? "--"}`, MARGIN, y);
    y += 10;

    const fotosExec = fotos?.nosso_agente ?? [];
    if (fotosExec.length > 0) {
      const gap = 4;
      const maxPorFoto = (CONTENT_W - gap) / 2;
      const drawnExec: { x: number; w: number; h: number }[] = [];
      for (let i = 0; i < Math.min(2, fotosExec.length); i++) {
        try {
          let src = await loadImageAsBase64(fotosExec[i]);
          src = await ensurePngOrJpeg(src);
          const dim = await getImageDimensions(src);
          const { w, h } = fitImageDimensions(dim.w, dim.h, maxPorFoto, FOTO_MAX_SIZE);
          const x = MARGIN_LEFT + i * (maxPorFoto + gap);
          doc.addImage(src, getImageFormat(src), x, y, w, h);
          drawnExec.push({ x, w, h });
        } catch (err) {
          console.warn("Falha ao carregar foto nosso_agente:", fotosExec[i]?.slice?.(0, 50), err);
        }
      }
      if (drawnExec.length > 0) {
        const maxH = Math.max(...drawnExec.map((d) => d.h));
        y += maxH + 5; // 5mm entre fotos e legenda
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        for (const d of drawnExec) {
          doc.text("Foto da execução", d.x + d.w / 2, y, { align: "center" });
        }
        doc.setFont("helvetica", "normal");
        y += 10;
      }
    }

    addFaixaAzul(doc, y, "Justificativa Técnica:");
    y += 17; // espaço entre faixa azul e texto da justificativa

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    const justificativa = fotos?.justificativa ?? "Justificativa a ser preenchida.";
    const lineHeightFactor = 1.3;
    const lines = doc.splitTextToSize(justificativa, CONTENT_W);
    const PT_TO_MM = 0.35278;
    const lineHeight = 12 * PT_TO_MM * lineHeightFactor; // ~5.5mm por linha (font 12pt × 1.3)
    for (let i = 0; i < lines.length; i++) {
      doc.text(lines[i], MARGIN_LEFT, y);
      y += lineHeight;
    }
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
    const rodapeW = PAGE_W;
    doc.addImage(designRodapeBase64, "PNG", 0, PAGE_H - rodapeH + 1, rodapeW, rodapeH);
  }

  // Ordenar BFSs por subprefeitura
  const bySub = new Map<string, BFSContestar[]>();
  for (const bfs of input.bfssContestar) {
    const sub = bfs.subprefeitura ?? "Outras";
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub)!.push(bfs);
  }

  addCapa(pdf, undefined, true);
  addContracapa(pdf);
  addTabelaIf(pdf);

  const subPrefeituras = Array.from(bySub.keys()).sort();
  for (const sub of subPrefeituras) {
    addCapa(pdf, sub, false);
    const bfssSub = bySub.get(sub)!;
    for (const bfs of bfssSub) {
      const fotos = input.fotosMap[bfs.id];
      await addPaginaNotificacao(pdf, bfs, fotos);
      await addPaginaExecucaoJustificativa(pdf, bfs, fotos);
    }
  }

  addCapaFinal(pdf);

  const dataIni = parseLocalDate(input.periodoInicial) ?? new Date();
  const dataFim = parseLocalDate(input.periodoFinal) ?? new Date();
  const rangeStr = `${format(dataIni, "dd.MM.yyyy")} a ${format(dataFim, "dd.MM.yyyy")}`;
  const nomeArquivo = `Relatório de Contestação Limpebras - ${rangeStr}.pdf`;
  pdf.save(nomeArquivo);
}
