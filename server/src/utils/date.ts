/**
 * Converte string de data do FLIP (dd/MM/yyyy HH:mm, HH:mm:ss ou só data) para Date (instante UTC).
 * Os valores na planilha são horário de operação em São Paulo (BRT = UTC−3; sem horário de verão desde 2019).
 * Converte para UTC somando 3 h às componentes antes de Date.UTC.
 * Na web, formate com fuso America/Sao_Paulo para recuperar os mesmos dígitos da planilha.
 */
export function parseFlipDate(value: string | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Segundos opcionais: muitos CSVs CNC vêm como "dd/MM/yyyy HH:mm" sem ":ss".
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) return null;
  const [, d, m, y, hh = "0", mm = "0", ss = "0"] = match;
  const day = Number(d);
  const month = Number(m) - 1;
  const year = Number(y);
  const hour = Number(hh) + 3;
  const minute = Number(mm);
  const second = Number(ss);
  const t = Date.UTC(year, month, day, hour, minute, second);
  return isNaN(t) ? null : new Date(t);
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
