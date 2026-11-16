import test from "node:test";
import assert from "node:assert/strict";
import { agruparDespachosDdmx, resumoPorServicoDdmx, serieDiariaDdmx } from "./ddmx-diario.js";

const linha = (rota: string, data: string, pct: number) => ({
  setor: rota,
  data_referencia: data,
  raw: { rota, percentual_execucao: pct },
});

test("1 despacho por plano/dia = maior linha do dia; acumulado com e sem zerados", () => {
  const desp = agruparDespachosDdmx(
    [
      linha("CV10101VJ0001", "2026-10-01", 80),
      linha("CV10101VJ0001", "2026-10-01", 100),
      linha("CV10101VJ0002", "2026-10-01", 0),
      linha("CV10101VJ0001", "2026-10-02", 60),
      linha("CV10101VJ0001", "2026-11-02", 60),
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(desp.length, 3);
  const serie = serieDiariaDdmx(desp);
  assert.equal(serie.length, 2);
  assert.equal(serie[0].despachos, 2);
  assert.equal(serie[0].zerados, 1);
  assert.equal(serie[0].percentualDia, 50);
  assert.equal(serie[0].percentualDiaSemZerados, 100);
  assert.equal(serie[1].percentualAcumulado, 53.33);
  assert.equal(serie[1].despachosAcumulados, 3);
  const resumo = resumoPorServicoDdmx(desp);
  assert.equal(resumo[0].despachos, 3);
  assert.equal(resumo[0].abaixo80, 2); // 0% e 60%
});

test("serviço bolha aplica regra de permanência (>15 min vira 100%)", () => {
  const desp = agruparDespachosDdmx(
    [
      { setor: "CV10101LF0001", data_referencia: "2026-10-05", raw: { rota: "CV10101LF0001", percentual_execucao: 20, data_inicio: "05/10/2026 08:00", data_fim: "05/10/2026 08:30" } },
      { setor: "CV10101LF0002", data_referencia: "2026-10-05", raw: { rota: "CV10101LF0002", percentual_execucao: 20, data_inicio: "05/10/2026 08:00", data_fim: "05/10/2026 08:05" } },
    ],
    "2026-10-01",
    "2026-10-31",
  );
  const pcts = desp.map((d) => d.percentual).sort();
  assert.deepEqual(pcts, [0, 100]);
});

test("linha fantasma desatualizada não esconde a leitura válida de bateria do dia", () => {
  const [d] = agruparDespachosDdmx(
    [
      { setor: "CV10101VJ0003", data_referencia: "2026-10-05", raw: { rota: "CV10101VJ0003", percentual_execucao: 0, bateria: "3.6v", data_inicio: "---", data_final: "05/10/2026 23:30:01" } },
      { setor: "CV10101VJ0003", data_referencia: "2026-10-05", raw: { rota: "CV10101VJ0003", percentual_execucao: 100, bateria: "11.2v", data_inicio: "05/10/2026 06:00", data_final: "05/10/2026 10:00", data_ultima_comunicacao_do_modulo: "06/10/2026 08:00:00" } },
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(d.bateriaDesatualizada, false);
  assert.equal(d.bateriaRaw, "11.2v");
  assert.equal(d.ultimaComunicacao, "06/10/2026 08:00:00");
});
