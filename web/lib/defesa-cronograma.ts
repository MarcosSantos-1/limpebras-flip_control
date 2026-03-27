import { isValid } from "date-fns";

/** Serviços com muitas datas no cronograma: exibir 3 datas em relação à data de registro do BFS. */
export function isServicoCronogramaReduzido(tipoServico: string | undefined): boolean {
  const t = (tipoServico || "").toLowerCase();
  return (
    /mutir[aã]o|equipe\s+de\s+mutir|bueiro|limpeza\s+de\s+bueiro|desobstru|cata-bagulho|volumoso|entulho|coleta\s+programada/i.test(
      t
    )
  );
}

function parseDdMmYyyy(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isValid(d) ? d : null;
}

export interface TresDatasCronograma {
  antes: string | null;
  maisProxima: string | null;
  depois: string | null;
}

/**
 * Extrai 3 datas do cronograma (dd/MM/yyyy; ...) em relação à data de registro do BFS:
 * uma anterior, a mais próxima (menor |d − ref|), uma futura.
 */
export function cronogramaTresDatasRelativoRegistro(
  cronograma: string | undefined | null,
  dataRegistroIso: string | undefined | null
): TresDatasCronograma | null {
  if (!cronograma?.trim() || !dataRegistroIso) return null;
  const partes = cronograma.split(";").map((d) => d.trim()).filter(Boolean);
  const parsed = partes
    .map((str) => {
      const d = parseDdMmYyyy(str);
      return d ? { str, t: d.getTime() } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (parsed.length === 0) return null;

  const ref = new Date(dataRegistroIso);
  if (!isValid(ref)) return null;
  ref.setHours(0, 0, 0, 0);
  const refT = ref.getTime();

  const unique = [...new Map(parsed.map((p) => [p.str, p])).values()].sort((a, b) => a.t - b.t);

  let antes: string | null = null;
  let antesT = -Infinity;
  let depois: string | null = null;
  let depoisT = Infinity;
  for (const p of unique) {
    if (p.t < refT && p.t > antesT) {
      antesT = p.t;
      antes = p.str;
    }
    if (p.t > refT && p.t < depoisT) {
      depoisT = p.t;
      depois = p.str;
    }
  }

  let maisProxima = unique[0].str;
  let bestDist = Infinity;
  for (const p of unique) {
    const dist = Math.abs(p.t - refT);
    if (dist < bestDist) {
      bestDist = dist;
      maisProxima = p.str;
    }
  }

  return { antes, maisProxima, depois };
}

/** Texto único para relatório / tabela (serviços com cronograma denso). */
export function formatCronogramaTresDatas(c: TresDatasCronograma): string {
  const a = c.antes ?? "—";
  const m = c.maisProxima ?? "—";
  const d = c.depois ?? "—";
  return `Antes: ${a}; Mais próxima ao registro: ${m}; Depois: ${d}`;
}

/** PDF da contestação: só duas datas (antes | depois), sem rótulos longos. */
export function formatCronogramaTresDatasRelatorioPdf(c: TresDatasCronograma): string {
  const first = c.antes ?? c.maisProxima ?? "";
  const second = c.depois ?? "";
  if (first && second) return `${first} | ${second}`;
  if (first) return first;
  if (second) return second;
  return c.maisProxima ?? "";
}

/**
 * Cronograma para exibição: string completa ou 3 datas (relativo ao registro) conforme o tipo de serviço.
 * `cronogramaBruto` já deve ser o texto base (resolvido ou override).
 */
export function getCronogramaTextoParaExibir(
  cronogramaBruto: string | undefined | null,
  tipoServico: string | undefined,
  dataRegistroIso: string | undefined | null
): string {
  const crono = cronogramaBruto?.trim();
  if (!crono) return "";
  if (!isServicoCronogramaReduzido(tipoServico)) return crono;
  const tres = cronogramaTresDatasRelativoRegistro(crono, dataRegistroIso);
  if (!tres) return crono;
  return formatCronogramaTresDatas(tres);
}

/** Mesma lógica de `getCronogramaTextoParaExibir`, mas cronograma reduzido em duas datas `dd/MM/yyyy | dd/MM/yyyy` (PDF e UI Defesa). */
export function getCronogramaTextoParaRelatorioPdf(
  cronogramaBruto: string | undefined | null,
  tipoServico: string | undefined,
  dataRegistroIso: string | undefined | null
): string {
  const crono = cronogramaBruto?.trim();
  if (!crono) return "";
  if (!isServicoCronogramaReduzido(tipoServico)) return crono;
  const tres = cronogramaTresDatasRelativoRegistro(crono, dataRegistroIso);
  if (!tres) return crono;
  return formatCronogramaTresDatasRelatorioPdf(tres);
}
