/**
 * Gargalos de execução: o que puxa o percentual de cada serviço para baixo.
 *
 * A média do serviço é a dos despachos encerrados (cada dia conta uma vez).
 * O peso de um setor é
 *   pp = (encerrados do setor / encerrados do serviço) × (100 − % médio do setor).
 * Dia não enviado não entra nessa média; entra à parte, pelo volume.
 */

export const GARGALO_THRESHOLDS = {
  /** % médio abaixo disso, com bateria ok, é execução baixa. */
  EXECUCAO_BAIXA: 75,
  /** % médio abaixo disso, com bateria ok, é nunca / quase nunca. */
  NUNCA: 40,
  /** Bateria ou produtividade neste nível (ou sem sinal) é problema de equipamento. */
  BATERIA: 30,
  /** |SELIMP − DDMX| acima disso, com execução baixa, é cadastro/contestação. */
  DIVERGENCIA_PP: 12,
  /** Fração de previstos não enviados a partir da qual o setor é falta de envio. */
  FALTA_ENVIO_FRACAO: 0.5,
} as const;

export type GrupoGargalo = "nosso" | "operacional" | "ok";

export type MotivoGargalo = "bateria" | "falta_envio" | "planejamento" | "nunca" | "execucao_baixa";

/** Fatos já agregados de um setor. O loader garante um registro por plano. */
export interface SetorFato {
  plano: string;
  sub: string;
  tipoServico: string;
  frequencia: string;
  previstos: number;
  encerrados: number;
  naoEnviados: number;
  somaPercentual: number;
  contagemPercentual: number;
  temModulo: boolean;
  comSinal: boolean;
  bateriaMedia: number | null;
  qtdTrocas: number;
  trocaSemSinal: boolean;
  manutencaoSemSinal: boolean;
  percentualDdmx: number | null;
  temDdmx: boolean;
  obsTitulo: string | null;
}

export interface GargaloSetor {
  plano: string;
  sub: string;
  tipoServico: string;
  frequencia: string;
  previstos: number;
  encerrados: number;
  naoEnviados: number;
  percentual: number | null;
  pp: number;
  grupo: Exclude<GrupoGargalo, "ok">;
  motivo: MotivoGargalo;
  frase: string;
  temModulo: boolean;
  comSinal: boolean;
  bateriaMedia: number | null;
  qtdTrocas: number;
  trocaSemSinal: boolean;
  manutencaoSemSinal: boolean;
  percentualDdmx: number | null;
  divergencia: number | null;
  obsTitulo: string | null;
}

export interface ServicoGargalo {
  tipoServico: string;
  percentual: number | null;
  gap: number | null;
  ppBateria: number;
  ppPlanejamento: number;
  ppFaltaEnvio: number;
  ppOperacional: number;
  ppDemais: number;
  previstos: number;
  encerrados: number;
  naoEnviados: number;
  setoresProblema: number;
}

