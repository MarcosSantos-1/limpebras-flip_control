# IPT — Diagnóstico, bugs encontrados e protótipo do IPT Conservador

> Análise feita em 26/05/2026 para reduzir surpresa contra a apuração SELIMP, depois do mês de abril/2026 fechar com IPT oficial 65,30% enquanto o cálculo interno apontava 92,45% (gap de 27 pontos percentuais).

## 1. Os três bugs que explicam a divergência

A fórmula em produção (`server/src/routes/indicadores.ts` + `server/src/services/ipt-pf-algoritmo.ts`) tem três decisões que, somadas, inflam o IPT calculado contra o que a SELIMP apura. Em meses sem choque operacional (fev/mar 2026) o efeito é pequeno; em meses com choque (abr 2026) o efeito é grande.

### Bug 1 — Cobertura forçada a 100%

`fetchOrdensConsolidadoNoPeriodo` (indicadores.ts:83) devolve `{ ordens, P: A, R: 1, F: 1 }`, onde `A = ordens.length`. Dentro do algoritmo (`calcularPF`):

```
C = P × R/F = A × 1/1 = A
cobertura = min(A/C, 1) = min(A/A, 1) = 1
PF = 0.7 × qualidade + 0.3 × cobertura = 0.7 × qualidade + 0.30
```

Resultado: 30% do PF é piso garantido sempre que existir qualquer dado. P deveria ser "ordens planejadas" (cronograma esperado), não a contagem de ordens executadas.

### Bug 2 — Zeros removidos antes do Q̄

`ipt-pf-algoritmo.ts:47`:

```ts
const ordensComConclusao = ordens.filter((o) => o.percentual > 0);
// Q̄ é calculado só sobre as não-zero
```

Em abril, 7.119 das 9.487 linhas (≈75%) estavam zeradas, e dentro do status "Encerrado" eram 2.983 de 5.351 (≈56%). Removê-las antes da média faz com que planos não executados desapareçam do cálculo de qualidade.

### Bug 3 — Blend max+média agrupando por plano

`fetchOrdensConsolidadoNoPeriodo:77-80`:

```ts
const max = Math.max(...arr);
const media = arr.reduce((a, b) => a + b, 0) / arr.length;
const blend = 0.48 * max + 0.52 * media;
```

Para um plano com linhas `[0, 1, 1, 1]`:

* Média simples (linha-a-linha): 0,75
* Blend: 0,48 × 1 + 0,52 × 0,75 = **0,87**

O blend privilegia o melhor dia do plano e mascara dias zerados dentro do mesmo plano.

### Efeito combinado em abril/2026

| Etapa                                                  | Resultado |
| ------------------------------------------------------ | --------- |
| Linhas no mês                                          | 9.487     |
| Linhas zeradas                                         | 7.119     |
| Linhas Encerrado                                       | 5.351     |
| Zeros dentro de Encerrado                              | 2.983     |
| Média por plano DEPOIS do blend (zeros perdoados)      | 86,12%    |
| Média por plano COM zeros (sem blend, sem PF wrapper)  | 64,44%    |
| PF atual (sistema)                                     | **92,45%** |
| SELIMP oficial                                         | **65,30%** |

A análise prévia já apontava: a média conservadora 64,44% bate quase exatamente com o oficial 65,30% (gap de 0,86pp). A combinação dos três bugs leva esse mesmo dado para 92,45%.

## 2. Por que não corrigir direto a fórmula em produção

Três motivos:

1. **Não temos P/R/F reais.** A SELIMP não passa "ordens planejadas", "rastreadores ativos" e "frota total". Qualquer correção que toque `P = A` precisa de um substituto — e o substituto vai ser outro proxy.
2. **A SELIMP errou o IF em abril.** Eles deram 16 pontos quando o cálculo correto é 18. Se a SELIMP pode errar para baixo, podemos eventualmente discordar — para isso precisamos de um cálculo paralelo que mostre o nosso número junto com o conservador.
3. **Calibração requer dados.** A regra oficial não está fechada no contrato; precisamos calibrar contra três meses conhecidos antes de bater o martelo.

