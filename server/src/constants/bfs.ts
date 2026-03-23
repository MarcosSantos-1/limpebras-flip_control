/**
 * BFS "Não Demandantes" - somente estes entram no cálculo do IF (ADC).
 * Fonte: atualização SELIMP.
 */
export const BFS_NAO_DEMANDANTES: string[] = [
  "Varrição manual de vias e logradouros públicos",
  "Varrição mecanizada de vias e logradouros públicos",
  "Varrição de pós feiras livres e Lavagem e desinfecção de vias e logradouros públicos pós feiras livres",
  "Operação dos Ecopontos",
  "Equipe de Mutirão de Zeladoria de Vias e Logradouros Públicos",
  "Lavagem especial de equipamentos públicos",
  "Limpeza e desobstrução de bueiros, bocas de lobo e bocas de leão",
  "Remoção dos Resíduos dos Ecopontos",
  "Coleta programada e transporte de objetos volumosos e de entulho (Cata-Bagulho)",
  "Coleta manual de resíduos orgânicos de feiras-livres",
  "Coleta e transporte de PEV-Ponto de Entrega Voluntária",
];

/**
 * Serviços BFS EXCLUÍDOS do cálculo do IF.
 * IF = todos os BFS do período EXCETO estes 3.
 */
export const BFS_IF_EXCLUSAO_SQL: string[] = [
  "%Coleta e transporte de entulho e grandes objetos depositados irregularmente nas vias, logradouros  e áreas públicas%",
  "%Fornecimento, instalação e reposição de papeleiras e outros equipamentos de recepção de resíduos%",
  "%Remoção de animais mortos de proprietários não identificados em vias e logradouros públicos%",
];

/**
 * BFS cuja coluna Fiscal começa por "SELIMP -" não entram no IF nem na lista de Defesa/Contestação.
 * Usa b.fiscal quando preenchido (upload); senão inspeciona raw via jsonb_each_text (chave "Fiscal" em qualquer caixa).
 */
export function sqlBfsFiscalNaoEhSelimp(tableAlias?: string): string {
  const p = tableAlias ? `${tableAlias}.` : "";
  const rawExpr = `COALESCE(${p}raw, '{}'::jsonb)`;
  const fiscalCol = `NULLIF(trim(COALESCE(${p}fiscal, '')), '')`;
  return `NOT (
  (${fiscalCol} IS NOT NULL AND ${fiscalCol} ~* '^\\s*selimp\\s*-\\s*')
  OR
  (${fiscalCol} IS NULL AND EXISTS (
    SELECT 1
    FROM jsonb_each_text(${rawExpr}) AS e(key, value)
    WHERE trim(e.key) ILIKE 'fiscal'
      AND trim(e.value) ~* '^\\s*selimp\\s*-\\s*'
  ))
)`;
}

/**
 * Serviços excluídos da página Defesa/Contestação (BFS escalonados).
 * BFS escalonados = Não Demandantes COM irregularidade, exceto estes 4.
 */
export const BFS_DEFESA_EXCLUSAO_SQL: string[] = [
  "%Coleta e transporte de entulho e grandes objetos depositados irregularmente%",
  "%Remoção de animais mortos de proprietários não identificados em vias e logradouros públicos%",
  "%Fornecimento, instalação e reposição de papeleiras e outros equipamentos de recepção de resíduos%",
  "%Equipe para Conscientização e Revitalização de Pontos Viciados%",
];

export function isBfsNaoDemandante(tipoServico: string | undefined): boolean {
  if (!tipoServico || !tipoServico.trim()) return false;
  const normalized = tipoServico.trim();
  return BFS_NAO_DEMANDANTES.includes(normalized);
}
