/** Normaliza o número BFS como vem da API/planilha (trim, espaços internos). */
export function normalizeDefesaBfsNumero(bfs: string | undefined | null): string {
  return (bfs ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Chave estável para localStorage e pasta no Firebase.
 * O `id` do Postgres muda se o registro for recriado no import; o número BFS não.
 */
export function defesaStorageKey(b: { id: string; bfs?: string }): string {
  const n = normalizeDefesaBfsNumero(b.bfs);
  return n || b.id;
}

/** Segmento seguro para path no Storage (substitui caracteres problemáticos). */
export function firebaseDefesaFolderSegment(bfs: string | undefined | null, rowId: string): string {
  const n = normalizeDefesaBfsNumero(bfs);
  if (n) return n.replace(/[/\\#?[\]]/g, "_");
  return rowId;
}
