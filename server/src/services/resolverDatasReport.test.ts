import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseIptWorkbook } from "./parseIptXlsx.js";
import {
  extrairDataPlanejadaRaw,
  isDespachoEsperado,
  parseDataPlanejadaRaw,
} from "./resolverDatasReport.js";

test("parseDataPlanejadaRaw interpreta dd/mm/yyyy com hora", () => {
  assert.equal(parseDataPlanejadaRaw("29/05/2026 06:00:00"), "2026-05-29");
  assert.equal(parseDataPlanejadaRaw("29/05/2026"), "2026-05-29");
});

test("extrairDataPlanejadaRaw usa coluna data_planejada canonicalizada", () => {
  assert.equal(
    extrairDataPlanejadaRaw({ data_planejada: "29/05/2026 06:00:00" }),
    "2026-05-29"
  );
  assert.equal(extrairDataPlanejadaRaw({ plano: "CV10101VJ0001" }), null);
});

test("isDespachoEsperado: terca e sexta esperadas para freq 0303", () => {
  const cronograma = new Map<string, string[]>();
  assert.equal(isDespachoEsperado("ST10303VJ0041", "2026-05-26", cronograma), true); // terca
  assert.equal(isDespachoEsperado("ST10303VJ0041", "2026-05-29", cronograma), true); // sexta
  assert.equal(isDespachoEsperado("ST10303VJ0041", "2026-05-27", cronograma), false); // quarta
  assert.equal(isDespachoEsperado("ST10303VJ0041", "2026-05-25", cronograma), false); // segunda
});

test("isDespachoEsperado: data no cronograma cadastrado", () => {
  const cronograma = new Map<string, string[]>([["CV10500GO0015", ["2026-05-15"]]]);
  assert.equal(isDespachoEsperado("CV10500GO0015", "2026-05-15", cronograma), true);
  assert.equal(isDespachoEsperado("CV10500GO0015", "2026-05-16", cronograma), false);
});

test("parseIptWorkbook reconhece header Data planejada no report SELIMP", () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["", "Relatório de Histórico de Execução"],
    [],
    ["Status", "Plano", "Data planejada", "subPrefeitura", "Tipo de serviço", "% de execução", "Equipamentos"],
    ["Encerrado", "ST10303VJ0041-2026", "29/05/2026 06:00:00", "Santana/Tucuruvi", "Varrição manual", "100%", "MOD-1"],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "Relatorio");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const rows = parseIptWorkbook(buffer, "ipt_report_selimp");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.raw?.data_planejada, "29/05/2026 06:00:00");
  assert.equal(rows[0]?.dataReferencia?.toISOString().slice(0, 10), "2026-05-29");
});
