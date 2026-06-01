# Backup do Banco de Dados (Neon)

Estratégia de backup em **3 camadas** seguindo o padrão 3-2-1 (3 cópias, 2 mídias, 1 offsite).

## Visão geral

| Camada | Onde | Janela | Como é criado |
|---|---|---|---|
| 1. PITR do Neon (History window) | Neon (nativo) | 7 dias (configurado em Settings → Storage) | Automático, sem setup |
| 2. Artifact diário | GitHub Actions | 90 dias | Workflow `backup-neon.yml`, diário 03:00 BRT |
| 3. Release semanal | GitHub Releases | Permanente | Mesmo workflow, aos domingos |

Cobertura:
- Erro humano recente → camada 1 (PITR)
- "Preciso de um dia específico do último trimestre" → camada 2 (artifact)
- "Preciso de algo de meses/anos atrás" ou "o Neon sumiu" → camada 3 (Release)

## Como funciona o workflow

Arquivo: `.github/workflows/backup-neon.yml`

Em cada execução:
1. Instala `pg_dump` 17 (mesma versão do Neon — versões precisam casar)
2. Sanitiza o `DATABASE_URL` (remove whitespace)
3. Faz dump das 3 tabelas críticas (`critical-tables-*.dump`):
   - `ipt_dados_bateria`
   - `setores_modulos`
   - `ipt_report_linhas`
4. Faz dump do banco completo (`full-db-*.dump`)
5. Valida que os dumps são restauráveis (`pg_restore --list`)
6. Sobe como artifact (90d) — sempre
7. Aos domingos, também publica como Release (permanente)

Trigger manual: **Actions → Backup Neon Database → Run workflow**.

## Configuração inicial (já feita)

Secret `NEON_DATABASE_URL` configurado em `Settings → Secrets and variables → Actions`.

**Importante sobre o valor do secret:**
- Cole **apenas** o `postgresql://...` (sem o prefixo `DATABASE_URL=`)
- Use o endpoint **direto** (sem `-pooler` no host) — `pg_dump` exige sessão direta
- **Sem trailing newline** ao colar (o workflow já normaliza, mas evite)

Connection string para backup:
```
postgresql://neondb_owner:SENHA@ep-delicate-bread-ac2qsyre.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

> A aplicação (`server/.env`) continua usando o **pooler** (com `-pooler`). Não mexa lá.

## Onde baixar os backups

- **Artifacts diários (90d):** https://github.com/MarcosSantos-1/limpebras-flip_control/actions
  → run desejado → seção **Artifacts** no final da página → baixa `.zip`
- **Releases semanais (permanente):** https://github.com/MarcosSantos-1/limpebras-flip_control/releases
  → cada Release tem os `.dump` anexados

## Como restaurar

### Pré-requisito: instalar `pg_restore` 17 (uma vez só)

Baixa o instalador EDB: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
- Versão **17.x**
- Em "Select Components", marque **apenas Command Line Tools**
- Adicione `C:\Program Files\PostgreSQL\17\bin` ao PATH

Confere:
```powershell
pg_restore --version
```

### ⚠️ NUNCA restaure direto em produção

Sempre teste antes em um **branch do Neon**:

1. https://console.neon.tech → seu projeto → **Branches** → **Create branch**
2. Copia o connection string do branch novo
3. Restaura nele (passos abaixo, mas apontando pro branch)
4. Conecta com DBeaver/pgAdmin e confirma que os dados voltaram corretos
5. Se OK, restaura em produção **ou** promove o branch a primary

Branches são instantâneos e o plano Free tem 3 disponíveis.

### Cenário A — Restaurar UMA tabela (caso mais comum)

Ex.: alguém deletou dados de `ipt_dados_bateria`.

```powershell
pg_restore `
  --dbname="postgresql://neondb_owner:SENHA@ep-delicate-bread-ac2qsyre.sa-east-1.aws.neon.tech/neondb?sslmode=require" `
  --table=ipt_dados_bateria `
  --data-only `
  --clean `
  --if-exists `
  --verbose `
  "C:\Downloads\critical-tables-2026-06-01T06-00-00Z.dump"
```

Flags:
- `--table=NOME` — restaura só essa tabela
- `--data-only` — não recria schema, só repopula dados
- `--clean --if-exists` — limpa dados existentes antes de inserir (substitui)

### Cenário B — Restaurar o banco inteiro

Use o `full-db-*.dump`:

```powershell
pg_restore `
  --dbname="postgresql://neondb_owner:SENHA@ep-delicate-bread-ac2qsyre.sa-east-1.aws.neon.tech/neondb?sslmode=require" `
  --clean `
  --if-exists `
  --no-owner `
  --no-acl `
  --verbose `
  "C:\Downloads\full-db-2026-06-01T06-00-00Z.dump"
```

### Cenário C — Restaurar via PITR (mais rápido, se ainda na janela)

Pelo console do Neon: **Branches** → **Create branch** → escolhe ponto no tempo → cria.
- Branch sai com os dados naquele instante
- Pode promover a primary ou copiar dados manualmente para o atual

## Monitoramento

Por padrão o GitHub não notifica falhas. Recomendado ativar em:

https://github.com/settings/notifications → **Actions** → marcar "Failed workflows only" + "Email"

Assim você descobre no mesmo dia se algum backup falhar (ex.: senha do Neon mudou).

## Troubleshooting (problemas conhecidos)

| Erro no log do workflow | Causa | Solução |
|---|---|---|
| `invalid connection option "DATABASE_URL"` | Secret tem prefixo `DATABASE_URL=` | Editar secret, deixar só a URL |
| `invalid channel_binding value: "require\n"` | Trailing newline no secret | Re-colar URL sem quebra de linha |
| `server version mismatch` | `pg_dump` em versão diferente do Neon | Atualizar `postgresql-client-XX` no workflow |
| `LOCK TABLE not supported` | Usando endpoint `-pooler` | Trocar para endpoint direto no secret |
