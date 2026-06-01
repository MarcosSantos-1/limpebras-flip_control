import {
  isEmptyDispatchDate,
  parseDdmxBateriaFromRaw,
  parseDdmxBateriaVolts,
  summarizeDdmxBateriaDia,
} from "./parseDdmxBateria.js";

let ok = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown, tol = 0.01) {
  const pass =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= tol
      : actual === expected;
  console.log(`  [${pass ? "OK" : "FAIL"}] ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  pass ? ok++ : fail++;
}

console.log("\n— parseDdmxBateriaVolts");
check("0.99v → 0%", parseDdmxBateriaVolts("0.99v").percentual, 0);
check("1v → 0%", parseDdmxBateriaVolts("1v").percentual, 0);
check("1.1v → ~1%", parseDdmxBateriaVolts("1.1v").percentual, 0.91, 0.05);
check("1.15v → ~1.4%", parseDdmxBateriaVolts("1.15v").percentual, 1.37, 0.05);
check("1.175v → ~1.6%", parseDdmxBateriaVolts("1.175v").percentual, 1.6, 0.05);
check("1.2v → ~1.8%", parseDdmxBateriaVolts("1.2v").percentual, 1.82, 0.05);
check("3.6v → ~24%", parseDdmxBateriaVolts("3.6v").percentual, 23.4, 0.1);
check("11.8v → 90%", parseDdmxBateriaVolts("11.8v").percentual, 90);
check("11.9v → 90%", parseDdmxBateriaVolts("11.9v").percentual, 90);
check("vazio → null", parseDdmxBateriaVolts("").percentual, null);

console.log("\n— isEmptyDispatchDate");
check("'---' vazio", isEmptyDispatchDate("---"), true);
check("data preenchida", isEmptyDispatchDate("28/05/2026 05:58:05"), false);

console.log("\n— parseDdmxBateriaFromRaw desatualizada");
const desatInicio = parseDdmxBateriaFromRaw({
  data_inicio: "---",
  data_final: "28/05/2026 08:00:00",
  bateria: "1.175v",
});
check("inicio vazio → desatualizada", desatInicio.bateria_desatualizada, true);
check("percentual mesmo desatualizada", desatInicio.bateria_percentual, 1.6, 0.05);

const okDates = parseDdmxBateriaFromRaw({
  data_inicio: "28/05/2026 05:58:05",
  data_final: "28/05/2026 08:00:00",
  bateria: "11.9v",
});
check("datas ok → não desatualizada", okDates.bateria_desatualizada, false);
check("11.9v percentual", okDates.bateria_percentual, 90);

console.log("\n— summarizeDdmxBateriaDia");
const summary = summarizeDdmxBateriaDia([
  {
    rota: "CV10203VJ0055",
    bateria_raw: "1.175v",
    bateria_percentual: 1.6,
    bateria_desatualizada: true,
    ultima_comunicacao: null,
  },
  {
    rota: "CV10302VJ0012",
    bateria_raw: "11.8v",
    bateria_percentual: 90,
    bateria_desatualizada: false,
    ultima_comunicacao: null,
  },
]);
check("total despachos", summary?.total, 2);
check("desatualizadas", summary?.desatualizadas, 1);
check("media percentual", summary?.media_percentual, 45.8, 0.05);

console.log(`\n${ok} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
