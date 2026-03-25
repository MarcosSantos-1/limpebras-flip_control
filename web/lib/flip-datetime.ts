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