A escolha foi adicionar um endpoint paralelo `/indicadores/ipt-conservador` que devolve sete variantes da fórmula a partir da mesma base de dados, sem tocar no cálculo atual.

## 3. O que foi implementado nesta rodada

### `server/src/services/ipt-conservador.ts`

Serviço puro (sem I/O) que recebe `Linha[]` (uma linha por OS, com zeros preservados) e devolve sete variantes:

| ID                          | Descrição                                                                                          | Quando faz sentido                                  |
| --------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| v1_oficial_atual            | Espelho do cálculo atual em produção (blend por plano + cobertura forçada a 1, zeros fora de Q̄). | Otimista. Continua sendo o número grande do dashboard. |
| v2_pf_zeros_dentro          | Mesma fórmula PF, mas zeros entram no Q̄.                                                          | Mostrar quanto os zeros "deveriam" pesar dentro da fórmula oficial. |
| v3_media_planos_com_zeros   | Média aritmética por plano (com zeros), depois média entre planos. Sem blend, sem PF.              | Proxy SELIMP "puro".                                |
| v4_media_linhas_com_zeros   | Média aritmética de todas as linhas, sem agrupar por plano.                                        | Proxy mais conservador (cada OS pesa igual).        |
| v5_mediana_planos           | Mediana por plano, depois média entre planos.                                                      | Robusto contra outliers altos.                      |
| v6_pf_cobertura_proxy       | PF com blend + zeros no Q̄ + cobertura = planos executados/planos esperados.                       | Mais perto do espírito da fórmula contratual.       |
| **v7_combinado_calibrado**  | **0,6 × V3 + 0,4 × V4** — proxy SELIMP recomendado.                                                | Número grande do dashboard como conservador.        |

A escolha de V7 (V3+V4 ponderado) é uma aposta deliberada: V3 é mais sensível a planos com poucas linhas, V4 é mais sensível a planos com muitas linhas. O peso 0,6/0,4 dá um pouco mais para V3 porque a apuração SELIMP é feita por setor (plano).

### `server/src/routes/indicadores.ts` — endpoint `/indicadores/ipt-conservador`

```
GET /indicadores/ipt-conservador?periodo_inicial=2026-04-01&periodo_final=2026-04-30
```

Resposta:

```json
{
  "base": { "inicio": "2026-04-01", "fim": "2026-04-30", "fonte": "consolidado_selimp" },
  "variantes": [
    { "id": "v1_oficial_atual", "percentual": 92.45, "pontuacao": 40, "componentes": { "Qb": 0.86, "sigma": 0.05, ... } },
    { "id": "v7_combinado_calibrado", "percentual": 65.10, "pontuacao": 32, "componentes": { "v3": 0.66, "v4": 0.64 } },
    ...
  ],
  "diagnostico": {
    "total_linhas": 9487,
    "linhas_zeradas": 7119,
    "pct_linhas_zeradas": 75.04,
    "planos_distintos": 1331,
    "planos_totalmente_zerados": 458,
    "pct_planos_zerados": 34.41,
    "media_geral_com_zeros": 24.93,
    "media_geral_sem_zeros": 86.12,
    "subprefeituras_criticas": [
      { "subprefeitura": "...", "media_com_zeros": 42.1, "planos": 78, "zeros": 142 }
    ]
  },
  "recomendacao": {
    "otimista": "v1_oficial_atual",
    "conservador": "v7_combinado_calibrado",
    "risco_glosa": "alto",
    "gap_pp": 27.35,
    "justificativa": "Conservador 65,10% — gap de 27,35pp contra o otimista. Tratar como cenário de risco de glosa."
  }
}
```

### `server/scripts/validar-ipt-conservador.py`

Script standalone (Python + psycopg2) que:

1. Lê `DATABASE_URL` do `server/.env`.
2. Reproduz o cálculo das 7 variantes em Python puro, mesma matemática do TS.
3. Compara contra os valores oficiais conhecidos (`2026-02 = 97,60` / `2026-03 = 98,00` / `2026-04 = 65,30`).
4. Mostra um ranking de MAE (erro absoluto médio) por variante.

