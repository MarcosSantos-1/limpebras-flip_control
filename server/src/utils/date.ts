/**
 * Converte string de data do FLIP (dd/MM/yyyy HH:mm:ss ou dd/MM/yyyy) para Date.
 */
export function parseFlipDate(value: string | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // dd/MM/yyyy HH:mm:ss ou dd/MM/yyyy
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
  if (!match) return null;
  const [, d, m, y, h = "0", min = "0", s = "0"] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Data está dentro do período [inicio, fim] (inclusive no dia).
 */
export function isDateInRange(date: Date | null, inicio: string, fim: string): boolean {
  if (!date) return false;
  const start = new Date(inicio);
  const end = new Date(fim);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
}
