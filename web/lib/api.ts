import axios from 'axios';
import type { AuthPageKey } from "@/lib/auth-shared";
import { getStoredSessionToken } from "@/lib/session-storage";

// Se NEXT_PUBLIC_API_URL j├í incluir /api/v1, usa direto, sen├úo adiciona
const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const API_URL = baseUrl.includes('/api/v1') ? baseUrl : `${baseUrl}/api/v1`;

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 25_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Uploads multipart: planilhas grandes + parsing no servidor costumam passar de 25s. */
const UPLOAD_REQUEST_TIMEOUT_MS = 180_000;

api.interceptors.request.use((config) => {
  const sessionToken = typeof window !== "undefined" ? getStoredSessionToken() : "";
  if (sessionToken) {
    config.headers["x-session-token"] = sessionToken;
  }
  return config;
});

export type { AuthPageKey };

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  role: "host" | "user";
  status: "active" | "inactive";
  blocked: boolean;
  page_permissions: Record<AuthPageKey, boolean>;
  is_ipt_restricted?: boolean;
  is_cco?: boolean;
  visible_password: string;
}

export interface LoginPayload {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  session_token: string;
  remember_me: boolean;
  expires_at: string;
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function getErrorMessage(error: unknown, fallback = "Erro desconhecido") {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { response?: { data?: { detail?: string } }; message?: string };
    if (!maybe.response && maybe.message === "Network Error") {
      return "Não foi possível conectar ao backend. Verifique se a API está rodando e se o CORS está liberado.";
    }
    return maybe.response?.data?.detail || maybe.message || fallback;
  }
  return fallback;
}

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
  data_criacao: string | null;
  data_agendamento?: string | null;
  /** Coluna Data_Acionamento_Agendamento (ex.: IRD) — prazo de atendimento ao agendamento */
  data_acionamento_agendamento?: string | null;
  data_execucao?: string | null;
  /** Confirmação de realização (planilha), quando existir */
  data_realizacao_confirmacao_execucao?: string | null;
  /** max(data_realizacao_confirmacao, data_execucao) — uso em linha do tempo / fora do prazo */
  data_finalizacao_efetiva?: string | null;
  data_ultima_atualizacao?: string | null;
  /** Status bruto da planilha (quando importado) */
  status_planilha?: string | null;
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

export type IndicatorHistoryType = "IA" | "IRD" | "IF" | "IPT" | "ADC";

