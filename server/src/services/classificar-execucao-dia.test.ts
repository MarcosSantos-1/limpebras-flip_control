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

test("percentual baixo sem bateria desatualizada ou zerada é execução", () => {
  assert.equal(classificarExecucaoDia(dia()).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 74.9 })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ selimp: null })).classe, "execucao");
  const baixa = classificarExecucaoDia(dia({
    selimp: { media_percentual: 12, desatualizadas: 0, troca: true, em_manutencao: true, manutencao_realizada: true },
  }));
  assert.equal(baixa.classe, "execucao");
  assert.equal(baixa.bateria_selimp, false);
});

test("bateria desatualizada ou zerada é problema de bateria SELIMP", () => {
  const desatualizada = classificarExecucaoDia(dia({
    selimp: { media_percentual: 64, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(desatualizada.classe, "execucao");
  assert.equal(desatualizada.bateria_selimp, true);

  const zerada = classificarExecucaoDia(dia({
    percentualDdmx: 96,
    selimp: { media_percentual: 40, min_percentual: 0, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(zerada.classe, null);
  assert.equal(zerada.bateria_selimp, true);
  assert.equal(zerada.bateria_ddmx, false);
});

test("bateria DDMX zerada ou desatualizada só conta na varrição", () => {
  const zerada = { media_percentual: 0, desatualizadas: 0 };
  const fora = classificarExecucaoDia(dia({ varricao: false, ddmxBateria: zerada }));
  assert.equal(fora.classe, "execucao");
  assert.equal(fora.bateria_ddmx, false);

  const dentro = classificarExecucaoDia(dia({ varricao: true, ddmxBateria: zerada }));
  assert.equal(dentro.classe, "execucao");
  assert.equal(dentro.bateria_ddmx, true);
  assert.equal(dentro.bateria_selimp, false);

  const desatualizada = classificarExecucaoDia(dia({
    percentualDdmx: 90,
    varricao: true,
    ddmxBateria: { media_percentual: 80, desatualizadas: 2 },
  }));
  assert.equal(desatualizada.classe, null);
  assert.equal(desatualizada.bateria_ddmx, true);

  const baixa = classificarExecucaoDia(dia({ varricao: true, ddmxBateria: { media_percentual: 12, desatualizadas: 0 } }));
  assert.equal(baixa.classe, "execucao");
  assert.equal(baixa.bateria_ddmx, false);
});

test("as duas fontes podem marcar o mesmo dia", () => {
  const r = classificarExecucaoDia(dia({
    varricao: true,
    selimp: { media_percentual: 0, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
    ddmxBateria: { media_percentual: 50, desatualizadas: 1 },
  }));
  assert.equal(r.classe, "execucao");
  assert.equal(r.bateria_selimp, true);
  assert.equal(r.bateria_ddmx, true);
});

test("bateria desatualizada ou zerada conta mesmo com execução alta", () => {
  const selimp = classificarExecucaoDia(dia({
    percentualDdmx: 97.74,
    selimp: { media_percentual: 74, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(selimp.classe, null);
  assert.equal(selimp.bateria_selimp, true);
  assert.equal(selimp.bateria_ddmx, false);

  const ddmx = classificarExecucaoDia(dia({
    percentualDdmx: 100,
    varricao: true,
    ddmxBateria: { media_percentual: 90, min_percentual: 9.9, desatualizadas: 0 },
  }));
  assert.equal(ddmx.classe, null);
  assert.equal(ddmx.bateria_ddmx, false);
});

test("contestação não muda a classe automática", () => {
  const contestacoes = new Set(["MOD-1|2026-10-26"]);
  assert.equal(contestadoNoDia(["MOD-1"], "2026-10-26", contestacoes), true);
  assert.equal(contestadoNoDia(["MOD-2"], "2026-10-26", contestacoes), false);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 20 })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90 })).classe, null);
});
