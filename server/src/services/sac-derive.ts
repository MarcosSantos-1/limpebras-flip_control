/**
 * Regras de exibição de status e datas de SAC (planilha FLIP).
 * Evita marcar "Finalizado" quando não há evidência de execução/confirmação na base.
 */

export function effectiveSacExecutionDate(
  dataRealizacaoConfirmacao: Date | string | null | undefined,
  dataExecucao: Date | string | null | undefined
): Date | null {
  const r = toValidDate(dataRealizacaoConfirmacao);
  const e = toValidDate(dataExecucao);
  if (r && e) return r.getTime() >= e.getTime() ? r : e;
  return r ?? e ?? null;
}

function toValidDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data civil (YYYY-MM-DD) no fuso de São Paulo, a partir de um instante UTC armazenado. */
export function dateKeyBrtFromInstant(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const mo = parts.find((p) => p.type === "month")?.value?.padStart(2, "0");
  const day = parts.find((p) => p.type === "day")?.value?.padStart(2, "0");
  if (!y || !mo || !day) return null;
  return `${y}-${mo}-${day}`;
}

export function todayKeyBrt(now: Date = new Date()): string {
  return dateKeyBrtFromInstant(now) ?? "";
}

/** IRD ou bueiros (classificação vazia na planilha): mesma lógica de prazo por acionamento / só finalizado. */
export function usesAcionamentoPrazoRules(classificacao_do_servico: string | null | undefined): boolean {
  const c = (classificacao_do_servico || "").trim();
  return c === "Reclamação" || c === "";
}

/**
 * IRD (Reclamação) e bueiros (classificação vazia): só entram como fora do prazo quando finalizados
 * (há data efetiva de execução). Em aberto, nunca — mesmo com Responsividade NÃO.
 * Com Data_Acionamento_Agendamento: fora se dia da execução efetiva > dia do acionamento.
 * Sem acionamento: Responsividade NÃO da planilha (após finalizado).
 * Solicitação (IA) e demais: Responsividade NÃO da planilha.
 */
export function computeForaDoPrazoSac(input: {
  classificacao_do_servico: string | null | undefined;
  responsividade_execucao: string | null | undefined;
  data_acionamento_agendamento: Date | null | undefined;
  data_execucao: Date | null | undefined;
  data_realizacao_confirmacao: Date | null | undefined;
}): boolean {
  const csvNao = (input.responsividade_execucao || "").trim().toUpperCase() === "NÃO";
  const eff = effectiveSacExecutionDate(input.data_realizacao_confirmacao, input.data_execucao);

  if (usesAcionamentoPrazoRules(input.classificacao_do_servico)) {
    if (!eff) {
      return false;
    }
    const ac = toValidDate(input.data_acionamento_agendamento);
    if (ac) {
      const agendKey = dateKeyBrtFromInstant(ac);
      if (!agendKey) return csvNao;
      const execKey = dateKeyBrtFromInstant(eff);
      if (!execKey) return csvNao;
      return execKey > agendKey;
    }
    return csvNao;
  }

  return csvNao;
}

/**
 * Status para UI: prioriza evidência de execução; desconfia de "Finalizado" no CSV sem data.
 */
export function deriveSacStatus(input: {
  status_planilha: string | null | undefined;
  data_execucao: Date | null | undefined;
  data_realizacao_confirmacao: Date | null | undefined;
  data_agendamento: Date | null | undefined;
  data_acionamento_agendamento?: Date | null | undefined;
}): string {
  const eff = effectiveSacExecutionDate(input.data_realizacao_confirmacao, input.data_execucao);
  const raw = (input.status_planilha || "").trim();

  if (eff) {
    return "Finalizado";
  }

  if (raw.length > 0) {
    const looksClosed = /FINALIZ|CONCLU|EXECUTAD|ENCERRAD|REALIZAD/i.test(raw);
    if (looksClosed) {
      return "Em andamento";
    }
    return raw;
  }

  if (toValidDate(input.data_agendamento) || toValidDate(input.data_acionamento_agendamento)) {
    return "Agendado";
  }

  return "Em andamento";
}

export function toIsoOrNull(d: Date | string | null | undefined): string | null {
  const x = toValidDate(d);
  return x ? x.toISOString() : null;
}