export interface GargalosResultado {
  servicos: ServicoGargalo[];
  setores: GargaloSetor[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function mediaDe(f: SetorFato): number | null {
  if (f.contagemPercentual <= 0) return null;
  return f.somaPercentual / f.contagemPercentual;
}

function bateriaRuim(f: SetorFato, media: number | null): boolean {
  if (!f.temModulo || media == null || media >= GARGALO_THRESHOLDS.EXECUCAO_BAIXA) return false;
  if (!f.comSinal) return true;
  return f.bateriaMedia != null && f.bateriaMedia <= GARGALO_THRESHOLDS.BATERIA;
}

function faltaEnvio(f: SetorFato): boolean {
  if (f.previstos <= 0) return false;
  if (f.encerrados === 0) return true;
  return f.naoEnviados / f.previstos >= GARGALO_THRESHOLDS.FALTA_ENVIO_FRACAO;
}

function fraseDe(f: SetorFato, motivo: MotivoGargalo, media: number | null, divergencia: number | null): string {
  switch (motivo) {
    case "bateria":
      if (!f.comSinal && (f.trocaSemSinal || f.manutencaoSemSinal)) {
        return "troca ou manutenção não recuperou o sinal";
      }
      if (!f.comSinal) return "bateria sem sinal";
      return "bateria baixa ou hibernando";
    case "falta_envio": {
      const qtd = f.naoEnviados > 0 ? f.naoEnviados : f.previstos;
      const base = `${qtd} previstos não enviados — não entra na média`;
      if (f.temModulo && !f.comSinal) return `${base} · bateria sem sinal`;
      return base;
    }
    case "planejamento":
      if (!f.temModulo && !f.temDdmx) {
        if (f.encerrados === 0) return "sem módulo SELIMP e não foi enviado — não dá para medir";
        return "sem módulo SELIMP — não dá para medir";
      }
      if (divergencia != null) {
        return `SELIMP e DDMX divergem ${Math.round(divergencia)} pp — o número do IPT pode estar errado`;
      }
      return "cadastro do setor incompleto";
    case "nunca":
      if (media != null && media <= 0) return "foi despachado e a execução ficou zerada";
      return "foi despachado, mas quase não é executado";
    case "execucao_baixa":
      return "bateria ok, mas o percentual de execução está baixo";
  }
}

interface Classificado {
  setor: GargaloSetor | null;
  pp: number;
  motivo: MotivoGargalo | null;
}

function classificarUm(f: SetorFato, contagemServico: number): Classificado {
  const media = mediaDe(f);
  const divergencia =
    media != null && f.percentualDdmx != null ? Math.abs(media - f.percentualDdmx) : null;
  const pp =
    f.contagemPercentual > 0 && contagemServico > 0
      ? (f.contagemPercentual / contagemServico) * (100 - (media ?? 0))
      : 0;

  const semMedicao = !f.temModulo && !f.temDdmx;
  const baixa = media != null && media < GARGALO_THRESHOLDS.EXECUCAO_BAIXA;

  let motivo: MotivoGargalo | null = null;
  let grupo: Exclude<GrupoGargalo, "ok"> | null = null;

  if (faltaEnvio(f)) {
    motivo = "falta_envio";
    grupo = "nosso";
  } else if (bateriaRuim(f, media)) {
    motivo = "bateria";
    grupo = "nosso";
  } else if (baixa && divergencia != null && divergencia > GARGALO_THRESHOLDS.DIVERGENCIA_PP) {
    motivo = "planejamento";
    grupo = "nosso";
  } else if (baixa && semMedicao) {
    motivo = "planejamento";
    grupo = "nosso";
  } else if (baixa && media != null && media < GARGALO_THRESHOLDS.NUNCA) {
    motivo = "nunca";
    grupo = "operacional";
  } else if (baixa) {
    motivo = "execucao_baixa";
    grupo = "operacional";
  }

  if (!motivo || !grupo) return { setor: null, pp, motivo: null };

  return {
    pp,
    motivo,
    setor: {
      plano: f.plano,
      sub: f.sub,
      tipoServico: f.tipoServico || "Não informado",
      frequencia: f.frequencia || "—",
      previstos: f.previstos,
      encerrados: f.encerrados,
      naoEnviados: f.naoEnviados,
      percentual: media == null ? null : round1(media),
      pp: round1(pp),
      grupo,
      motivo,
      frase: fraseDe(f, motivo, media, divergencia),
      temModulo: f.temModulo,
      comSinal: f.comSinal,
      bateriaMedia: f.bateriaMedia == null ? null : round1(f.bateriaMedia),
      qtdTrocas: f.qtdTrocas,
      trocaSemSinal: f.trocaSemSinal,
      manutencaoSemSinal: f.manutencaoSemSinal,
      percentualDdmx: f.percentualDdmx == null ? null : round1(f.percentualDdmx),
      divergencia: divergencia == null ? null : round1(divergencia),
      obsTitulo: f.obsTitulo,
    },
  };
}

/**
 * Classifica os setores e monta o resumo por serviço.
 * Setores sem dia previsto no período ficam de fora.
 * A lista só traz problema; o resumo do serviço usa também os que estão ok.
 */
export function classificarGargalos(fatos: SetorFato[]): GargalosResultado {
  const porServico = new Map<string, SetorFato[]>();
  for (const f of fatos) {
    if (f.previstos <= 0) continue;
    const chave = f.tipoServico || "Não informado";
    const lista = porServico.get(chave);
    if (lista) lista.push(f);
    else porServico.set(chave, [f]);
  }

  const servicos: ServicoGargalo[] = [];
  const setores: GargaloSetor[] = [];

  for (const [tipoServico, grupo] of porServico) {
    const contagem = grupo.reduce((a, f) => a + f.contagemPercentual, 0);
    const soma = grupo.reduce((a, f) => a + f.somaPercentual, 0);
    const percentual = contagem > 0 ? soma / contagem : null;
    const gap = percentual == null ? null : 100 - percentual;

    let ppBateria = 0;
    let ppPlanejamento = 0;
    let ppFaltaEnvio = 0;
    let ppOperacional = 0;
    let problemas = 0;

    for (const f of grupo) {
      const item = classificarUm({ ...f, tipoServico }, contagem);
      if (item.motivo === "bateria") ppBateria += item.pp;
      else if (item.motivo === "planejamento") ppPlanejamento += item.pp;
      else if (item.motivo === "falta_envio") ppFaltaEnvio += item.pp;
      else if (item.motivo === "nunca" || item.motivo === "execucao_baixa") ppOperacional += item.pp;
      if (item.setor) {
        problemas += 1;
        setores.push(item.setor);
      }
    }

    const explicado = ppBateria + ppPlanejamento + ppFaltaEnvio + ppOperacional;
    servicos.push({
      tipoServico,
      percentual: percentual == null ? null : round1(percentual),
      gap: gap == null ? null : round1(gap),
      ppBateria: round1(ppBateria),
      ppPlanejamento: round1(ppPlanejamento),
      ppFaltaEnvio: round1(ppFaltaEnvio),
      ppOperacional: round1(ppOperacional),
      ppDemais: gap == null ? 0 : round1(Math.max(0, gap - explicado)),
      previstos: grupo.reduce((a, f) => a + f.previstos, 0),
      encerrados: grupo.reduce((a, f) => a + f.encerrados, 0),
      naoEnviados: grupo.reduce((a, f) => a + f.naoEnviados, 0),
      setoresProblema: problemas,
    });
  }

  servicos.sort(
    (a, b) => (b.gap ?? -1) - (a.gap ?? -1) || b.naoEnviados - a.naoEnviados || a.tipoServico.localeCompare(b.tipoServico, "pt-BR"),
  );
  setores.sort(
    (a, b) => b.pp - a.pp || b.naoEnviados - a.naoEnviados || a.plano.localeCompare(b.plano, "pt-BR"),
  );

  return { servicos, setores };
}
