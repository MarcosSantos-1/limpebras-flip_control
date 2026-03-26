import { isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/**
 * Formata instantes vindos da API (BFS/CNC importados do FLIP).
 * O backend grava `parseFlipDate` como componentes UTC alinhados ao CSV; exibir em UTC
 * mantém os mesmos dígitos do registro na planilha / sistema de origem, independente do fuso do navegador.
 */
export function formatFlipDateTimeUtc(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  return formatInTimeZone(d, "UTC", "dd/MM/yyyy HH:mm", { locale: ptBR });
}

/** Mesmo instante que `formatFlipDateTimeUtc`, com nome do dia da semana (pt-BR) ao lado. */
export function formatFlipDateTimeUtcWithWeekday(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  const datePart = formatInTimeZone(d, "UTC", "dd/MM/yyyy HH:mm", { locale: ptBR });
  let weekday = formatInTimeZone(d, "UTC", "EEEE", { locale: ptBR });
  weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${datePart} (${weekday})`;
}
