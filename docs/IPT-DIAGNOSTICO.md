# Diagnóstico IPT (DDMX vs SELIMP)

## Resumo
Este doc lista pontos críticos que podem explicar: (1) DDMX não aparecendo na tabela; (2) SELIMP zerada; (3) cruzamento impreciso plano/setor.

---

## 1. CRÍTICO: record_key sobrescreve múltiplos despachos (DDMX)

**Onde:** `server/src/services/parseIptXlsx.ts` → `buildRecordKey` + `upload.ts` → `ON CONFLICT (file_type, record_key) DO UPDATE`

**Problema:** Para DDMX, `record_key = rota|data` (ex: `CV10500GO0015|2025-03-01`). Dois despachos na mesma rota no mesmo dia geram a mesma chave → só o último fica no banco.

**Impacto:** Perda de dados DDMX. Vários despachos viram um.

**Correção:** Usar chave única por linha (ex: hash do conteúdo da linha) para DDMX.

---

## 2. Data de referência nula em DDMX

**Onde:** `parseIptXlsx` (dateAliases) e `indicadores.ts` (extractRawDate)

**Problemas:**
- Se a planilha DDMX tiver coluna "Data" em vez de "Data_Planejado", o parse usa `dateAliases` que não inclui "data" para DDMX (só data_planejado, data_criacao, etc.).
- Quando `data_referencia` é nula no insert, `record_key` vira só `rota` → TODAS as linhas da mesma rota colidem e sobrescrevem.
- O `extractRawDate` em indicadores não checa `data_inicio` e `data_final`, usados nos dateAliases do DDMX.

**Impacto:** Datas erradas/nulas → registro perdido ou associado ao dia errado.

**Correção:** Incluir "data" nos dateAliases do DDMX e `data_inicio`/`data_final` no extractRawDate.

---

## 3. Filtro "dia_anterior" esconde planos com dados

**Onde:** `indicadores.ts` linhas 1175–1190

**Problema:** No modo "dia anterior", só entra na tabela o que `isExpectedOnDate(plano, ontem)` retorna true. Isso depende de:
- Cronograma (`ipt_cronograma`) com datas previstas
- Ou `isFrequencyDate` (ex: seg/qua/sex para 0202)

Se um plano tem despacho DDMX ontem mas não está no cronograma ou a frequência não bate com ontem, ele é ocultado.

**Impacto:** Planos com DDMX podem não aparecer no dia anterior.

**Correção:** Ao filtrar, incluir planos que tenham despacho (SELIMP ou DDMX) no período, mesmo que não estejam no cronograma.

---

## 4. Cruzamento plano/rota: SELIMP vs DDMX

**SELIMP:** usa `raw.plano`  
**DDMX:** usa `raw.rota ?? raw.plano`

Os formatos precisam ser compatíveis (ex: `CV10500GO0015`). Se DDMX usar `setor` e SELIMP `plano`, e os valores forem diferentes, não cruzam.

**Verificar:** Os exports DDMX e SELIMP usam o mesmo padrão de setor (ex: CV10500GO0015)?

---

## 5. Timezone em datas

**Onde:** `toDateKey` usa `d.toISOString().slice(0,10)` (UTC).

**Problema:** Datas em horário local (ex: 01/03/2025 22:00 BRT) podem virar dia seguinte em UTC e cair fora do período esperado.

---

## 6. Queries para conferir no Neon

```sql
-- Total por tipo de importação
SELECT file_type, COUNT(*) AS total, MAX(updated_at) AS ultimo
FROM ipt_imports
GROUP BY file_type;

-- DDMX: últimos registros (ver se data_referencia está preenchida)
SELECT file_type, setor, data_referencia, raw->>'rota' AS rota, raw->>'percentual_execucao' AS pct, updated_at
FROM ipt_imports
WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores')
ORDER BY updated_at DESC
LIMIT 20;

-- SELIMP: últimos registros
SELECT file_type, setor, data_referencia, raw->>'plano' AS plano, raw->>'de_execucao' AS pct, raw->>'status' AS status, updated_at
FROM ipt_imports
WHERE file_type = 'ipt_report_selimp'
ORDER BY updated_at DESC
LIMIT 20;

-- Colisões de record_key (múltiplas linhas com mesma chave lógica)
-- Se houver muitos inserts e poucos record_keys distintos, há sobrescrita
SELECT file_type, record_key, COUNT(*) AS cnt
FROM ipt_imports
WHERE file_type IN ('ipt_historico_os', 'ipt_historico_os_varricao', 'ipt_historico_os_compactadores')
GROUP BY file_type, record_key
HAVING COUNT(*) > 1;
-- (Não deve retornar nada por causa do UNIQUE, mas podemos ver quantos record_keys únicos vs total de linhas que foram importadas)
```

---

## 7. Próximos passos sugeridos

1. Rodar as queries no Neon e conferir contagens e datas.
2. Ajustar `buildRecordKey` para DDMX usar hash por linha.
3. Incluir "data" nos dateAliases do DDMX e data_inicio/data_final no extractRawDate.
4. Revisar o filtro do dia anterior para incluir planos com despacho mesmo fora do cronograma.
5. Confirmar o formato do setor nas planilhas DDMX (rota/setor) vs SELIMP (plano).
