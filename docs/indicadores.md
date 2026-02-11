# Regras de negócio e cálculos automáticos

### IRD

* IRD = (nº reclamações escalonadas procedentes no mês / nº domicílios) × 1000
* `nº domicílios = 511093` (base IBGE 2024)
* Faixas: conforme texto (≤1 → 20p, >1 ≤2 → 15p, etc.)

### IA

* IA (%) = (solicitações demandantes atendidas no prazo / nº solicitações procedentes demandantes) × 100
* Pontuação conforme faixas (≥90% → 20p, 80–90 → 16p, ...)

 **Importante** : para calcular “atendidas no prazo”:

* considerar apenas registros com `data_execucao` e fotos georreferenciadas antes e depois.
* considerar diferença `data_execucao - data_criacao <= prazo_max_hours`.

### IF

* IF (%) = (nº de BFS sem irregularidade / nº total BFS) × 1000 (ou ×100 para percent)
* Use BFS com campo `sem_irregularidade = true`
* Pontuação conforme faixas.

### IPT

* IPT = média ponderada (mão de obra 50% + equipamentos 50%) — por enquanto entrada manual
* Faixas conforme tabela.

### ADC

* ADC = soma das pontuações (IRD + IA + IF + IPT).
* Cálculo de desconto por faixa conforme regras contratuais.
