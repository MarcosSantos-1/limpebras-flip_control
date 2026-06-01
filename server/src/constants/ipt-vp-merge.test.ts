import assert from "node:assert/strict";
import test from "node:test";
import {
  getVpMergeKey,
  registerVpCanonicalFromSelimp,
  resolveVpCanonicalFromDdmx,
} from "./ipt.js";

test("getVpMergeKey unifica SELIMP e DDMX com mesmo mapa", () => {
  assert.equal(getVpMergeKey("CV10202VP0014"), "CVVP0014");
  assert.equal(getVpMergeKey("CV10101VP0014"), "CVVP0014");
  assert.equal(getVpMergeKey("MG10202VP0045"), "MGVP0045");
  assert.equal(getVpMergeKey("MG10303VP0045-2026"), "MGVP0045");
});

test("getVpMergeKey retorna null para servicos que nao sao VP", () => {
  assert.equal(getVpMergeKey("CV10500GO0015"), null);
  assert.equal(getVpMergeKey("CV10302VM0002"), null);
});

test("registerVpCanonicalFromSelimp mantem primeiro plano SELIMP", () => {
  const registry = new Map<string, string>();

  assert.equal(registerVpCanonicalFromSelimp("CV10202VP0014", registry), "CV10202VP0014");
  assert.equal(registerVpCanonicalFromSelimp("CV10101VP0014", registry), "CV10202VP0014");
  assert.equal(registry.get("CVVP0014"), "CV10202VP0014");
});

test("resolveVpCanonicalFromDdmx mapeia para SELIMP sem sobrescrever (CV)", () => {
  const registry = new Map<string, string>();

  registerVpCanonicalFromSelimp("CV10202VP0014", registry);
  assert.equal(resolveVpCanonicalFromDdmx("CV10101VP0014", registry), "CV10202VP0014");
  assert.equal(registry.get("CVVP0014"), "CV10202VP0014");
});

test("resolveVpCanonicalFromDdmx mapeia para SELIMP sem sobrescrever (MG)", () => {
  const registry = new Map<string, string>();

  registerVpCanonicalFromSelimp("MG10303VP0045", registry);
  assert.equal(resolveVpCanonicalFromDdmx("MG10202VP0045", registry), "MG10303VP0045");
  assert.equal(registry.get("MGVP0045"), "MG10303VP0045");
});

test("resolveVpCanonicalFromDdmx mantem plano DDMX quando nao ha SELIMP", () => {
  const registry = new Map<string, string>();

  assert.equal(resolveVpCanonicalFromDdmx("CV10101VP0014", registry), "CV10101VP0014");
  assert.equal(registry.get("CVVP0014"), "CV10101VP0014");
});

test("register e resolve nao alteram planos de outros servicos", () => {
  const registry = new Map<string, string>();

  assert.equal(registerVpCanonicalFromSelimp("CV10500GO0015", registry), "CV10500GO0015");
  assert.equal(resolveVpCanonicalFromDdmx("CV10500GO0015", registry), "CV10500GO0015");
  assert.equal(registry.size, 0);
});
