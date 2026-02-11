# FLIP — descrição operacional (base: explicação do usuário)

## O que é o FLIP

O FLIP é uma plataforma / software terceirizado da prefeitura que **unifica SACs / Ouvidorias e CNCs** e possui por meio de tabelas e protocolos todos esses dados juntamente com ACICs.

---

## Escopo de atuação (Lote / Subregionais)

Os SACs relacionados à **Zeladoria** e que estiverem dentro do nosso lote informado pelo munícipe ou automático via GPS (subregionais / subprefeituras) caem no nosso sistema.

Subregionais / subprefeituras do nosso lote (Lote III - Limpebras):

* Casa Verde / Cachoeirinha / Limão — CV
* Jaçanã / Tremembé — JT
* Vila Maria / Vila Guilherme — MG
* Santana / Tucuruvi — ST

Observação: às vezes há bugs e falhas de endereço, então operadores (como o usuário) têm que solicitar revisão de regional que volta para a prefeitura.

---

## SACs (156)

SACs são as reclamações, denúncias e solicitações feitas por munícipes nas plataformas de atendimento da prefeitura (site da prefeitura, telefone 156, apps e robôs do WhatsApp).

Todas as denúncias relacionadas a zeladoria — por exemplo: capinação, limpeza de bocas de lobo, materiais entulhos e volumosos, cata-bagulho, remoção de propaganda, varrição etc. — e que estejam dentro do lote informado pelo munícipe ou via GPS irão cair no nosso sistema.

Os SACs são divididos em “caixinhas” (status). Abaixo a explicação de cada uma das 11 caixinhas.

---

## 11 status (caixinhas) dos SACs

### 1. Aguardando Análise

Quando o SAC chega, ele cai nesse status.

Nossos fiscais (divididos em turnos e as 4 subregionais) devem ir até a localização do SAC para vistoriar — geralmente sob nossa instrução. Às vezes eles finalizam por conta; alguns finalizam certo, outros erram. O fiscal vistoria para adicionar um status ou finalizar direto. É a primeira etapa da "triagem".

---

### 2. Aguardando Agendamento

Caso o fiscal vá ao SAC e registre como  **procedente** .

 **SAC procedente** : a reclamação/solicitação do munícipe está correta — há material, entulho ou volumoso; é dentro do nosso escopo; há mato; a solicitação procede e é possível agendar execução do serviço.

Existem dois tipos de dinâmica citados:

* **Demandante** : serviços sem mapa/cronograma. Exemplo:  *Coleta e transporte de entulho e grandes objetos depositados irregularmente nas vias, logradouros e áreas públicas* .
* Prazo de vistoria + finalização:  **72 horas** .
* Caso extrapole, pode dar complicações e afetar o IA (índice de atendimento).
* Outro exemplo de demandante: *Remoção de animais mortos* com tempo de atendimento  **até 12 horas** , também afetando o IA.
* **Escalonados** : serviços com mapa e cronograma (programados), por exemplo: capina/raspagem/pintura de guias (mutirão de vias), coleta programada de grandes objetos (cata-bagulho), limpeza de bueiros, varrição etc.
* Podemos agendar em até **30 dias** e geralmente agendamos pelo endereço para o dia em que o mapa for feito.
* Se estiver fora dos 30 dias, solicitamos que o fiscal adicione a solicitação como  **não procede** , pois na resposta ao munícipe informamos que o serviço será executado na data X (procuramos no sistema antes de enviar).

Os serviços escalonados podem afetar o **IRD** (índice de Reclamações por domicílio) porque, em tese, devemos cumprir o contrato à risca (na prática nem sempre acontece: parte do mapa pode não ser feita, caminhão quebra etc).

Nesta etapa escolhemos no calendário a data de agendamento e usamos mensagens padronizadas para notificar o munícipe, por exemplo:

> "Prezado(a) cidadão(ã), em vistoria à sua solicitação de X informamos que o serviço foi agendado para o dia X. Equipe Limpebras"

---

### 3. Aguardando Revistoria

Usado quando o fiscal adicionou um status incorreto. Há um botão para acionar revistoria onde o SAC vai para essa caixinha e o fiscal pode escolher novamente para qual status vai (procede, não procede, fora do escopo, executado).

