import test from "node:test";
import assert from "node:assert/strict";
import { agruparDespachosDdmx, resumoPorServicoDdmx, serieDiariaDdmx } from "./ddmx-diario.js";

const linha = (rota: string, data: string, pct: number) => ({
  setor: rota,
  data_referencia: data,
  raw: { rota, percentual_execucao: pct },
});

test("agrupa DDMX por plano/dia e calcula acumulado com e sem zerados", () => {
  const desp = agruparDespachosDdmx(
    [
      linha("CV1010101VJ0001", "2026-10-01", 80),
      linha("CV1010101VJ0001", "2026-10-01", 100),
      linha("CV1010101VJ0002", "2026-10-01", 0),
      linha("CV1010101VJ0001", "2026-10-02", 60),
      linha("CV1010101VJ0001", "2026-11-02", 60),
    ],
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(desp.length, 3);
  const serie = serieDiariaDdmx(desp);
  assert.equal(serie.length, 2);
  assert.equal(serie[0].despachos, 2);
  assert.equal(serie[0].zerados, 1);
  assert.equal(serie[0].percentualDia, 45);
  assert.equal(serie[0].percentualDiaSemZerados, 90);
  assert.equal(serie[1].percentualAcumulado, 50);
  assert.equal(serie[1].despachosAcumulados, 3);
  const resumo = resumoPorServicoDdmx(desp);
  assert.equal(resumo[0].despachos, 3);
  assert.equal(resumo[0].abaixo80, 2);
});
