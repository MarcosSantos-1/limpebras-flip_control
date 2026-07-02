# Web — Frontend Next.js

Parte frontend do monorepo **Limpebras Flip Control**. Ver [README raiz](../README.md) e [AGENTS.md](../AGENTS.md).

## Desenvolvimento

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npm run extract-clausulas   # Requer docs/02-contrato/multas-penalidades.xlsx local
```

## Estrutura

- `app/` — rotas (App Router)
- `components/` — UI compartilhada
- `lib/` — API client, auth, Firebase, utilitários

Deploy típico: Vercel ou similar, apontando `NEXT_PUBLIC_API_URL` para a API Fly.io.