---

### 4. Não Procede

Muito utilizado. Usamos quando:

* O local está limpo, já foi feito, não dá para ser feito (lixo totalmente domiciliar e ensacado), terreno particular etc.
* Ou quando não queremos fazer um SAC (equivalente a dizer que o munícipe está enganado porque o fiscal foi ao local e não encontrou).

Este status é importante porque a **SELIMP** (Secretaria de Limpeza / prefeitura) não costuma gerenciar ou monitorar os SACs aqui; aproveitamos para adicionar aqui mesmo que alguns SACs se enquadrem como “Fora do Escopo” (ex.: lixo domiciliar), pois a SELIMP costuma voltar SACs fora do escopo.

Quando temos feriado e não dá para agendar, ou quando queremos controlar a quantidade e status dos SACs artificialmente, fazemos por aqui e pedimos para os fiscais seguirem orientações. Problema: muitos *Não Procede* pode afetar indicadores dependendo da quantidade (se não tiver SACs agendados, se tiver uma quantidade grande ou se a SELIMP suspeitar).

---

### 5. Em Execução

Quando um SAC é agendado, ele cai aqui. Controlamos o tempo e extraímos a planilha para analisar ou mandar para os fiscais (uma espécie de roteiro). O objetivo é não deixar os SACs estourarem o tempo nem acumularem demais (ex.: 300–600 SACs).

---

### 6. Executado

Quando sai de execução ou análise direto para executado cai aqui. Dá-se a resposta final para o munícipe no descritivo ou alteramos o status para voltar para o fiscal (caso o serviço não tenha sido de fato executado). Às vezes fiscais tentam enganar tirando fotos fora do local ou maquiar — nesses casos marcamos revistoria.

---

### 7. Confirmar Execução

Revistoria da execução: caso o fiscal tenha errado ou a execução esteja em dúvida, fica nesse status.

---

### 8. Confirmada Execução

Caso o fiscal finalize uma revistoria da execução do serviço, pode ser finalizado com a mensagem para o munícipe ou novamente acionando confirmação de execução.

---

### 9. Não Confirmada Execução

Revistoria da revistoria da execução — é raro, mas pode acontecer.

---

### 10. Confirmar Fora de Escopo

Muito importante. Se o fiscal for ao SAC e a solicitação do munícipe não for da nossa jurisdição (ex.: remoção de veículo abandonado, conserto de vias, tapa-buraco, tampa de bueiro lacrada ou cimentada), o SAC pode ser encaixado aqui.

A SELIMP monitora esse status porque ela redireciona para a empresa responsável pelo serviço ou manda para nós novamente. Ex.: bueiro entupido da Sabesp — ela redireciona para o hidrojato, tapa-buraco para subprefeitura, etc.

Nossa parte é enviar a resposta final ao munícipe dizendo para refazer o SAC no serviço correto ou informar que a solicitação foi redirecionada.

---

### 11. Aguardando Confirmação de Execução Parcial

Foi usado no passado, mas atualmente é praticamente inútil. Acredita-se que servia para quando não dava para executar tudo em um dia ou fosse para execução em etapas.

---

## Fotos e evidências

Em todas as etapas dos SACs, **as fotos no local** (computa o GPS e exibe abaixo da foto do fiscal automaticamente) são de suma importância. Uma das responsabilidades descritas é orquestrar, manipular e controlar a execução dos SACs e verificar se estão em ordem.

Todo SAC tem:

* Endereço
* Sub (subprefeitura)
* Número de protocolo (pode ser visto depois)
* Tempo de responsividade e horários
* Cada status aplicado é listado sequencialmente, como se fosse um histórico de e-mails.

O descritivo do munícipe é muito importante pois pode revelar informações sobre má conduta de agentes, pedidos de informação (data de varrição, cata-bagulho) ou revelar situações específicas (veículo abandonado, limpeza de terreno, exigências inapropriadas, etc). Depois vem a primeira vistoria do fiscal com foto ou finalização com foto (fora do escopo, não procede ou executado direto). Quando finaliza, para de contabilizar o horário.

