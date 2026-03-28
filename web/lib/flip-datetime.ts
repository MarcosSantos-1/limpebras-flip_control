import { addHours, isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/** Fuso usado na planilha FLIP / operação em SP (independente do fuso do PC do usuário). */
const TZ_FLIP = "America/Sao_Paulo";

/**
 * Tipos de serviço em que o FLIP exporta horários de CNC (registro/finalização) deslocados −3h
 * em relação ao horário real de Brasília; somamos 3h ao exibir para alinhar à BFS e ao relógio local.
 */
const TIPOS_SERVICO_CNC_OFFSET_HORAS_BRT = new Set([
  "Varrição mecanizada de vias e logradouros públicos",
  "Equipe de Mutirão de Zeladoria de Vias e Logradouros Públicos",
]);

function cncFlipPrecisaOffsetBrt(tipoServicoBfs: string | null | undefined): boolean {
  const t = (tipoServicoBfs ?? "").trim();
  return t.length > 0 && TIPOS_SERVICO_CNC_OFFSET_HORAS_BRT.has(t);
}

function ajustarInstanteCncFlip(iso: string, tipoServicoBfs: string | null | undefined): Date {
  const d = parseISO(iso);
  if (!isValid(d)) return d;
  return cncFlipPrecisaOffsetBrt(tipoServicoBfs) ? addHours(d, 3) : d;
}

/**
 * Formata instantes vindos da API (BFS/CNC importados do FLIP).
 * O backend grava o instante UTC correspondente ao horário de Brasília da planilha; exibir em BRT.
 */
export function formatFlipDateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  return formatInTimeZone(d, TZ_FLIP, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

/** Mesmo horário de `formatFlipDateTimeUtc`, com nome do dia da semana (pt-BR) ao lado. */
export function formatFlipDateTimeUtcWithWeekday(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  const datePart = formatInTimeZone(d, TZ_FLIP, "dd/MM/yyyy HH:mm", { locale: ptBR });
  let weekday = formatInTimeZone(d, TZ_FLIP, "EEEE", { locale: ptBR });
  weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${datePart} (${weekday})`;
}

/**
 * Datas de registro/finalização CNC (API) — mesma regra de `formatFlipDateTimeUtc`, com +3h em
 * os tipos Varrição mecanizada / Mutirão (ver constante interna) quando o tipo de serviço da BFS corresponde.
 */
export function formatFlipDateTimeUtcCnc(
  iso: string | null | undefined,
  tipoServicoBfs: string | null | undefined
): string {
  if (!iso) return "—";
  const d = ajustarInstanteCncFlip(iso, tipoServicoBfs);
  if (!isValid(d)) return "—";
  return formatInTimeZone(d, TZ_FLIP, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

/** Mesmo formato longo do PDF de contestação (data, hora, dia da semana). */
export function formatFlipDateTimeUtcCncRelatorioPdf(
  iso: string | null | undefined,
  tipoServicoBfs: string | null | undefined
): string {
  if (!iso) return "--";
  const d = ajustarInstanteCncFlip(iso, tipoServicoBfs);
  if (!isValid(d)) return "--";
  const dStr = formatInTimeZone(d, TZ_FLIP, "dd/MM/yyyy - HH:mm", { locale: ptBR });
  let weekday = formatInTimeZone(d, TZ_FLIP, "EEEE", { locale: ptBR });
  weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${dStr} (${weekday})`;
}
