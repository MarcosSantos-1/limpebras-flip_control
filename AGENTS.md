# Guia para agentes de IA e desenvolvedores

Leia este arquivo **antes** de explorar o código. A pasta `docs/` (referência contratual e planilhas) fica na máquina local e **não está no Git**.

## O que é este projeto

Monorepo com **web** (Next.js) e **server** (Fastify/Postgres) para operação da contratada Limpebras: avaliação ADC, SACs/CNCs do FLIP, IPT (baterias, módulos, manutenções, contestações).

## Onde começar no código

| Área | Caminhos principais |
|------|---------------------|
| Layout / navegação | `web/components/layout/sidebar.tsx` |
| API client | `web/lib/api.ts` |
| Auth | `web/lib/auth.tsx`, `server/src/routes/auth.ts` |
| IPT / indicadores | `server/src/routes/indicadores.ts`, `server/src/services/` |
| Bateria / manutenção | `server/src/routes/bateria.ts`, `web/app/ipt/bateria/page.tsx` |
| Schema DB | `server/src/db.ts` |
| Upload planilhas | `server/src/routes/upload.ts`, `server/src/services/parseIptXlsx.ts` |

## Páginas grandes

- `web/app/ipt/bateria/page.tsx` — dashboard de bateria (~6k linhas): trocas, manutenções, contestações, modais.
- `web/app/ipt/page.tsx` — IPT geral e defesa.

Prefira **editar funções existentes** e seguir padrões locais (shadcn Dialog, toasts, badges de status).

## Documentação local (`docs/`)

Estrutura numerada (kebab-case):

```
docs/
├── README.md                 # Índice geral
├── 01-projeto/               # Visão geral e mapa do repositório
├── 02-contrato/              # ADC, glosa, multas, cronogramas contratuais
├── 03-flip/                  # Operação FLIP + amostras CSV
├── 04-ipt/                   # IPT: diagnósticos, specs, planilhas em dados/
├── 05-infraestrutura/        # Backup Neon, Firebase rules
└── 06-referencia/            # GeoJSON e dados estáticos
```

Planilhas usadas por scripts:

- `docs/04-ipt/dados/trocas/trocas-historico-transformado.csv`
- `docs/04-ipt/dados/modulos/trocas-de-modulos.xlsx`
- `docs/02-contrato/multas-penalidades.xlsx`

## Convenções

- Status de manutenção de módulo: `EM_ANALISE` → `PENDENTE` → `RETIRANDO` → `ATIVA` → `REINSTALANDO` → `REALIZADA`
- Contestações por dia de despacho: tabela `manutencao_contestacoes`, prints no Firebase
- Subprefeituras do lote: CV, JT, ST, MG
- Não commitar `.env`, `docs/`, dumps ou planilhas de produção

## Testes

```bash
cd server && npm test
```
