import axios from 'axios';

// Se NEXT_PUBLIC_API_URL j├í incluir /api/v1, usa direto, sen├úo adiciona
const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const API_URL = baseUrl.includes('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Tipos
export interface SAC {
  id: string;
  protocolo: string;
  tipo_servico: string;
  status: string;
  subprefeitura: string;
  endereco_text: string;
  lat?: number;
  lng?: number;
  data_criacao: string;
  data_agendamento?: string;
  data_execucao?: string;
  prazo_max_hours?: number;
  horas_ate_execucao?: number | null;
  fora_do_prazo?: boolean;
  /** Coluna Classifica├º├úo_do_Servi├ºo: "Solicita├º├úo" (IA) ou "Reclama├º├úo" (IRD) */
  classificacao_servico?: string;
  /** Coluna Responsividade_Execu├º├úo: "SIM" = no prazo, "N├âO" = fora do prazo */
  responsividade_execucao?: string;
  /** Coluna Finalizado_como_fora_de_escopo: "N├âO" para incluir no IA/IRD */
  finalizado_fora_de_escopo?: string;
  procedente_por_status?: string;
}

export interface CNC {
  id: string;
  bfs: string;
  subprefeitura: string;
  status: string;
  data_abertura: string;
  prazo_hours: number;
  endereco?: string;
  tipo_servico?: string;
  sem_irregularidade?: boolean;
}

export interface Indicador {
  tipo: string;
  valor: number;
  pontuacao: number;
}

export interface KPIs {
  indicadores: {
    ird: Indicador;
    ia: Indicador;
    if: Indicador;
  };
  sacs_hoje: number;
  cncs_urgentes: number;
}

export interface IptPreviewRow {
  plano: string;
  subprefeitura: string;
  tipo_servico: string;
  status_execucao: string;
  percentual_execucao: number | null;
  equipamentos: string[];
  modulos_status: Array<{
    codigo: string;
    status_bateria: string;
    status_comunicacao: string;
    bateria: string;
    dias_sem_comunicacao: number | null;
    data_ultima_comunicacao: string;
    ativo: boolean;
  }>;
  plano_ativo: boolean;
  sem_status_bateria: boolean;
  atualizado_em: string;
}

export interface IptPreviewResponse {
  periodo: { inicial: string | null; final: string | null };
  resumo: {
    total_planos: number;
    total_planos_despachados?: number;
    total_planos_ativos: number;
    media_execucao_planos_ativos: number | null;
    percentual_medio_ddmx?: number | null;
    total_modulos_relacionados: number;
    total_modulos_ativos: number;
    total_modulos_inativos: number;
    sem_status_bateria: number;
    comunicacao_off: number;
    bateria_critica: number;
    bateria_alerta: number;
  };
  subprefeituras: Array<{
    subprefeitura: string;
    quantidade_planos: number;
    media_execucao: number | null;
  }>;
  servicos: Array<{
    tipo_servico: string;
    quantidade_planos: number;
    media_execucao: number | null;
  }>;
  mesclados: IptPreviewRow[];
  comparativo: {
    total_linhas: number;
    divergencias: number;
    somente_selimp: number;
    somente_nosso: number;
    itens: Array<{
      plano: string;
      subprefeitura: string;
      tipo_servico: string;
      percentual_selimp: number | null;
      percentual_nosso: number | null;
      diferenca_percentual: number | null;
      origem: "ambos" | "somente_selimp" | "somente_nosso";
    }>;
  };
  /** Itens completos com detalhes diários, equipamentos, frequência e próxima programação */
  itens?: Array<{
    plano: string;
    subprefeitura: string;
    tipo_servico: string;
    percentual_selimp: number | null;
    percentual_nosso: number | null;
    origem: "ambos" | "somente_selimp" | "somente_nosso";
    equipamentos: string[];
    frequencia: string | null;
    proxima_programacao: string | null;
    cronograma_preview?: string[];
    detalhes_diarios: Array<{
      data: string;
      esperado: boolean;
      percentual_selimp: number | null;
      percentual_nosso: number | null;
      despachos_selimp: number;
      despachos_nosso: number;
      data_estimada?: boolean;
    }>;
  }>;
}

// API calls
export const apiService = {
  // SACs
  getSACs: async (params?: any) => {
    const { data } = await api.get('/sacs', { params });
    return data;
  },
  
  getSAC: async (id: string) => {
    const { data } = await api.get(`/sacs/${id}`);
    return data;
  },
  
  agendarSAC: async (id: string, dataAgendamento: string) => {
    const { data } = await api.post(`/sacs/${id}/agendar`, null, {
      params: { data_agendamento: dataAgendamento },
    });
    return data;
  },
  
  getSACsUrgentes: async () => {
    const { data } = await api.get('/sacs/urgentes');
    return data;
  },
  
  // CNCs
  getCNCs: async (params?: any) => {
    const { data } = await api.get('/cnc', { params });
    return data;
  },
  
  // ACICs
  getACICs: async (params?: any) => {
    const { data } = await api.get('/acic', { params });
    return data;
  },
  
  getACIC: async (id: string) => {
    const { data } = await api.get(`/acic/${id}`);
    return data;
  },
  
  // Upload
  uploadSACsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/sacs-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  
  uploadCNCsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/cnc-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  
  uploadACICsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/acic-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  
  uploadOuvidoriaCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ouvidoria-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  uploadIptHistoricoOsXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-os', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  uploadIptHistoricoOsVarricaoXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-os-varricao', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  uploadIptReportXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-report', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  uploadIptStatusBateriaXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-status-bateria', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  getUploadLastUpdates: async () => {
    const { data } = await api.get('/upload/last-updates');
    return data;
  },

  /** Remove SACs importados (inserted_from_csv). Use antes de reimportar para validar IA/IRD. */
  clearSACsImportados: async () => {
    const { data } = await api.post('/upload/clear-sacs');
    return data;
  },
  /** Remove todos os CNCs e ACICs. Use antes de reimportar. */
  clearCNCImportados: async () => {
    const { data } = await api.post('/upload/clear-cnc');
    return data;
  },
  /** Remove todos os ACICs. */
  clearACICImportados: async () => {
    const { data } = await api.post('/upload/clear-acic');
    return data;
  },
  /** Remove todas as Ouvidorias. */
  clearOuvidoriaImportados: async () => {
    const { data } = await api.post('/upload/clear-ouvidoria');
    return data;
  },
  
  // Indicadores
  getKPIs: async (periodoInicial?: string, periodoFinal?: string) => {
    const { data } = await api.get('/dashboard/kpis', {
      params: { periodo_inicial: periodoInicial, periodo_final: periodoFinal },
    });
    return data;
  },

  getIptPreview: async (
    periodoInicial?: string,
    periodoFinal?: string,
    mostrarTodos?: boolean,
    subprefeitura?: string
  ): Promise<IptPreviewResponse> => {
    const params: Record<string, string | undefined> = {};
    if (mostrarTodos) {
      params.mostrar_todos = "1";
    } else if (periodoInicial && periodoFinal) {
      params.periodo_inicial = periodoInicial;
      params.periodo_final = periodoFinal;
    }
    if (subprefeitura && subprefeitura !== "all") {
      params.subprefeitura = subprefeitura;
    }
    const { data } = await api.get('/dashboard/ipt-preview', { params });
    return data;
  },
  
  calcularADC: async (periodoInicial: string, periodoFinal: string, valorIPT?: number) => {
    const { data } = await api.post('/indicadores/calcular/adc', null, {
      params: {
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
        valor_ipt: valorIPT,
      },
    });
    return data;
  },

  getIndicadoresDetalhes: async (periodoInicial: string, periodoFinal: string, subprefeitura?: string) => {
    const { data } = await api.get('/indicadores/detalhes', {
      params: {
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
        subprefeitura,
      },
    });
    return data;
  },

  getIndicadoresHistorico: async (periodoInicial?: string, periodoFinal?: string) => {
    const { data } = await api.get('/dashboard/indicadores/historico', {
      params: {
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
      },
    });
    return data;
  },

  salvarIPT: async (periodoInicial: string, periodoFinal: string, percentualTotal: number) => {
    const { data } = await api.post('/indicadores/salvar/ipt', null, {
      params: {
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
        percentual_total: percentualTotal,
      },
    });
    return data;
  },
  
  // Roteiros
  gerarRoteiro: async (sacIds: string[]) => {
    const { data } = await api.post('/roteiros/gerar', { sac_ids: sacIds });
    return data;
  },
};