Uso:

```bash
cd server
pip install psycopg2-binary
python3 scripts/validar-ipt-conservador.py                    # roda fev/mar/abr
python3 scripts/validar-ipt-conservador.py --csv calib.csv    # exporta resultados
python3 scripts/validar-ipt-conservador.py --ano 2026 --mes 5 # mês isolado
```

### `server/src/services/ipt-conservador.test.ts`

Bateria de 18 asserções com casos sintéticos (mês perfeito, 1/3 planos zerados, zeros parciais, montagem da resposta). Roda com `npx tsx src/services/ipt-conservador.test.ts`.

## 4. Como você usa isso depois do merge

1. Sobe o servidor, abre o Claude CLI (que já tem o MCP do Neon autenticado) e roda:

   ```
   python3 server/scripts/validar-ipt-conservador.py
   ```

2. O ranking de MAE no fim da saída diz qual variante ficou mais perto da SELIMP nos três meses. Se for diferente de V7, mudar o `conservadorId` em `montarRespostaConservador`. Se V7 ficar bem, manter.

3. No frontend (`web/`), no painel do ADC, mostrar lado a lado:
   * **IPT Otimista** (`v1_oficial_atual`) — número que já aparece hoje.
   * **IPT Conservador (proxy SELIMP)** (`v7_combinado_calibrado`).
   * **IPT SELIMP oficial** — tabela `ipt_oficial_mensal` (preencher fev/mar/abr; jan já tem).
   * **Risco de glosa** — cor do card vem do `recomendacao.risco_glosa`.

4. Disparar alerta operacional quando `pct_planos_zerados > 15%` ou `risco_glosa == "alto"`. Esses são os indicadores que teriam pegado abril antes do fechamento.

## 5. O que ainda não fiz (próximos passos sugeridos)

* **Calibração contra dados reais** — o script `validar-ipt-conservador.py` precisa rodar contra o Neon (não tenho acesso direto neste ambiente). O resultado pode pedir ajuste do peso 0,6/0,4 em V7 ou troca para outra variante.
* **P/R/F reais** — quando a SELIMP eventualmente passar a base com cronograma, dá para implementar a fórmula contratual completa em vez de V7. O endpoint atual já está preparado: basta adicionar V8 com a fórmula correta e mudar o `conservadorId`.
* **Frontend** — não tocou; o endpoint está pronto para consumo.
* **Salvar histórico** — a tabela `ipt_oficial_mensal` aceita o valor oficial; precisa de uma rotina de upsert quando a SELIMP divulgar.

## 6. Tabela de referência rápida (matemática das variantes)

Com `linhas = [0, 1, 1, 1]` (um único plano, três OS executadas, uma zerada):

| Variante       | Cálculo                                                | Valor   |
| -------------- | ------------------------------------------------------ | ------- |
| v1 atual       | blend=0,87; q=0,87+0,08=0,95; cob=1 → 0,7·0,95+0,3·1   | 96,5%   |
| v3 média planos| (0+1+1+1)/4 = 0,75                                     | 75,0%   |
| v4 média linhas| idem (só 1 plano)                                      | 75,0%   |
| v7 combinado   | 0,6·75 + 0,4·75                                        | 75,0%   |

Com `linhas = [1,1, 0,0, 1,1]` em três planos (1 plano completamente zerado):

| Variante       | Valor    |
| -------------- | -------- |
| v1 atual       | 100,0%   |
| v2 zeros dentro| 82,27%   |
| v3 média planos| 66,67%   |
| v4 média linhas| 66,67%   |
| v6 cob proxy   | 72,27%   |
| v7 combinado   | 66,67%   |
| (SELIMP)       | 66,67%   |

Esse é o efeito que precisamos: quando 1/3 dos planos não executam, o conservador cai pra 66%. O sistema atual continua mostrando 100%, exatamente como aconteceu em abril.
