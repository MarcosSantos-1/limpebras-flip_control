/**
 * PDF das contestações de manutenção do módulo no período apurado.
 * Fotos usam o mesmo carregamento (proxy do Firebase) do relatório de Defesa.
 */

import type { jsPDF } from "jspdf";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ensurePngOrJpeg,
  fitImageDimensions,
  getImageDimensions,
  getImageFormat,
  loadImageFromUrlUncached,
} from "./pdf-relatorio-contestacao";

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const COLOR_TITLE = "#00215a";

export interface ContestacaoManutencaoSetor {
  setor: string;
  sub: string;
  selimp: string;
  frequencia: string;
  diasDespacho: number;
  motivo: string;
  detalhes: string;
  status: string;
  datas: string;
}

export interface ContestacaoManutencaoDia {
  data: string;
  setor: string;
  selimp: string;
  detalhes: string;
  printUrl?: string;
  printTitulo?: string;
}

export interface RelatorioManutencaoInput {
  periodoInicial: string;
  periodoFinal: string;
  setores: ContestacaoManutencaoSetor[];
  dias: ContestacaoManutencaoDia[];
}

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

function fmtData(iso: string): string {
  const date = parseLocalDate(iso);
  return date ? format(date, "dd/MM/yyyy", { locale: ptBR }) : iso || "—";
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed <= PAGE_H - MARGIN) return y;
  doc.addPage();
  return MARGIN;
}

function writeWrapped(doc: jsPDF, text: string, y: number, size = 10): number {
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, CONTENT_W) as string[];
  const lineH = size * 0.45;
  let cursor = y;
  for (const line of lines) {
    cursor = ensureSpace(doc, cursor, lineH + 1);
    doc.text(line, MARGIN, cursor);
    cursor += lineH;
  }
  return cursor;
}

export async function gerarRelatorioManutencaoPDF(input: RelatorioManutencaoInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const [r, g, b] = hexToRgb(COLOR_TITLE);
  const imageMemo = new Map<string, Promise<string>>();
  const loadImage = (url: string) => {
    let pending = imageMemo.get(url);
    if (!pending) {
      pending = loadImageFromUrlUncached(url);
      imageMemo.set(url, pending);
    }
    return pending;
  };

  let y = MARGIN;
  pdf.setTextColor(r, g, b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Contestações de manutenção", MARGIN, y);
  y += 8;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(40, 40, 40);
  pdf.text(`Período apurado: ${fmtData(input.periodoInicial)} a ${fmtData(input.periodoFinal)}`, MARGIN, y);
  y += 6;
  pdf.setFontSize(9);
  pdf.setTextColor(90, 90, 90);
  pdf.text("Limpebras Engenharia Ambiental", MARGIN, y);
  y += 8;

  pdf.setTextColor(r, g, b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  y = ensureSpace(pdf, y, 10);
  pdf.text("I. Setores prejudicados em manutenção", MARGIN, y);
  y += 7;

  pdf.setTextColor(20, 20, 20);
  input.setores.forEach((setor, index) => {
    y = ensureSpace(pdf, y, 28);
    pdf.setDrawColor(210, 210, 210);
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(r, g, b);
    y = writeWrapped(pdf, `${index + 1}. ${setor.setor || "—"}`, y, 11);
    y += 1;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(20, 20, 20);
    const dias = `${setor.diasDespacho} dia(s) de despacho na janela`;
    const linhas = [
      `Subprefeitura: ${setor.sub || "—"}    SELIMP: ${setor.selimp || "—"}`,
      `Frequência: ${setor.frequencia || "—"} · ${dias}`,
      `Motivo: ${setor.motivo || "—"}`,
      `Detalhes: ${setor.detalhes || "—"}`,
      `Status: ${setor.status || "—"}`,
      `Datas: ${setor.datas || "—"}`,
    ];
    for (const linha of linhas) {
      y = writeWrapped(pdf, linha, y, 10);
      y += 1.2;
    }
    y += 3;
  });

  y = ensureSpace(pdf, y, 16);
  y += 4;
  pdf.setTextColor(r, g, b);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("II. Dias contestados", MARGIN, y);
  y += 7;
  pdf.setTextColor(20, 20, 20);
  pdf.setFont("helvetica", "normal");

  if (input.dias.length === 0) {
    y = writeWrapped(pdf, "Nenhum dia contestado com foto neste período.", y, 10);
  }

  for (const dia of input.dias) {
    y = ensureSpace(pdf, y, 24);
    pdf.setDrawColor(210, 210, 210);
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 5;
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(r, g, b);
    y = writeWrapped(pdf, `${fmtData(dia.data)} · ${dia.setor || "—"} · SELIMP ${dia.selimp || "—"}`, y, 11);
    y += 1.5;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(20, 20, 20);
    y = writeWrapped(pdf, dia.detalhes || "—", y, 10);
    y += 2;
    if (dia.printTitulo) {
      pdf.setFontSize(8);
      pdf.setTextColor(90, 90, 90);
      y = writeWrapped(pdf, dia.printTitulo, y, 8);
      y += 1;
    }
    if (dia.printUrl) {
      try {
        let src = await loadImage(dia.printUrl);
        src = await ensurePngOrJpeg(src);
        const dim = await getImageDimensions(src);
        const fitted = fitImageDimensions(dim.w, dim.h, CONTENT_W, 78);
        y = ensureSpace(pdf, y, fitted.h + 4);
        pdf.addImage(src, getImageFormat(src), MARGIN, y, fitted.w, fitted.h);
        y += fitted.h + 4;
      } catch (err) {
        console.warn("Falha ao carregar print da contestação", dia.printUrl.slice(0, 80), err);
        pdf.setTextColor(160, 60, 60);
        y = writeWrapped(pdf, "Foto indisponível.", y, 9);
        y += 2;
        pdf.setTextColor(20, 20, 20);
      }
    }
    y += 3;
  }

  const dataIni = parseLocalDate(input.periodoInicial) ?? new Date();
  const dataFim = parseLocalDate(input.periodoFinal) ?? new Date();
  const rangeStr = `${format(dataIni, "dd.MM.yyyy")} a ${format(dataFim, "dd.MM.yyyy")}`;
  pdf.save(`Contestações de Manutenção - ${rangeStr}.pdf`);
}
