import assert from "node:assert/strict";
import test from "node:test";
import { calcularMediaIfPorSubprefeitura, calcularPercentualIfSub } from "./ifBfs.js";

test("subprefeitura sem BFS entra como 100% no IF", () => {
  assert.equal(calcularPercentualIfSub(0, 0), 100);
});

test("subprefeitura com BFS usa o resultado real das vistorias", () => {
  assert.equal(calcularPercentualIfSub(2, 2), 100);
  assert.equal(calcularPercentualIfSub(2, 1), 50);
  assert.equal(calcularPercentualIfSub(1, 0), 0);
});

test("média mantém as quatro subs e atribui 100% à sub sem vistoria", () => {
  const media = calcularMediaIfPorSubprefeitura({
    JT: { total: 10, sem_irregularidade: 10 },
    CV: { total: 0, sem_irregularidade: 0 },
    ST: { total: 10, sem_irregularidade: 8 },
    MG: { total: 10, sem_irregularidade: 9 },
  });

  assert.equal(media, 92.5);
});
