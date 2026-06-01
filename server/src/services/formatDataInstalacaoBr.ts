/**
 * Normaliza data de instalação já persistida para dd/MM/yyyy (padrão BR, só calendário).
 * Aceita: dd/MM/yyyy, dd/MM/yy, com ou sem hora; YYYY-MM-DD; ISO completo; timestamp parseável.
 */
export function formatDataInstalacaoBr(input: string | number | null | undefined): string {
  if (input == null || input === "") return "";
  const s = String(input).trim();
  if (!s) return "";

  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    let yyyy = slashDate[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    let day = first;
    let month = second;

    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else if (second > 12 && first <= 12) {
      day = second;
      month = first;
    }

    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}
