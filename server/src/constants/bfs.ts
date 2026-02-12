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

export function isBfsNaoDemandante(tipoServico: string | undefined): boolean {
  if (!tipoServico || !tipoServico.trim()) return false;
  const normalized = tipoServico.trim();
  return BFS_NAO_DEMANDANTES.includes(normalized);
}
