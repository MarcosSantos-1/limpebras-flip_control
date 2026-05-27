# Plano operacional IPT - Maio

## Mudanca de abordagem

Nao vale gastar a maior parte do tempo tentando adivinhar a memoria completa da SELIMP. A abordagem mais util agora e reduzir dano operacional:

- reduzir despachos zerados evitaveis;
- identificar setores/modulos que nunca pontuam;
- separar problema real de falha de cadastro/rastreador/bateria;
- documentar indisponibilidade e substituicao;
- monitorar varrição manual de sarjetas como frente critica.

## Cuidado contratual

Despachar apenas os modulos que "costumam pontuar" pode virar risco se isso significar deixar de cumprir plano previsto sem motivo formal.

A versao defensavel e:

- nao programar modulo indisponivel sem evidencia;
- substituir modulo/setor problemático por modulo valido quando houver base contratual/operacional;
- registrar motivo: bateria, comunicacao, instalacao, modulo incorreto, setor incorreto, troca recente, manutencao;
- guardar antes/depois e fonte dos dados.

## Frente critica: VJ - varricao manual de sarjetas

Abril/2026:

- 2.692 despachos encerrados;
- 1.996 zeros;
- 17,2% com zeros;
- 66,5% sem zeros.

Comparacao com fevereiro/2026:

- 1.752 despachos encerrados;
- 198 zeros;
- 65,0% com zeros;
- 73,2% sem zeros.

Leitura: a qualidade das execucoes positivas nao despencou tanto. O desastre veio do volume enorme de despachos zerados e da expansão/troca de base.

## Antes e depois de 16/04 em VJ

Consulta de abril separando a troca definitiva dos modulos:

| Fase | Despachos | Zeros | Media com zeros | Media sem zeros |
| --- | ---: | ---: | ---: | ---: |
| Ate 16/04 | 1.129 | 1.001 | 7,21% | 63,62% |
| Apos 16/04 | 1.563 | 995 | 24,41% | 67,18% |

Depois de 16/04 houve melhora no percentual com zeros, mas o volume de despachos aumentou muito e manteve quase mil zeros.

## Lista inicial de setores VJ mais criticos em abril

Priorizar setores com muitos despachos e todos/quase todos zerados:

| Setor | Despachos | Zeros | Media com zeros | Observacao |
| --- | ---: | ---: | ---: | --- |
| MG10101VJ0009 | 27 | 27 | 0,00% | zerado o mes inteiro |
| CV10101VJ0007 | 26 | 26 | 0,00% | zerado o mes inteiro |
| CV10101VJ0001 | 26 | 25 | 1,85% | quase sempre zerado |
| CV10101VJ0006 | 24 | 24 | 0,00% | zerado o mes inteiro |
| MG10101VJ0006 | 25 | 24 | 2,60% | quase sempre zerado |
| CV10101VJ0005 | 26 | 24 | 3,85% | quase sempre zerado |
| CV10101VJ0008 | 26 | 24 | 7,23% | quase sempre zerado |
| CV10101VJ0004 | 24 | 23 | 0,17% | quase sempre zerado |
| JT10101VJ0004 | 25 | 23 | 3,24% | quase sempre zerado |
| MG10101VJ0010 | 27 | 22 | 6,89% | quase sempre zerado |

## Rotina diaria sugerida

1. Gerar ranking VJ dos ultimos 7 dias:
   - despachos;
   - zeros;
   - media com zeros;
   - media sem zeros;
   - modulo/bateria/status de comunicacao.

2. Classificar cada setor critico:
   - erro de modulo;
   - bateria/comunicacao;
   - plano antigo/descontinuado;
   - setor trocado;
   - execução real ruim;
   - sem evidência.

3. Acoes permitidas/defensaveis:
   - trocar modulo;
   - corrigir cadastro SELIMP x DDMX;
   - abrir observacao no IPT;
   - pedir ajuste formal do plano;
   - suspender programação somente com motivo documentado.

4. Fechar o dia com lista de risco:
   - setores zerados reincidentes;
   - setores novos apos 16/04 que nunca pontuaram;
   - setores com bateria/sem comunicação;
   - serviços com explosao de despachos.

## Proxima melhoria no sistema

Criar uma aba "Plano de ataque" dentro do IPT com:

- filtro por serviço VJ;
- ranking de reincidencia zero;
- corte antes/depois da troca de modulos;
- setores nunca pontuaram;
- setores que pontuavam antes e pararam;
- cruzamento com bateria/status de comunicacao;
- botao para registrar acao/observacao;
- exportacao para Controle Operacional.
