import { calcularVariantesIpt, montarRespostaConservador, type Linha } from "./ipt-conservador.js";

let ok = 0, fail = 0;
function check(label: string, actual: any, expected: any, tol = 0.01) {
  const pass = typeof actual === "number" && typeof expected === "number"
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  console.log(`  [${pass ? "OK" : "FAIL"}] ${label}: actual=${actual} expected=${expected}`);
  pass ? ok++ : fail++;
}

console.log("\n— Caso 1: mês normal");
const c1: Linha[] = Array.from({ length: 3 }, (_, i) => i).flatMap((p) =>
  Array.from({ length: 4 }, () => ({ plano: `P${p}`, percentual: 1.0 }))
);
const r1 = calcularVariantesIpt(c1);
const f1 = (id: string) => r1.variantes.find((v) => v.id === id)?.percentual;
check("v1 = 100", f1("v1_oficial_atual"), 100);
check("v3 = 100", f1("v3_media_planos_com_zeros"), 100);
check("v4 = 100", f1("v4_media_linhas_com_zeros"), 100);
check("v7 = 100", f1("v7_combinado_calibrado"), 100);

console.log("\n— Caso 2: choque (1/3 zerados)");
const c2: Linha[] = [
  { plano: "A", percentual: 1.0 }, { plano: "A", percentual: 1.0 },
  { plano: "B", percentual: 0.0 }, { plano: "B", percentual: 0.0 },
  { plano: "C", percentual: 1.0 }, { plano: "C", percentual: 1.0 },
];
const r2 = calcularVariantesIpt(c2);
const f2 = (id: string) => r2.variantes.find((v) => v.id === id)?.percentual;
// v1 (zeros filtrados): qb=1.0, sigma=0, q=1, cob=1 -> 100
check("v1 zeros perdoados = 100", f2("v1_oficial_atual"), 100);
// v2 (zeros dentro): qb=(1+0+1)/3=0.6667; sigma=stdev(amostral)=0.5774; cap 0.08 -> q=0.7467; cob=1 -> 0.7*0.7467+0.3*1.0 = 0.8227 -> 82.27
check("v2 zeros dentro ≈ 82.27", f2("v2_pf_zeros_dentro"), 82.27, 0.5);
// v3: média planos = 2/3 = 0.6667 -> 66.67
check("v3 = 66.67", f2("v3_media_planos_com_zeros"), 66.67, 0.1);
// v4: média linhas = 4/6 = 0.6667 -> 66.67
check("v4 = 66.67", f2("v4_media_linhas_com_zeros"), 66.67, 0.1);
// v6: cob = 2/3, qb com zeros = 0.6667, sigma cap 0.08 -> q=0.7467; 0.7*0.7467+0.3*0.6667 = 0.5227+0.2 = 0.7227 -> 72.27
check("v6 ≈ 72.27", f2("v6_pf_cobertura_proxy"), 72.27, 0.5);
// v7 = 0.6*66.67 + 0.4*66.67 = 66.67
check("v7 = 66.67", f2("v7_combinado_calibrado"), 66.67, 0.1);
// v8: Q̄sem_zeros = média de [1,1,1,1] = 1.0; cob = 2/3 = 0.6667 → 66.67
check("v8 execução×cobertura ≈ 66.67", f2("v8_execucao_x_cobertura"), 66.67, 0.1);
check("planos zerados = 1", r2.diagnostico.planos_totalmente_zerados, 1);
check("pct planos zerados = 33.33", r2.diagnostico.pct_planos_zerados, 33.33, 0.1);

console.log("\n— Caso 3: zeros parciais (1 zero em 4)");
const c3: Linha[] = [
  { plano: "X", percentual: 0.0 }, { plano: "X", percentual: 1.0 },
  { plano: "X", percentual: 1.0 }, { plano: "X", percentual: 1.0 },
];
const r3 = calcularVariantesIpt(c3);
const f3 = (id: string) => r3.variantes.find((v) => v.id === id)?.percentual;
check("v3 = 75", f3("v3_media_planos_com_zeros"), 75, 0.1);
check("v4 = 75", f3("v4_media_linhas_com_zeros"), 75, 0.1);
check("pct linhas zeradas = 25", r3.diagnostico.pct_linhas_zeradas, 25);

console.log("\n— Caso 4: resposta final");
const resp = montarRespostaConservador({ inicio: "2026-04-01", fim: "2026-04-30", fonte: "test" }, c2);
console.log(`  risco_glosa=${resp.recomendacao.risco_glosa}  gap_pp=${resp.recomendacao.gap_pp}`);
check("risco = alto", resp.recomendacao.risco_glosa, "alto");
check("otimista id", resp.recomendacao.otimista, "v1_oficial_atual");
check("conservador id (agora V8)", resp.recomendacao.conservador, "v8_execucao_x_cobertura");

console.log(`\n=== Total: ${ok} OK, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