---

## Ouvidoria

A Ouvidoria é um SAC mais formal — um “SAC aprimorado”. Quando um munícipe fica insatisfeito com uma resposta de SAC, pode ir na subprefeitura ou recorrer à prefeitura e o SAC pode tornar-se uma Ouvidoria. Toda Ouvidoria vem de um SAC e tem o número de protocolo do SAC junto de um processo formalizado com explicação.

Por ter histórico e processo mais formal, o fiscal deve estar mais atento e finalizar da maneira correta (geralmente com três fotos mostrando a equipe fazendo o serviço e fotos do local limpo). Não dá para simplesmente colocar como “não procede” e finalizar. A responsividade desses serviços é menor, ou seja, há maior urgência.

Geralmente não há muitas Ouvidorias e o status e formato são idênticos aos SACs — porém (o usuário precisa confirmar isto) acredita que elas não afetam os indicadores, exceto se não forem cumpridas no prazo.

---

## CNC (Comunicado de Não Conformidade)

O CNC é como um SAC, porém é aberto por um agente/fiscal da subprefeitura/SELIMP. Esses agentes monitoram o contrato e fiscalizam as ruas; se encontrarem irregularidades (saco de lixo não coletado no dia certo, cata-bagulho não executado, mato, mapa não executado — eles têm acesso ao plano de trabalho e cronograma) aplicam uma CNC.

Prazos: as CNCs geralmente têm prazo curto, podendo durar no máximo 24 horas e, dependendo do serviço, 6 horas (por exemplo varrição). As CNCs só possuem dois status: **pendentes** e  **urgentes** . Pendentes = no prazo normal ou recém adicionadas; Urgentes = passaram da metade do prazo de responsividade.

Cada CNC tem:

* Número de protocolo (BFS — Boletim de Fiscalização de Serviço)
* Nome do agente vistoriador
* Subregional aplicada
* Foto
* Descrição do material e explicação

Nós não controlamos, agendamos nem fechamos CNCs pela plataforma — somente o fiscal da subprefeitura pode **executar** e evidenciar que o serviço foi feito. Se houver erro do fiscal (ex.: foto maquiada do local sujo), a empresa  **toma multa direta** . Se não finalizar dentro do prazo, abre outra CNC automática. Contestar é com a chefia.

---

## ACIC (Autos de Constatação de Irregularidade da Contratada)

A multa que aparece no sistema como consequência das CNCs é o ACIC (Autos de Constatação de Irregularidade da Contratada). Monitoramos para ver se não há nada no sistema, principalmente finais de semana, pois pode aparecer uma CNC só para prejudicar.

---

## Indicadores e impacto contratual (descrição geral)

Os CNCs afetam diretamente o  **IF - Índice de Fiscalização** . Com a mudança recente de contrato, parece que haverá outro tipo de fiscalização onde o agente pode fiscalizar positivamente o contrato (a equipe observa que esse tipo de fiscalização não tem ocorrido desde o início do novo contrato — aproximadamente 2,5 meses — e isso precisa ser alinhado em reuniões com eles; caso contrário, haverá penalidades).

O ADC (Avaliação de Desempenho da Contratada) avalia se estamos em dia com os  **4 indicadores** :  **IA, IRD, IF e IPT** . Se todos os indicadores não pontuarem os 90 pontos (em cada avaliação e na avaliação geral), tomamos a chamada  **Grosa** , que é um desconto no valor do contrato (ex.: 89 pontos = desconto de 1% do valor do contrato), podendo haver até rescisão do contrato caso não se atinja o mínimo de 30 pontos.

---

## Observações operacionais finais (do usuário)

* É responsabilidade do operador orquestrar, manipular e controlar a execução dos SACs e verificar se estão em ordem.
* Fotos e provas georreferenciadas são fundamentais.
* Há problemas recorrentes de fiscais que maquiam fotos ou finalizam incorretamente; nesses casos é preciso marcar revistoria.
* Monitoramento de CNCs e ACICs é urgente porque geram multas diretas e impactam indicadores contratuais.
* Alguns status (ex.: Aguardando Confirmação de Execução Parcial) estão praticamente em desuso.
