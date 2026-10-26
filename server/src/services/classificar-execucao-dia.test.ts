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
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 75 })), null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90 })), null);
  assert.equal(classificarExecucaoDia(dia({ despachosDdmx: 0, percentualDdmx: 10 })), null);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: null })), null);
});

test("percentual baixo sem troca nem interferência é execução", () => {
  assert.equal(classificarExecucaoDia(dia()), "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 74.9 })), "execucao");
  assert.equal(classificarExecucaoDia(dia({ selimp: null })), "execucao");
});

test("troca, manutenção, bateria baixa ou desatualizada viram problema de bateria", () => {
  assert.equal(
    classificarExecucaoDia(dia({
      selimp: { media_percentual: 90, desatualizadas: 0, troca: true, em_manutencao: false, manutencao_realizada: false },
    })),
    "bateria",
  );
  assert.equal(
    classificarExecucaoDia(dia({
      selimp: { media_percentual: 90, desatualizadas: 0, troca: false, em_manutencao: true, manutencao_realizada: false },
    })),
    "bateria",
  );
  assert.equal(
    classificarExecucaoDia(dia({
      selimp: { media_percentual: 90, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: true },
    })),
    "bateria",
  );
  assert.equal(
    classificarExecucaoDia(dia({
      selimp: { media_percentual: 30, desatualizadas: 0, troca: false, em_manutencao: false, manutencao_realizada: false },
    })),
    "bateria",
  );
  assert.equal(
    classificarExecucaoDia(dia({
      selimp: { media_percentual: 31, desatualizadas: 1, troca: false, em_manutencao: false, manutencao_realizada: false },
    })),
    "bateria",
  );
});

test("bateria DDMX baixa só interfere na varrição", () => {
  const ddmxBaixa = { media_percentual: 12, desatualizadas: 0 };
  assert.equal(classificarExecucaoDia(dia({ varricao: false, ddmxBateria: ddmxBaixa })), "execucao");
  assert.equal(classificarExecucaoDia(dia({ varricao: true, ddmxBateria: ddmxBaixa })), "bateria");
  assert.equal(
    classificarExecucaoDia(dia({ varricao: true, ddmxBateria: { media_percentual: 80, desatualizadas: 2 } })),
    "bateria",
  );
  assert.equal(
    classificarExecucaoDia(dia({ varricao: true, ddmxBateria: { media_percentual: 80, desatualizadas: 0 } })),
    "execucao",
  );
});

test("contestação não muda a classe automática", () => {
  const contestacoes = new Set(["MOD-1|2026-10-26"]);
  assert.equal(contestadoNoDia(["MOD-1"], "2026-10-26", contestacoes), true);
  assert.equal(contestadoNoDia(["MOD-2"], "2026-10-26", contestacoes), false);
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 20 })), "execucao");
  assert.equal(classificarExecucaoDia(dia({ percentualDdmx: 90 })), null);
});
