import assert from "node:assert/strict";
import test from "node:test";
import { classificarGargalos, type SetorFato } from "./ipt-gargalos.js";

function fato(partial: Partial<SetorFato> & Pick<SetorFato, "plano">): SetorFato {
  return {
    sub: "CV",
    tipoServico: "Varrição",
    frequencia: "diária - 1x/dia",
    previstos: 20,
    encerrados: 20,
    naoEnviados: 0,
    somaPercentual: 20 * 90,
    contagemPercentual: 20,
    temModulo: true,
    comSinal: true,
    bateriaMedia: 80,
    qtdTrocas: 0,
    trocaSemSinal: false,
    manutencaoSemSinal: false,
    percentualDdmx: null,
    temDdmx: false,
    obsTitulo: null,
    ...partial,
  };
}

test("setor diário com muitos despachos tira mais pontos que um mensal zerado", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101VJ0001",
      frequencia: "diária - 1x/dia",
      previstos: 26,
      encerrados: 26,
      somaPercentual: 26 * 40,
      contagemPercentual: 26,
    }),
    fato({
      plano: "CV10600VJ0002",
      frequencia: "Mensal - 1x/Mês",
      previstos: 1,
      encerrados: 1,
      somaPercentual: 0,
      contagemPercentual: 1,
    }),
  ]);
  assert.equal(r.setores[0].plano, "CV10101VJ0001");
  assert.ok(r.setores[0].pp > r.setores[1].pp);
  const servico = r.servicos[0];
  assert.equal(servico.percentual, Math.round(((26 * 40) / 27) * 10) / 10);
  const gap = 100 - (26 * 40) / 27;
  assert.ok(Math.abs((servico.ppOperacional ?? 0) - gap) < 0.15);
});

test("bateria sem sinal com execução baixa é problema nosso", () => {
  const r = classificarGargalos([
    fato({
      plano: "JT10101VJ0001",
      sub: "JT",
      somaPercentual: 20 * 30,
      comSinal: false,
      bateriaMedia: 0,
      qtdTrocas: 2,
      trocaSemSinal: true,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "bateria");
  assert.equal(r.setores[0].grupo, "nosso");
  assert.match(r.setores[0].frase, /não recuperou o sinal/);
  assert.equal(r.servicos[0].ppBateria, r.setores[0].pp);
});

test("previsto e não despachado é falta de envio e não entra na média", () => {
  const r = classificarGargalos([
    fato({
      plano: "MG10101VJ0001",
      sub: "MG",
      previstos: 12,
      encerrados: 0,
      naoEnviados: 12,
      somaPercentual: 0,
      contagemPercentual: 0,
    }),
    fato({ plano: "MG10101VJ0002", somaPercentual: 10 * 100, contagemPercentual: 10, previstos: 10, encerrados: 10 }),
  ]);
  const falta = r.setores.find((s) => s.plano === "MG10101VJ0001");
  assert.ok(falta);
  assert.equal(falta.motivo, "falta_envio");
  assert.equal(falta.pp, 0);
  assert.equal(r.servicos[0].percentual, 100);
  assert.equal(r.servicos[0].naoEnviados, 12);
});

test("sem módulo e sem DDMX é planejamento", () => {
  const r = classificarGargalos([
    fato({
      plano: "ST10101VJ0001",
      sub: "ST",
      temModulo: false,
      comSinal: false,
      bateriaMedia: null,
      somaPercentual: 8 * 10,
      contagemPercentual: 8,
      previstos: 8,
      encerrados: 8,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "planejamento");
  assert.match(r.setores[0].frase, /sem módulo SELIMP/);
});

test("despachado, bateria ok e zerado é operacional — nunca executado", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101VJ0009",
      somaPercentual: 0,
      contagemPercentual: 15,
      previstos: 15,
      encerrados: 15,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "nunca");
  assert.equal(r.setores[0].grupo, "operacional");
});

test("despachado, bateria ok e percentual médio fica em execução baixa", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101VJ0008",
      somaPercentual: 10 * 55,
      contagemPercentual: 10,
      previstos: 10,
      encerrados: 10,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "execucao_baixa");
  assert.equal(r.setores.length, 1);
});

test("execução boa sem módulo não entra na lista", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101NH0001",
      temModulo: false,
      comSinal: false,
      bateriaMedia: null,
      somaPercentual: 10 * 92,
      contagemPercentual: 10,
      previstos: 10,
      encerrados: 10,
    }),
  ]);
  assert.equal(r.setores.length, 0);
});

test("execução dentro do esperado não entra na lista", () => {
  const r = classificarGargalos([
    fato({ plano: "CV10101VJ0007", somaPercentual: 20 * 92, contagemPercentual: 20 }),
  ]);
  assert.equal(r.setores.length, 0);
  assert.equal(r.servicos[0].setoresProblema, 0);
  assert.ok((r.servicos[0].ppDemais ?? 0) > 0);
});

test("divergência grande com execução baixa é planejamento, não operação", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101VJ0006",
      somaPercentual: 10 * 40,
      contagemPercentual: 10,
      previstos: 10,
      encerrados: 10,
      percentualDdmx: 80,
      temDdmx: true,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "planejamento");
  assert.ok((r.setores[0].divergencia ?? 0) > 12);
});

test("maioria dos dias não enviada continua falta de envio mesmo com alguns encerrados", () => {
  const r = classificarGargalos([
    fato({
      plano: "CV10101VJ0005",
      previstos: 10,
      encerrados: 3,
      naoEnviados: 7,
      somaPercentual: 3 * 20,
      contagemPercentual: 3,
    }),
  ]);
  assert.equal(r.setores[0].motivo, "falta_envio");
  assert.ok(r.setores[0].pp > 0);
  assert.equal(r.servicos[0].ppFaltaEnvio, r.setores[0].pp);
});
