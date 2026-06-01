# EMPRESA: LIMPEBRAS - FEVEREIRO

# DEMONSTRAÇÃO DO ALGORITMO DE CÁLCULO DO PERCENTUAL FINAL (PF)

---

## 1. OBJETIVO DA DEMONSTRAÇÃO

Apresentar de forma técnica e estruturada o Algoritmo de Cálculo do Percentual Final (PF), demonstrando a lógica matemática, a origem das variáveis, a coerência técnica dos pesos aplicados e os critérios de qualidade da execução, cobertura operacional e limitações reais de monitoramento.

---

## 2. VISÃO GERAL DO ALGORITMO

O algoritmo gera o Percentual Final (PF) como indicador percentual de desempenho, integrando dois eixos fundamentais: qualidade da execução das ordens e cobertura da capacidade monitorada.

---

## 3. FONTE DOS DADOS E PREMISSAS

Todas as informações utilizadas são extraídas diretamente dos relatórios do SISTEMA ÚNICO.

---

## 4. DEFINIÇÃO DAS VARIÁVEIS UTILIZADAS

As definições, métodos de obtenção e relevância técnica das variáveis permanecem inalterados.

### Variáveis de Planejamento e Capacidade

- **P** → Ordens planejadas;
- **R** → Rastreadores ativos;
- **F** → Frota total;

### Variáveis de Execução e Cobertura

- **A** → Ordens atribuídas únicas;
- **Z** → Ordens zeradas;
- **N** → Ordens com conclusão > 0%;

### Variáveis de Qualidade

- **Qᵢ** → Percentual da i-ésima ordem > 0%;
- **Q̄** → Qualidade bruta;
- **σ** → Desvio padrão das conclusões > 0%.

---

## 5. ESTRUTURA LÓGICA DO ALGORITMO

O algoritmo é organizado em três blocos principais:

1. Capacidade esperada;
2. Cobertura operacional;
3. Qualidade ajustada.

O Percentual Final (PF) resulta da ponderação entre:

- **70%** de qualidade;
- **30%** de cobertura.

---

## 6. PROCEDIMENTO DE CÁLCULO

Preparação dos dados, cálculo da capacidade esperada, cobertura, qualidade bruta, desvio padrão, determinação da qualidade ajustada e cálculo final do PF.

---

## 7. EQUAÇÃO

### Fórmula principal do Percentual Final (PF)

\[
PF = 0.7 \cdot \min \left( \bar{Q} + \min(\sigma, 0.08), 1 \right)
+ 0.3 \cdot \min \left( \frac{A}{C}, 1 \right)
\]

### Definições complementares

\[
C = P \cdot \frac{R}{F}
\]

\[
\bar{Q} = \frac{1}{N} \sum Q_i
\]

\[
N = A - Z
\]

### Conversão do PF para IPT

\[
IPT =
\begin{cases}
40 & PF \geq 0.9 \\
38 & 0.8 \leq PF < 0.9 \\
36 & 0.7 \leq PF < 0.8 \\
32 & 0.6 \leq PF < 0.7 \\
28 & 0.5 \leq PF < 0.6 \\
24 & 0.4 \leq PF < 0.5 \\
20 & 0.3 \leq PF < 0.4 \\
16 & 0.2 \leq PF < 0.3 \\
12 & 0.1 \leq PF < 0.2 \\
0 & PF < 0.1
\end{cases}
\]

---

## 8. RESULTADO

Concluída a aplicação da metodologia de cálculo do algoritmo, considerando todas as variáveis previstas, o Percentual Final (PF) apurado para o período em análise corresponde a **97,60 %**.