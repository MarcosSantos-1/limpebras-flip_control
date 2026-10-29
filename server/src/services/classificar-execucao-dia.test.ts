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

const bateriaValida = { media_percentual: 80, desatualizadas: 0, com_sinal_e_bateria: true };

test("percentual acima de 80% ou sem despacho DDMX não classifica", () => {
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 80, ddmxBateria: bateriaValida })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 80.01, ddmxBateria: bateriaValida })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90, ddmxBateria: bateriaValida })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ despachosDdmx: 0, percentualDdmx: 10, ddmxBateria: bateriaValida })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: null, ddmxBateria: bateriaValida })).classe, null);
});

test("percentual baixo sem bateria DDMX com sinal não é execução", () => {
  assert.equal(classificarExecucaoDia(dia()).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 74.9 })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ selimp: null })).classe, null);
  assert.equal(
    classificarExecucaoDia(dia({ ddmxBateria: { media_percentual: 80, desatualizadas: 0, com_sinal_e_bateria: false } })).classe,
    null,
  );
  assert.equal(
    classificarExecucaoDia(dia({ ddmxBateria: { media_percentual: 5, desatualizadas: 2, com_sinal_e_bateria: false } })).classe,
    null,
  );
});

test("percentual baixo com bateria DDMX não desatualizada e com sinal é execução, mesmo a 5%", () => {
  assert.equal(classificarExecucaoDia(dia({ varricao: true, ddmxBateria: bateriaValida })).classe, "execucao");
  assert.equal(
    classificarExecucaoDia(dia({
      percentualDdmx: 74.9,
      varricao: true,
      ddmxBateria: { media_percentual: 5, min_percentual: 5, desatualizadas: 0, com_sinal_e_bateria: true },
    })).classe,
    "execucao",
  );
  const baixa = classificarExecucaoDia(dia({
    varricao: true,
    ddmxBateria: bateriaValida,
    selimp: { media_percentual: 12, desatualizadas: 0, troca: true, em_manutencao: true, manutencao_realizada: true },
  }));
  assert.equal(baixa.classe, "execucao");
  assert.equal(baixa.bateria_selimp, false);
});

test("só bateria desatualizada é problema de bateria SELIMP", () => {
  const desatualizada = classificarExecucaoDia(dia({
    selimp: { media_percentual: 64, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(desatualizada.classe, null);
  assert.equal(desatualizada.bateria_selimp, true);

  const zerada = classificarExecucaoDia(dia({
    percentualDdmx: 96,
    selimp: { media_percentual: 40, min_percentual: 0, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(zerada.classe, null);
  assert.equal(zerada.bateria_selimp, false);
  assert.equal(zerada.bateria_ddmx, false);
});

test("bateria DDMX desatualizada só conta na varrição e não vira execução", () => {
  const zerada = { media_percentual: 0, desatualizadas: 0, com_sinal_e_bateria: true };
  const fora = classificarExecucaoDia(dia({ varricao: false, ddmxBateria: zerada }));
  assert.equal(fora.classe, "execucao");
  assert.equal(fora.bateria_ddmx, false);

  const dentro = classificarExecucaoDia(dia({ varricao: true, ddmxBateria: zerada }));
  assert.equal(dentro.classe, "execucao");
  assert.equal(dentro.bateria_ddmx, false);
  assert.equal(dentro.bateria_selimp, false);

  const desatualizada = classificarExecucaoDia(dia({
    percentualDdmx: 40,
    varricao: true,
    ddmxBateria: { media_percentual: 80, desatualizadas: 2, com_sinal_e_bateria: false },
  }));
  assert.equal(desatualizada.classe, null);
  assert.equal(desatualizada.bateria_ddmx, true);

  const baixa = classificarExecucaoDia(dia({
    varricao: true,
    ddmxBateria: { media_percentual: 12, desatualizadas: 0, com_sinal_e_bateria: true },
  }));
  assert.equal(baixa.classe, "execucao");
  assert.equal(baixa.bateria_ddmx, false);
});

test("desatualizada e execução podem marcar o mesmo dia", () => {
  const r = classificarExecucaoDia(dia({
    varricao: true,
    selimp: { media_percentual: 40, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
    ddmxBateria: { media_percentual: 5, desatualizadas: 1, com_sinal_e_bateria: true },
  }));
  assert.equal(r.classe, "execucao");
  assert.equal(r.bateria_selimp, true);
  assert.equal(r.bateria_ddmx, true);
});

test("bateria desatualizada conta mesmo com execução alta; percentual baixo não", () => {
  const selimp = classificarExecucaoDia(dia({
    percentualDdmx: 97.74,
    ddmxBateria: bateriaValida,
    selimp: { media_percentual: 74, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
  }));
  assert.equal(selimp.classe, null);
  assert.equal(selimp.bateria_selimp, true);
  assert.equal(selimp.bateria_ddmx, false);

  const ddmx = classificarExecucaoDia(dia({
    percentualDdmx: 100,
    varricao: true,
    ddmxBateria: { media_percentual: 90, min_percentual: 9.9, desatualizadas: 0, com_sinal_e_bateria: true },
  }));
  assert.equal(ddmx.classe, null);
  assert.equal(ddmx.bateria_ddmx, false);
});

test("contestação não muda a classe automática", () => {
  const contestacoes = new Set(["MOD-1|2026-10-26"]);
  assert.equal(contestadoNoDia(["MOD-1"], "2026-10-26", contestacoes), true);
  assert.equal(contestadoNoDia(["MOD-2"], "2026-10-26", contestacoes), false);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 20, varricao: true, ddmxBateria: bateriaValida })).classe, "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 20 })).classe, null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90, ddmxBateria: bateriaValida })).classe, null);
});
