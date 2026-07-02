# Limpebras Flip Control

Sistema web de monitoramento operacional e contratual da **Limpebras** (Lote III — Zeladoria), integrando indicadores **ADC**, dados do **FLIP** (SACs, CNCs, ACICs, BFS) e **IPT** (planos de trabalho, baterias, módulos SELIMP).

## Estrutura do repositório

```
limpebras-flip_control/
├── web/                 # Frontend Next.js (App Router)
├── server/              # API Fastify + Postgres (Neon)
├── scripts/             # Utilitários do monorepo (ex.: reorganização de docs)
├── docs/                # Documentação e planilhas de referência (local, não versionada)
├── .github/workflows/   # CI — backup Neon, etc.
└── AGENTS.md            # Guia rápido para IAs e novos devs
```

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js, React, Tailwind, shadcn/ui |
| Backend | Fastify, TypeScript |
| Banco | PostgreSQL (Neon Serverless) |
| Arquivos | Firebase Storage (prints de manutenção, defesa IPT) |
| Deploy API | Fly.io (`server/fly.toml`) |

## Desenvolvimento local

### API (`server/`)

```bash
cd server
cp .env.example .env   # se existir; configurar DATABASE_URL
npm install
npm run dev            # http://localhost:3333 (porta conforme config)
```

### Web (`web/`)

```bash
cd web
npm install
npm run dev            # http://localhost:3000
```

Configure a URL da API no `.env` do frontend conforme `web/lib/api.ts`.

## Módulos principais (rotas)

| Rota | Descrição |
|------|-----------|
| `/` | Dashboard ADC |
| `/indicadores` | Indicadores contratuais |
| `/sacs`, `/acic`, `/bfs` | Dados FLIP por tipo |
| `/ipt` | IPT geral — defesa, contestação |
| `/ipt/bateria` | Módulos, trocas, manutenções |
| `/ipt/cruzamento` | Cruzamento plano × execução |
| `/ipt/despachos` | Despachos diários |
| `/ipt/conservador` | Algoritmo conservador IPT |
| `/upload` | Importação de planilhas |

## Documentação

A pasta `docs/` contém especificações, planilhas de referência e amostras de exportação FLIP. **Não é versionada no Git** (dados sensíveis/volumosos). Estrutura detalhada em `docs/README.md` (local).

Para contexto de código e convenções, leia `AGENTS.md`.

## Scripts úteis

| Script | Uso |
|--------|-----|
| `server/scripts/import-trocas-historico.mjs` | Importa CSV de trocas → Neon |
| `server/scripts/reimport-trocas-from-xlsx.mjs` | Reimporta trocas da planilha |
| `web/scripts/extract-clausulas.mjs` | Gera `clausulas-penalidades.json` |
| `scripts/reorganize-docs.ps1` | Reaplica layout padrão da pasta `docs/` |
