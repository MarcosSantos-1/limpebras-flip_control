# Decifragem do IPT/PF SELIMP

## Fonte recebida

Arquivo analisado fora deste workspace:

- `C:\Users\marcos.silva\Documents\Code\limpebras-flip_control\docs\EXPLICAÇÃO IPT.MD`
- `C:\Users\marcos.silva\Documents\Code\limpebras-flip_control\docs\EXPLICAÇÃO IPT.pdf`

O material confirma a formula do Percentual Final (PF), mas nao traz a memoria numerica de fevereiro.

## Formula oficial confirmada

```text
PF = 0.7 * min(Qbar + min(sigma, 0.08), 1)
   + 0.3 * min(A / C, 1)

C = P * R/F
Qbar = (1/N) * sum(Qi)
N = A - Z
```

Variaveis conforme SELIMP:

- `P`: ordens planejadas
- `R`: rastreadores ativos
- `F`: frota total
- `A`: ordens atribuidas unicas
- `Z`: ordens zeradas
- `N`: ordens com conclusao > 0%
- `Qi`: percentual da ordem com conclusao > 0%
- `Qbar`: qualidade bruta
- `sigma`: desvio padrao das conclusoes > 0%

## O que isso muda na leitura

Antes, o sistema tratava os zeros como o principal causador do tombo. Isso era incompleto.

Pela formula oficial, os zeros nao entram diretamente na media `Qbar`, porque `Qi` e `N` consideram apenas ordens com conclusao maior que zero. Portanto, se a SELIMP segue exatamente o texto, o tombo de abril nao pode ser explicado somente por "mais zeros".

Existem duas hipoteses fortes:

1. **Colapso de cobertura**: o componente `A/C` caiu muito em abril.
2. **Unidade de calculo diferente**: nossa forma de montar `Qi` por plano/blend nao e a mesma unidade usada pela SELIMP.

## Calibracao reversa com os oficiais

Usando a qualidade calculada pelo proxy atual, a cobertura necessaria para bater os oficiais fica:

| Mes | IPT/PF oficial | Qualidade ajustada proxy | Cobertura inferida |
| --- | ---: | ---: | ---: |
| Fev/2026 | 97,60% | 96,70% | 99,70% |
| Mar/2026 | 98,00% | 96,81% | 100,00% |
| Abr/2026 | 62,30% | 89,22% | 0,00%* |

`*` Pela qualidade proxy atual, a parcela de qualidade ja explicaria cerca de 62,45% do PF. Como o oficial foi 62,30%, a cobertura reversa fica abaixo de zero e precisa ser truncada para 0%. Isso indica que o nosso proxy de qualidade ainda esta levemente acima da memoria SELIMP, mas confirma que abril foi tratado como cobertura praticamente nula.

Leitura: fevereiro e marco sao compativeis com cobertura praticamente total. Abril so fecha com a SELIMP se a cobertura operacional cair para perto de 10%, ou se a qualidade oficial for calculada de modo diferente do nosso proxy.

## Por que o conservador antigo era ruim

A media com zeros por plano ficou perto de 70% em fevereiro e marco, mas a SELIMP fechou perto de 98%. Logo, essa media nao pode ser usada como "IPT conservador principal" para todos os meses.

Ela e util como alerta operacional, mas nao como proxy mensal confiavel.

## O que pedir para a SELIMP

Para fechar a memoria de calculo, precisamos pedir explicitamente:

- Valor de `P` do mes
- Valor de `R` do mes
- Valor de `F` do mes
- Valor de `C = P * R/F`
- Valor de `A`
- Valor de `Z`
- Valor de `N`
- Valor de `Qbar`
- Valor de `sigma`
- Lista ou regra de deduplicacao das "ordens atribuidas unicas"
- Se `A` conta plano, despacho, OS, modulo, equipamento, ou outro identificador do Sistema Unico
- Se uma ordem com 0% entra em `A`
- Se o percentual `Qi` vem do maximo, media, ultimo registro, melhor execucao, ou outra consolidacao quando ha mais de uma linha para o mesmo plano

Sem esses itens, qualquer acompanhamento interno e um proxy.

## Recomendacao para o dashboard

O numero principal deve ser honesto sobre a origem:

- Quando houver oficial mensal: mostrar o IPT oficial e a cobertura inferida.
- Quando nao houver oficial: mostrar "cobertura presumida em 100%" e um stress de cobertura baixa.
- Manter zeros, qualidade PF e DDMX como diagnostico operacional, nao como verdade oficial.

Para meses em aberto, o risco deve subir quando:

- qualidade ajustada cai;
- taxa de zeros em encerrados sobe;
- diferenca entre cobertura 100% e stress 10% fica grande;
- houve troca de plano/setor/modulo no periodo;
- DDMX e SELIMP divergem muito por plano/servico/subprefeitura.

## Conclusao atual

O baixo IPT de abril parece mais compativel com falha de cobertura/aderencia da capacidade monitorada apos a troca dos planos do que com uma simples media de execucao com zeros.

Ainda assim, a formula recebida nao permite reproduzir a SELIMP sem conhecer a unidade real de `A`, `P`, `R`, `F` e o metodo de consolidacao de `Qi`.
