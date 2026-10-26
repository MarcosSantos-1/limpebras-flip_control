import assert from "node:assert/strict";
import test from "node:test";
import {
  classificarExecucaoDia,
  contestadoNoDia,
  type ClassificarExecucaoDiaInput,
} from "./classificar-execucao-dia.js";

function dia(partial: Partial<ClassificarExecucaoDiaInput> = {}): ClassificarExecucaoDiaInput {
  return {
    percentualDdmx: 40,
    despachosDdmx: 1,
    varricao: false,
    selimp: {
      media_percentual: 80,
      desatualizadas: 0,
      troca: false,
      em_manutencao: false,
      manutencao_realizada: false,
    },
    ddmxBateria: null,
    ...partial,
  };
}

test("percentual em 75% ou sem despacho DDMX não classifica", () => {
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 75 })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90 })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ despachosDdmx: 0, percentualDdmx: 10 })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: null })).classe, null);
});

test("percentual baixo sem troca nem interferência é execução", () => {
  assert.equal(classificarExecucaoDia(dia()).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 74.9 })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ selimp: null })).classe, "execucao");
});

test("troca, manutenção, bateria baixa ou desatualizada viram problema de bateria SELIMP", () => {
  const casos = [
    { media_percentual: 90, desatualizadas: 0, troca: true, em_manutencao: false, manutencao_realizada: false },
    { media_percentual: 90, desatualizadas: 0, troca: false, em_manutencao: true, manutencao_realizada: false },
    { media_percentual: 90, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: true },
    { media_percentual: 30, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
    { media_percentual: 31, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
  ];
  for (const selimp of casos) {
    const r = classificarExecucaoDia(dia({ selimp }));
    assert.equal(r.classe, "bateria");
    assert.equal(r.bateria_selimp, true);
    assert.equal(r.bateria_ddmx, false);
  }
});

test("bateria DDMX baixa só interfere na varrição", () => {
  const ddmxBaixa = { media_percentual: 12, desatualizadas: 0 };
  const fora = classificarExecucaoDia(dia({ varricao: false, ddmxBateria: ddmxBaixa }));
  assert.equal(fora.classe, "execucao");
  assert.equal(fora.bateria_ddmx, false);

  const dentro = classificarExecucaoDia(dia({ varricao: true, ddmxBateria: ddmxBaixa }));
  assert.equal(dentro.classe, "bateria");
  assert.equal(dentro.bateria_ddmx, true);
  assert.equal(dentro.bateria_selimp, false);

  const desatualizada = classificarExecucaoDia(dia({
    varricao: true,
    ddmxBateria: { media_percentual: 80, desatualizadas: 2 },
  }));
  assert.equal(desatualizada.classe, "bateria");
  assert.equal(desatualizada.bateria_ddmx, true);

  const ok = classificarExecucaoDia(dia({ varricao: true, ddmxBateria: { media_percentual: 80, desatualizadas: 0 } }));
  assert.equal(ok.classe, "execucao");
});

test("as duas fontes podem marcar o mesmo dia", () => {
  const r = classificarExecucaoDia(dia({
    varricao: true,
    selimp: { media_percentual: 10, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
    ddmxBateria: { media_percentual: 12, desatualizadas: 0 },
  }));
  assert.equal(r.classe, "bateria");
  assert.equal(r.bateria_selimp, true);
  assert.equal(r.bateria_ddmx, true);
});

test("contestação não muda a classe automática", () => {
  const contestacoes = new Set(["MOD-1|2026-10-26"]);
  assert.equal(contestadoNoDia(["MOD-1"], "2026-10-26", contestacoes), true);
  assert.equal(contestadoNoDia(["MOD-2"], "2026-10-26", contestacoes), false);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 20 })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90 })).classe, null);
});
