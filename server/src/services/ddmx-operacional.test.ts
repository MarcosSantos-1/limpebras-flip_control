import assert from "node:assert/strict";
import test from "node:test";
import {
  adicionarFallbackOperacional,
  criarAcumuladorExecucao,
  despachoOperacionalPresente,
  escolherPercentualOperacional,
  extrairPercentualDdmx,
  fonteAgregada,
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
