import test from "node:test";
import assert from "node:assert/strict";
import { avaliarTrocaDdmx, leiturasDiariasModulo, motivoTrocaDdmx, statusBateriaDdmx, type LeituraDdmx } from "./ddmx-trocas.js";

const l = (data: string, bateria: number | null, desatualizada = false, plano = "CV10101VJ0001"): LeituraDdmx => ({
  data,
  plano,
  bateria,
  bateriaRaw: null,
  desatualizada,
  ultimaComunicacao: null,
  percentualExecucao: null,
});

test("status DDMX usa as faixas da CLIMP", () => {
  assert.equal(statusBateriaDdmx(null), "SEM LEITURA");
  assert.equal(statusBateriaDdmx({ bateria: 90, desatualizada: true }), "DESATUALIZADA");
  assert.equal(statusBateriaDdmx({ bateria: 71, desatualizada: false }), "ALTA");
  assert.equal(statusBateriaDdmx({ bateria: 31, desatualizada: false }), "REGULAR");
  assert.equal(statusBateriaDdmx({ bateria: 16, desatualizada: false }), "BAIXA");
  assert.equal(statusBateriaDdmx({ bateria: 15, desatualizada: false }), "CRÍTICA");
  assert.equal(motivoTrocaDdmx("DESATUALIZADA"), "Corretiva");
  assert.equal(motivoTrocaDdmx("CRÍTICA"), "Preventiva");
  assert.equal(motivoTrocaDdmx("ALTA"), "Desnecessária");
});

test("sucesso da troca DDMX vem da primeira leitura em dia posterior", () => {
  const leituras = [l("2026-11-10", 10), l("2026-11-11", 20), l("2026-11-12", 88)];
  assert.equal(avaliarTrocaDdmx("2026-11-11", leituras).sucesso, true);
  assert.equal(avaliarTrocaDdmx("2026-11-10", leituras).sucesso, false);
  assert.equal(avaliarTrocaDdmx("2026-11-12", leituras).sucesso, null);
  assert.equal(avaliarTrocaDdmx("2026-11-11", [l("2026-11-12", 90, true)]).sucesso, false);
  assert.equal(avaliarTrocaDdmx("2026-11-12", leituras, true).sucesso, true);
});

test("leitura diária do módulo prefere a leitura válida entre setores", () => {
  const d = leiturasDiariasModulo([l("2026-11-10", 5, true, "A"), l("2026-11-10", 40, false, "B"), l("2026-11-09", 70, false, "A")]);
  assert.deepEqual(d.map((x) => [x.data, x.bateria, x.desatualizada]), [["2026-11-09", 70, false], ["2026-11-10", 40, false]]);
});

test("despacho de hoje em andamento (desatualizado) não vira leitura", async () => {
  const { semDiaEmAndamento } = await import("./ddmx-trocas.js");
  const r = semDiaEmAndamento([l("2026-11-15", 80), l("2026-11-16", 90, true), l("2026-11-14", 5, true)], "2026-11-16");
  assert.deepEqual(r.map((x) => x.data), ["2026-11-15", "2026-11-14"]);
  assert.equal(statusBateriaDdmx(r[0]), "ALTA");
});