export interface IndicatorHistoryPoint {
  id?: number;
  data: string;
  tipo: IndicatorHistoryType;
  valor: number | null;
  percentual?: number | null;
  pontuacao: number | null;
  periodo_inicial?: string;
  periodo_final?: string;
  periodo_tipo?: string;
  quantidade_base?: number;
  source_file?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IptServiceSnapshotPoint {
  id: number;
  snapshot_at: string;
  metric_key: string;
  metric_label: string;
  periodo_inicial: string;
  periodo_final: string;
  periodo_tipo: string;
  percentual: number | null;
  percentual_dia: number | null;
  media_sem_zerados: number | null;
  quantidade_planos: number;
  total_despachos: number;
  total_despachos_dia: number;
  despachos_previstos?: number;
  despachos_previstos_dia?: number;
  despachos_nao_despachados?: number;
  despachos_nao_despachados_dia?: number;
  cobertura_despachos?: number | null;
  cobertura_despachos_dia?: number | null;
  despachos_zerados: number;
  despachos_zerados_dia: number;
  source_file: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface KPIs {
  indicadores: {
    ird: Indicador;
    ia: Indicador;
    if: Indicador;
    ipt?: Indicador & {
      cenarios?: IptCenarios;
    };
  };
  sacs_hoje: number;
  cncs_urgentes: number;
  ipt_sem_dados?: boolean;
  adc_override?: AdcOverrideInfo;
}

export interface AdcOverrideInfo {
  ativo: boolean;
  modo?: "por_indicador" | "total";
  observacao?: string;
  adc_total?: number;
  pontuacao_ird?: number;
  pontuacao_ia?: number;
  pontuacao_if?: number;
  pontuacao_ipt?: number;
}

export interface AdcOverrideRecord extends AdcOverrideInfo {
  ano?: number;
  mes?: number;
  updated_at?: string;
}

export interface IptCenarios {
  estimado: { percentual: number; pontuacao: number };
  conservador: { percentual: number; pontuacao: number };
  otimista: { percentual: number; pontuacao: number };
  diagnostico: {
    total_linhas: number;
    linhas_encerradas: number;
    zeros_total: number;
    zeros_encerradas: number;
    planos_distintos: number;
    taxa_zeros_encerradas: number;
    diferenca_otimista_conservador: number;
    criterio_estimativa: string;
    Qb: number;
    sigma: number;
    qualidade_ajustada: number;
    cobertura_usada: number;
    cobertura_stress: number;
    cobertura_fonte: "oficial_selimp" | "presumida_100";
    percentual_oficial?: number | null;
    risco: "baixo" | "medio" | "alto";
  };
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
    bateria_percentual?: number | null;
    produtividade_bateria?: number;
    dias_on?: number;
    dias_off?: number;
    dias_sem_comunicacao: number | null;
    data_ultima_comunicacao: string | null;
    ativo: boolean;
  }>;
  plano_ativo: boolean;
  sem_status_bateria: boolean;
  atualizado_em: string;
}

export interface IptPreviewModuloBateria {
  codigo: string;
  numero_selimp: string;
  nome: string;
  setor: string;
  tipo: "lutocar" | "portatil";
  status_bateria: string;
  status_sinal: string;
  comunicacao: string;
  bateria: string;
  bateria_percentual: number | null;
  ultima_comunicacao: string | null;
  dias_on: number;
  dias_off: number;
  produtividade_bateria: number;
}

export interface IptPreviewBateriaResumoSetor {
  total: number;
  produtividade_media: number | null;
  com_sinal: number;
  sem_sinal: number;
  criticos: number;
  alerta: number;
}

export interface IptPreviewBateriaModuloDia {
  numero_selimp: string;
  status_comunicacao: string;
  bateria_raw: string;
  bateria_percentual: number | null;
  bateria_desatualizada: boolean;
  ultima_comunicacao: string | null;
}

export interface IptPreviewBateriaSetorDia {
  total: number;
  desatualizadas: number;
  media_percentual: number | null;
  modulos: IptPreviewBateriaModuloDia[];
}

export interface IptPreviewBateriaDdmxDispatch {
  rota: string;
  bateria_raw: string;
  bateria_percentual: number | null;
  bateria_desatualizada: boolean;
  ultima_comunicacao: string | null;
}

export interface IptPreviewBateriaDdmxDia {
  total: number;
  desatualizadas: number;
  media_percentual: number | null;
  despachos: IptPreviewBateriaDdmxDispatch[];
}

/** Relatório da importação anual do Cronograma do Plano de Trabalho. */
export interface CronogramaImportReport {
  dry_run: boolean;
  modo_datas: "mesclar" | "substituir";
  por_arquivo: Array<{ arquivo: string; modelo: "escalonado" | "fixo" | null; setores: number }>;
  setores_arquivo: number;
  novos: number;
  atualizados: number;
  datas_inseridas: number;
  datas_removidas: number;
  removidos: string[];
  delecao_aplicada: boolean;
  avisos: string[];
}

export type StatusDiaDespacho = "conforme" | "nao_despachado" | "fora_plano" | "zerado" | "nao_previsto";

export interface DespachoLinha {
  setor: string;
  subprefeitura: string | null;
  tipo_servico: string;
  frequencia: string | null;
  turno: string | null;
  esperado: boolean;
  despachadoManual: boolean;
  despachosSelimp: number;
  percentual: number | null;
  percentualHistorico: number | null;
  status: StatusDiaDespacho;
  veiculos: string[];
  proximaProgramacao: string | null;
}

export interface DespachosResponse {
  dia: string;
  kpis: {
    previstos: number;
    despachados: number;
    naoDespachados: number;
    foraPlano: number;
    zerados: number;
    cobertura: number;
  };
  linhas: DespachoLinha[];
  tendencia14d: Array<{ data: string; previstos: number; despachados: number; cobertura: number }>;
  turnos: string[];
}

export interface ColarDespachoItem {
  setor: string;
  subprefeitura: string | null;
  tipo_servico: string;
  turno: string | null;
  status: string | null;
  situacao: "conforme" | "fora_plano" | "descartado";
  motivoDescarte: string | null;
  dataPlanejada: string | null;
  veiculos: number;
}

export interface ColarTurnoResumo {
  turno: string;
  previstos: number;
  despachados: number;
  faltam: number;
}

export interface ColarDespachosResult {
  dia: string;
  extraidos: number;
  despachaveis: number;
  descartados: number;
  gravados: number;
  conforme: number;
  fora_plano: number;
  nao_despachado: number;
  avisos: string[];
  itens: ColarDespachoItem[];
  porTurno: ColarTurnoResumo[];
}

export interface IptPreviewResponse {
  periodo: { inicial: string | null; final: string | null };
  resumo: {
    total_planos: number;
    total_planos_despachados?: number;
    total_planos_ativos: number;
    total_despachos_selimp?: number;
    total_despachos_zerados?: number;
    ipt_cenarios?: IptCenarios | null;
    media_execucao_planos_ativos: number | null;
    media_com_zerados?: number | null;
    media_sem_zerados?: number | null;
    percentual_medio_ddmx?: number | null;
    produtividade_bateria_media?: number | null;
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
    media_sem_zerados?: number | null;
    total_despachos?: number;
    despachos_previstos?: number;
    despachos_nao_despachados?: number;
    cobertura_despachos?: number | null;
    despachos_zerados?: number;
  }>;
  servicos: Array<{
    tipo_servico: string;
    quantidade_planos: number;
    media_execucao: number | null;
    media_sem_zerados?: number | null;
    total_despachos?: number;
    despachos_previstos?: number;
    despachos_nao_despachados?: number;
    cobertura_despachos?: number | null;
    despachos_zerados?: number;
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
      despachos_selimp?: number;
      raw_selimp_sum?: number;
      raw_selimp_count?: number;
      raw_selimp_nonzero_count?: number;
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
    modulos_bateria?: IptPreviewModuloBateria[];
    produtividade_bateria_media?: number | null;
    bateria_resumo_setor?: IptPreviewBateriaResumoSetor;
    bateria_por_equipamento?: Record<string, {
      status_bateria: string;
      bateria?: string;
      data_ultima_comunicacao?: string;
      dias?: string;
      dias_on?: number;
      dias_off?: number;
      produtividade_bateria?: number;
      status_sinal?: string;
      numero_selimp?: string;
    }>;
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
      bateria_setor_dia?: IptPreviewBateriaSetorDia | null;
      bateria_ddmx_dia?: IptPreviewBateriaDdmxDia | null;
    }>;
  }>;
}

