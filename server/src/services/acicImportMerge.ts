import type { PoolClient } from "pg";

/** N_ACIC a partir do raw importado (CSV). */
export function acicImportRowNAcic(row: Record<string, unknown>): string | null {
  const v = row.N_ACIC ?? row.n_acic;
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function statusLowerFromRow(row: Record<string, unknown>): string {
  const s = row.Status ?? row.status ?? row.STATUS;
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Após inserir uma linha em `acic`, alinha `acic_overrides` com a regra de negócio:
 * - Status Confirmado (novo import): zera estimativa e override de valor oficial para o valor
 *   homologado vir do CSV/raw; não altera entendimento, defesa, sem recurso nem texto de cláusula.
 * - Não cria linha em acic_overrides se ainda não existir (UPDATE afeta 0 linhas).
 */
export async function mergeAcicOverridesAfterImportRow(
  client: PoolClient,
  row: Record<string, unknown>
): Promise<void> {
  const n = acicImportRowNAcic(row);
  if (!n) return;
  const st = statusLowerFromRow(row);
  if (!st.includes("confirmado")) return;

  await client.query(
    `UPDATE acic_overrides SET
       valor_estimativa = NULL,
       multa_valor_estimativa = FALSE,
       valor = NULL,
       updated_at = NOW()
     WHERE n_acic = $1`,
    [n]
  );
}
