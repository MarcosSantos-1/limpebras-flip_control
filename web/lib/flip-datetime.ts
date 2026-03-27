import { isValid, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/** Fuso usado na planilha FLIP / operação em SP (independente do fuso do PC do usuário). */
const TZ_FLIP = "America/Sao_Paulo";

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