export interface IptModuloBateriaModule {
  id: number;
  subprefeitura: string;
  setor: string;
  numeroSelimp: string;
  diasExecucao: string;
  comunicacao: "ON" | "OFF" | string;
  bateria: string;
  bateriaPercentual: number;
  ultimaComunicacao: string;
  statusSinalGeral: string;
  statusBateria: string;
  dataInstalacao: string;
  quantidadeTrocas: number;
  diasOn: number;
  diasOff: number;
  produtividade: number;
}

export interface IptModulosBateriaResponse {
  modules: IptModuloBateriaModule[];
  stats: {
    total: number;
    online: number;
    offline: number;
    avgProductivity: number;
    criticalAlerts: number;
    lowBattery: number;
  };
  lastUpdate: string | null;
  latestBatch?: {
    id: null;
    importedAt: string;
    sourceFile: string;
    totalRegistros: number;
  } | null;
}

// API calls
export const apiService = {
  extractErrorMessage: getErrorMessage,
  login: async (payload: LoginPayload): Promise<LoginResponse> => {
    const { data } = await api.post("/auth/login", payload);
    return data;
  },

  logout: async () => {
    const { data } = await api.post("/auth/logout");
    return data;
  },

  getCurrentUser: async (): Promise<{ user: AuthUser }> => {
    const { data } = await api.get("/auth/me");
    return data;
  },

  getUsers: async (): Promise<{ items: AuthUser[]; total: number; page_keys: AuthPageKey[] }> => {
    const { data } = await api.get("/auth/users");
    return data;
  },

  createUser: async (payload: {
    username: string;
    display_name?: string;
    password: string;
    role: "host" | "user";
    status: "active" | "inactive";
    blocked: boolean;
    page_permissions: Record<string, boolean>;
  }): Promise<{ user: AuthUser | null }> => {
    const { data } = await api.post("/auth/users", payload);
    return data;
  },

  updateUser: async (
    id: number,
    payload: {
      display_name?: string;
      password?: string;
      role?: "host" | "user";
      status?: "active" | "inactive";
      blocked?: boolean;
      page_permissions?: Record<string, boolean>;
    }
  ): Promise<{ user: AuthUser | null }> => {
    const { data } = await api.patch(`/auth/users/${id}`, payload);
    return data;
  },

  // SACs
  getSACs: async (params?: QueryParams) => {
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
  getCNCs: async (params?: QueryParams) => {
    const { data } = await api.get('/cnc', { params });
    return data;
  },

  /** BFSs escalonados para Defesa/Contestação (Com irregularidade, exclui 4 serviços, cruza com CNCs) */
  getCNCsDefesa: async (params?: QueryParams) => {
    const { data } = await api.get('/cnc/defesa', { params });
    return data;
  },

  /** Preview frequência/cronograma ao digitar código de setor (defesa). */
  getDefesaSetorPreview: async (params: { setor: string; subprefeitura?: string; tipo_servico?: string }) => {
    const { data } = await api.get("/cnc/defesa/setor-preview", { params });
    return data as {
      setor: string;
      frequencia_resolvida: string | null;
      cronograma_resolvido: string | null;
      source: "index" | "cronograma" | "nomenclatura";
    };
  },

  /** Persiste status de defesa no servidor. Contestar: payload completo de fotos/texto. Irregular: `{ observacao_irregular: string }`. */
  updateDefesaBfs: async (
    numeroBfs: string,
    payload: { status_defesa: string; dados_contestacao?: unknown | null }
  ) => {
    const { data } = await api.patch(
      `/cnc/defesa/bfs/${encodeURIComponent(numeroBfs)}`,
      payload
    );
    return data as {
      numero_bfs: string;
      defesa_trabalho: { status: string; dados: unknown } | null;
    };
  },
  
  // ACICs
  getACICs: async (params?: QueryParams) => {
    const { data } = await api.get('/acic', { params });
    return data;
  },
  
  getACIC: async (id: string) => {
    const { data } = await api.get(`/acic/${id}`);
    return data;
  },

  /** Atualiza override (defesa, sem_recurso, valor, entendimento) de um ACIC. Persiste no backend - não é perdido ao reimportar. */
  updateACICOverride: async (
    nAcic: string,
    payload: {
      defesa?: boolean;
      sem_recurso?: boolean;
      valor?: number | null;
      valor_estimativa?: number | null;
      entendimento_defesa_previa?: string | null;
      motivo_penalidade?: string | null;
      multa_clausula_texto?: string | null;
      multa_valor_estimativa?: boolean;
    }
  ) => {
    const { data } = await api.patch(`/acic/overrides/${encodeURIComponent(nAcic)}`, payload);
    return data;
  },

  // Upload
  uploadSACsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/sacs-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  
  uploadCNCsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/cnc-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  /**
   * FLIP_CONSULTA_CNC — merge incremental (não apaga CNCs de outros períodos).
   * `periodoInicial`/`periodoFinal` (YYYY-MM-DD): remove só CNCs com data_fiscalizacao nesse intervalo antes de inserir.
   * `substituirTudo`: zera a tabela (CSV completo do ano, legado).
   */
  uploadCncDetalhesCSV: async (
    file: File,
    opts?: { periodoInicial?: string; periodoFinal?: string; substituirTudo?: boolean }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    const params: Record<string, string> = {};
    if (opts?.periodoInicial) params.periodo_inicial = opts.periodoInicial;
    if (opts?.periodoFinal) params.periodo_final = opts.periodoFinal;
    if (opts?.substituirTudo) params.substituir_tudo = "1";
    const { data } = await api.post('/upload/cnc-detalhes-csv', formData, {
      headers: { "Content-Type": "multipart/form-data" },
      params: Object.keys(params).length ? params : undefined,
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  
  uploadACICsCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/acic-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  
  uploadOuvidoriaCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ouvidoria-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptHistoricoOsXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-os', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptHistoricoOsVarricaoXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-os-varricao', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptHistoricoOsCompactadoresXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-os-compactadores', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadSessionFile: async (session: "flip" | "ddmx", file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post(`/upload/session/${session}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadDdmxVarricao: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-ddmx-varricao', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadDdmxCompactadores: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-ddmx-compactadores', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadDdmxLight: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-ddmx-light', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptReportXlsx: async (
    file: File,
    referencia?: {
      modoReferencia?: "d_minus_1" | "fim_de_semana" | "mensal";
      periodoInicial?: string;
      periodoFinal?: string;
      mesReferencia?: string;
    }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    // A data agora vem da própria planilha; o período é derivado no backend.
    // Os parâmetros abaixo só são enviados em fluxos legados (ex.: importação mensal).
    if (referencia?.mesReferencia) {
      params.set('mes_referencia', referencia.mesReferencia);
    } else if (referencia?.modoReferencia && referencia.periodoInicial && referencia.periodoFinal) {
      params.set('modo_referencia', referencia.modoReferencia);
      params.set('periodo_inicial', referencia.periodoInicial);
      params.set('periodo_final', referencia.periodoFinal);
    }
    const qs = params.toString();
    const { data } = await api.post(`/upload/ipt-report${qs ? `?${qs}` : ""}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptStatusBateriaXlsx: async (file: File, dataReferencia: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    params.set('data_referencia', dataReferencia);
    const { data } = await api.post(`/upload/ipt-status-bateria?${params.toString()}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  uploadIptHistoricoBateriaXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-historico-bateria', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600_000, // 10 min — arquivo histórico pode ter muitas datas
    });
    return data;
  },

  /**
   * Importação anual do Cronograma do Plano de Trabalho (planilhas Escalonados + Fixos).
   * `dryRun: true` (default) retorna o relatório do que aconteceria sem gravar.
   */
  uploadCronogramaPlano: async (files: File[], opts: { dryRun: boolean; replaceDatas?: boolean }) => {
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    formData.append('dryRun', String(opts.dryRun));
    formData.append('replaceDatas', String(opts.replaceDatas ?? false));
    const { data } = await api.post('/upload/cronograma', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600_000, // 10 min — import anual grande (milhares de setores/datas)
    });
    return data as CronogramaImportReport;
  },

  /** Despachos: cronograma do plano vigente por setor (datas p/ escalonados, dias_semana p/ fixos). */
  getDespachosCronograma: async (params?: { subprefeitura?: string; servico?: string; modelo?: string }) => {
    const { data } = await api.get("/ipt/despachos/cronograma", { params });
    return data as {
      total: number;
      setores: Array<{
        setor: string;
        modelo: "escalonado" | "fixo";
        servico: string | null;
        subprefeitura: string | null;
        sub_sigla: string | null;
        frequencia_texto: string | null;
        frequencia_codigo: string | null;
        turno: string | null;
        local: string | null;
        feira: string | null;
        dias_semana: string[] | null;
        ano_plano: number | null;
        datas: string[];
      }>;
    };
  },

  /** Despachos SELIMP — visão do dia (kpis, linhas acionáveis, tendência 14d). */
  getDespachos: async (params: { dia: string; subprefeitura?: string; servico?: string; turno?: string }) => {
    const { data } = await api.get("/ipt/despachos", { params });
    return data as DespachosResponse;
  },

  /** Despachos SELIMP — importa a colagem da grade da SELIMP para um dia (dryRun p/ prévia). */
  colarDespachos: async (dia: string, texto: string, opts?: { dryRun?: boolean }) => {
    const { data } = await api.post("/ipt/despachos/colar", { dia, texto, dryRun: opts?.dryRun ?? false });
    return data as ColarDespachosResult;
  },

  despacharManual: async (dia: string, setores: string[]) => {
    const { data } = await api.post("/ipt/despachos/manual", { dia, setores });
    return data as { dia: string; gravados: number; setores: string[] };
  },

  uploadIptSetoresModulosXlsx: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-setores-modulos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  /** Inclui `dashboard_import_check` (FLIP + Report SELIMP cobrindo “ontem” BRT) para o aviso no Dashboard. */
  getUploadLastUpdates: async () => {
    const { data } = await api.get("/upload/last-updates", {
      params: { _t: Date.now() },
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
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
  /** Remove todos os dados da planilha Reports (SELIMP). Use antes de reimportar. */
  clearIptReportImportados: async () => {
    const { data } = await api.post('/upload/clear-ipt-report');
    return data;
  },
  clearIptReportPeriodo: async (periodoInicial: string, periodoFinal: string) => {
    const { data } = await api.post(`/upload/clear-ipt-report-periodo?periodo_inicial=${encodeURIComponent(periodoInicial)}&periodo_final=${encodeURIComponent(periodoFinal)}`);
    return data;
  },
  /** Remove Historico OS DDMX (ipt_imports). */
  clearIptDdmxImportados: async () => {
    const { data } = await api.post('/upload/clear-ipt-ddmx');
    return data;
  },
  uploadIptConsolidadoVeiculos: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-consolidado-veiculos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  uploadIptConsolidadoVarricao: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-consolidado-varricao', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },
  clearIptConsolidadoVeiculos: async () => {
    const { data } = await api.post('/upload/clear-ipt-consolidado-veiculos');
    return data;
  },
  clearIptConsolidadoVarricao: async () => {
    const { data } = await api.post('/upload/clear-ipt-consolidado-varricao');
    return data;
  },
  uploadIptModulosBateria: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await api.post('/upload/ipt-modulos-bateria', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_REQUEST_TIMEOUT_MS,
    });
    return data;
  },

  clearIptModulosBateria: async () => {
    const { data } = await api.post('/upload/clear-ipt-modulos-bateria');
    return data;
  },

  /** TRUNCATE ipt_dados_bateria + reinicia serial id (ids voltam a partir de 1). */
  clearIptDadosBateria: async () => {
    const { data } = await api.post('/upload/clear-ipt-dados-bateria');
    return data;
  },
  getIptModulosBateria: async (): Promise<IptModulosBateriaResponse> => {
    const { data } = await api.get('/dashboard/ipt-modulos-bateria');
    return data;
  },
  /** Remove registros manuais de IPT. */
  clearIptRegistros: async () => {
    const { data } = await api.post('/upload/clear-ipt-registros');
    return data;
  },
  /** Diagnóstico: registros ipt_report_selimp por dia (para debugar fev/jan). */
  getIptSelimpDiagnostico: async () => {
    const { data } = await api.get('/indicadores/ipt-selimp-diagnostico');
    return data;
  },
  /** IPT por mês: quantidade e percentual (ano opcional, default atual). */
  getIptPorMes: async (ano?: number) => {
    const params = ano != null ? { ano } : {};
    const { data } = await api.get('/indicadores/ipt-por-mes', { params });
    return data;
  },
  /** IPT Report diário: percentual por dia estimado a partir do report SELIMP. */
  getIptReportDiario: async (inicio: string, fim: string) => {
    const { data } = await api.get('/ipt/report-diario', { params: { inicio, fim } });
    return data;
  },
  getIptServiceSnapshots: async (
    tipoServico: string,
    periodoInicial: string,
    periodoFinal: string
  ): Promise<{ tipo_servico: string; periodo: { inicial: string; final: string }; pontos: IptServiceSnapshotPoint[] }> => {
    const { data } = await api.get('/ipt/snapshots/servicos', {
      params: {
        tipo_servico: tipoServico,
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
      },
    });
    return data;
  },
  
  // Indicadores
  getKPIs: async (periodoInicial?: string, periodoFinal?: string) => {
    const { data } = await api.get('/dashboard/kpis', {
      params: { periodo_inicial: periodoInicial, periodo_final: periodoFinal },
    });
    return data;
  },

  getAdcOverride: async (ano: number, mes: number): Promise<AdcOverrideRecord> => {
    const { data } = await api.get('/indicadores/adc-override', { params: { ano, mes } });
    return data;
  },

  saveAdcOverride: async (payload: {
    ano: number;
    mes: number;
    modo: "por_indicador" | "total";
    pontuacao_ird?: number | null;
    pontuacao_ia?: number | null;
    pontuacao_if?: number | null;
    pontuacao_ipt?: number | null;
    adc_total?: number | null;
    observacao: string;
  }) => {
    const { data } = await api.put('/indicadores/adc-override', payload);
    return data;
  },

  deleteAdcOverride: async (ano: number, mes: number) => {
    const { data } = await api.delete('/indicadores/adc-override', { params: { ano, mes } });
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

  getIptObservacoes: async (scopeStart?: string, scopeEnd?: string) => {
    const params: Record<string, string> = {};
    if (scopeStart) params.scope_start = scopeStart;
    if (scopeEnd) params.scope_end = scopeEnd;
    const { data } = await api.get('/ipt/observacoes', { params });
    return data as {
      globais: Record<string, { id: number; titulo: string; descricao: string | null }>;
      diarias: Record<string, Record<string, { id: number; titulo: string; descricao: string | null }>>;
    };
  },

  createIptObservacaoGlobal: async (setor: string, titulo: string, descricao?: string) => {
    const { data } = await api.post('/ipt/observacoes/globais', { setor, titulo, descricao });
    return data;
  },

  cancelarIptObservacaoGlobal: async (id: number) => {
    const { data } = await api.post(`/ipt/observacoes/globais/${id}/cancelar`);
    return data;
  },

  createIptObservacaoDiaria: async (setor: string, dataRef: string, titulo: string, descricao?: string) => {
    const { data } = await api.post('/ipt/observacoes/diarias', { setor, data: dataRef, titulo, descricao });
    return data;
  },

  cancelarIptObservacaoDiaria: async (id: number) => {
    const { data } = await api.post(`/ipt/observacoes/diarias/${id}/cancelar`);
    return data;
  },

  /** Diagnóstico: contagens e amostra de ipt_imports (DDMX/SELIMP) para debug */
  getIptDiagnostico: async () => {
    const { data } = await api.get('/dashboard/ipt-diagnostico');
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

  getIndicadoresHistorico: async (
    tipoOrPeriodoInicial?: IndicatorHistoryType | string,
    periodoInicial?: string,
    periodoFinal?: string
  ): Promise<{ tipo?: IndicatorHistoryType; periodo?: { inicial: string; final: string }; historico: IndicatorHistoryPoint[] }> => {
    const params: Record<string, string | undefined> = {};
    if (tipoOrPeriodoInicial && /^\d{4}-\d{2}-\d{2}$/.test(tipoOrPeriodoInicial)) {
      params.periodo_inicial = tipoOrPeriodoInicial;
      params.periodo_final = periodoInicial;
    } else {
      params.tipo = tipoOrPeriodoInicial;
      params.periodo_inicial = periodoInicial;
      params.periodo_final = periodoFinal;
    }
    const { data } = await api.get('/dashboard/indicadores/historico', {
      params,
    });
    return data;
  },

  /** IPT Conservador: variantes + diagnostico + recomendacao de risco. */
  getIptConservador: async (periodoInicial: string, periodoFinal: string) => {
    const { data } = await api.get("/indicadores/ipt-conservador", {
      params: { periodo_inicial: periodoInicial, periodo_final: periodoFinal },
    });
    return data as {
      base: { inicio: string; fim: string; fonte: string };
      variantes: Array<{
        id: string;
        descricao: string;
        percentual: number | null;
        pontuacao: number | null;
        componentes?: Record<string, number | null>;
      }>;
      diagnostico: {
        total_linhas: number;
        linhas_zeradas: number;
        pct_linhas_zeradas: number;
        planos_distintos: number;
        planos_totalmente_zerados: number;
        pct_planos_zerados: number;
        media_geral_com_zeros: number;
        media_geral_sem_zeros: number;
        mediana_geral: number;
        subprefeituras_criticas: Array<{ subprefeitura: string; media_com_zeros: number; planos: number; zeros: number }>;
      };
      recomendacao: {
        otimista: string;
        conservador: string;
        risco_glosa: "baixo" | "medio" | "alto";
        gap_pp: number;
        justificativa: string;
      };
    };
  },

  /** Evolucao acumulada do percentual de um servico (snapshots ipt_servico_acc). */
  getIptServicoEvolucao: async (periodoInicial: string, periodoFinal: string, tipoServico?: string) => {
    const { data } = await api.get("/indicadores/ipt-servico-evolucao", {
      params: {
        periodo_inicial: periodoInicial,
        periodo_final: periodoFinal,
        tipo_servico: tipoServico,
      },
    });
    return data as {
      periodo: { inicio: string; fim: string };
      tipo_servico: string | null;
      pontos: Array<{
        data: string;
        tipo_servico: string;
        metric_key: string;
        percentual_com_zeros: number | null;
        percentual_dia: number | null;
        percentual_sem_zeros: number | null;
        planos: number;
        despachos: number;
        despachos_dia: number;
        zerados: number;
        zerados_dia: number;
        source_file: string;
        snapshot_at: string;
      }>;
    };
  },

  /** Lista de servicos disponiveis no periodo (para popular dropdown). */
  getIptServicosDisponiveis: async (periodoInicial: string, periodoFinal: string) => {
    const { data } = await api.get("/indicadores/ipt-servicos-disponiveis", {
      params: { periodo_inicial: periodoInicial, periodo_final: periodoFinal },
    });
    return data as { servicos: Array<{ tipo_servico: string; metric_key: string }> };
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
