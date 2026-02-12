import axios from 'axios';

// Se NEXT_PUBLIC_API_URL já incluir /api/v1, usa direto, senão adiciona
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
  /** Coluna Classificação_do_Serviço: "Solicitação" (IA) ou "Reclamação" (IRD) */
  classificacao_servico?: string;
  /** Coluna Responsividade_Execução: "SIM" = no prazo, "NÃO" = fora do prazo */
  responsividade_execucao?: string;
  /** Coluna Finalizado_como_fora_de_escopo: "NÃO" para incluir no IA/IRD */
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

