import assert from "node:assert/strict";
import test from "node:test";
import {
  adicionarFallbackOperacional,
  ajustarPercentualBolha,
  criarAcumuladorExecucao,
  despachoOperacionalPresente,
  chaveDataDdmx,
  escolherPercentualOperacional,
  extrairPercentualDdmx,
  fonteAgregada,
  maximosDiariosPorPlano,
  percentualDoDia,
} from "./ddmx-operacional.js";
import { statusDoDia } from "./despachosDiarios.js";

test("prioriza SELIMP e usa DDMX somente quando o percentual SELIMP falta", () => {
  assert.deepEqual(escolherPercentualOperacional(82, 91), { percentual: 82, fonte: "selimp" });
  assert.deepEqual(escolherPercentualOperacional(null, 91), { percentual: 91, fonte: "ddmx" });
  assert.deepEqual(escolherPercentualOperacional(null, null), { percentual: null, fonte: null });
});

test("preserva 0% DDMX como percentual e despacho presentes", () => {
  assert.deepEqual(escolherPercentualOperacional(null, 0), { percentual: 0, fonte: "ddmx" });
  assert.equal(despachoOperacionalPresente(false, 0, 0), true);
  assert.equal(statusDoDia(true, true, 0), "zerado");
});

test("registro DDMX sem percentual não marca despacho, mas sinalização manual marca", () => {
  assert.equal(despachoOperacionalPresente(false, 0, null), false);
  assert.equal(despachoOperacionalPresente(true, 0, null), true);
  assert.equal(despachoOperacionalPresente(false, 1, null), true);
});

test("normaliza percentuais DDMX nos aliases suportados", () => {
  assert.equal(extrairPercentualDdmx({ percentual_de_execucao: "87,5%" }), 87.5);
  assert.equal(extrairPercentualDdmx({ percentual_execucao: 0.42 }), 42);
  assert.equal(extrairPercentualDdmx({ percentual: 0 }), 0);
  assert.equal(extrairPercentualDdmx({ percentual: "inválido" }), null);
  assert.equal(extrairPercentualDdmx({ percentual_executado: "56%" }), 56);
  assert.equal(extrairPercentualDdmx({ percentual_executado: "0%" }), 0);
});

test("agregação seleciona a fonte por item e identifica origem mista", () => {
  const acumulador = criarAcumuladorExecucao();
  adicionarFallbackOperacional(
    acumulador,
    { sum: 80, count: 1, nonzeroCount: 1 },
    { sum: 99, count: 1, nonzeroCount: 1 },
  );
  adicionarFallbackOperacional(
    acumulador,
    { sum: 0, count: 0, nonzeroCount: 0 },
    { sum: 70, count: 1, nonzeroCount: 1 },
  );

  assert.equal(acumulador.sum, 150);
  assert.equal(acumulador.count, 2);
  assert.equal(acumulador.nonzeroCount, 2);
  assert.equal(fonteAgregada(acumulador.fontes), "mista");
});

test("histórico de operações sem data_referencia usa o início executado", () => {
  assert.equal(
    chaveDataDdmx(null, { inicio_executado: "18/09/2026 10:33:59", fim_executado: "18/09/2026 21:01:58" }),
    "2026-09-18",
  );
  assert.equal(chaveDataDdmx(null, { inicio_executado: "---", inicio_planejado: "04/09/2026 09:00:00" }), "2026-09-04");
  assert.equal(chaveDataDdmx("2026-09-11", { inicio_executado: "01/01/2026 00:00:00" }), "2026-09-11");
});

test("bolha com DDMX presente ignora o SELIMP antigo", () => {
  assert.deepEqual(escolherPercentualOperacional(100, 0, { bolha: true }), { percentual: 0, fonte: "ddmx" });
  assert.deepEqual(escolherPercentualOperacional(100, null, { bolha: true }), { percentual: 100, fonte: "selimp" });
});

test("setor do dia fica com o maior percentual, não com a média", () => {
  assert.equal(
    percentualDoDia(
      [{ percentual: 100 }, { percentual: 0 }, { percentual: 0 }, { percentual: 0 }, { percentual: 0 }, { percentual: 0 }],
      false,
    ),
    100,
  );
  assert.equal(percentualDoDia([{ percentual: 90 }, { percentual: 0 }], false), 90);
});

test("LF com seis veículos usa a linha de 100% e grava 100%", () => {
  const linhas = [
    { percentual: 100 },
    { percentual: 0 },
    { percentual: 0 },
    { percentual: 0 },
    { percentual: 0 },
    { percentual: 0 },
  ];
  assert.equal(percentualDoDia(linhas, true), 100);
});

test("bolha converte a linha vencedora pela permanência", () => {
  const inicio = new Date("2026-09-11T08:00:00.000Z");
  const acima = new Date("2026-09-11T08:20:00.000Z");
  const abaixo = new Date("2026-09-11T08:10:00.000Z");

  assert.equal(ajustarPercentualBolha(13.33, inicio, acima), 100);
  assert.equal(ajustarPercentualBolha(13.33, inicio, abaixo), 0);
  assert.equal(ajustarPercentualBolha(26.67, inicio, null), 100);
  assert.equal(ajustarPercentualBolha(null, null, null), 0);
  assert.equal(ajustarPercentualBolha(95, null, null), 100);

  assert.equal(
    percentualDoDia(
      [
        { percentual: 13.33, inicio, fim: abaixo },
        { percentual: 13.33, inicio, fim: acima },
      ],
      true,
    ),
    100,
  );
  assert.equal(percentualDoDia([{ percentual: 13.33, inicio, fim: abaixo }], true), 0);
});

test("blend do IPT recebe um percentual por plano e dia", () => {
  const porPlano = maximosDiariosPorPlano([
    { plano: "CV20406LF0022", dia: "2026-09-18", percentual: 1 },
    { plano: "CV20406LF0022", dia: "2026-09-18", percentual: 0 },
    { plano: "CV20406LF0022", dia: "2026-09-11", percentual: 0.1333 },
  ]);
  const valores = porPlano.get("CV20406LF0022") ?? [];
  assert.equal(valores.length, 2);
  assert.equal(Math.max(...valores), 1);
  assert.ok(valores.includes(0.1333));
});
