import useSWR from "swr";
import { apiService } from "./api";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";

const DEDUP_INTERVAL_MS = 30 * 1000; // 30s

export interface ReportDiarioDia {
  data: string;
  total_linhas: number;
  encerradas: number;
  media_percentual: number | null;
  planos_distintos: number;
  taxa_encerramento: number;
}

export interface ReportDiarioResponse {
  periodo: { inicio: string; fim: string };
  dias: ReportDiarioDia[];
  total_dias: number;
  total_linhas: number;
  total_encerradas: number;
}

export function useIptData(
  selectedMonth: Date,
  tableScope: "dia_anterior" | "periodo" | "todos",
  tablePeriodRange: { inicio: Date; fim: Date } | null,
  subprefeituraFilter: string
) {
  const periodoKpisInicio = format(startOfMonth(selectedMonth), "yyyy-MM-dd");
  const periodoKpisFim = format(endOfMonth(selectedMonth), "yyyy-MM-dd");

  let tableKey: string;
  if (tableScope === "todos") {
    tableKey = `ipt:all:${subprefeituraFilter}`;
  } else if (tableScope === "periodo" && tablePeriodRange) {
    tableKey = `ipt:${format(tablePeriodRange.inicio, "yyyy-MM-dd")}:${format(tablePeriodRange.fim, "yyyy-MM-dd")}:${subprefeituraFilter}`;
  } else {
    const ontem = subDays(new Date(), 1);
    tableKey = `ipt:d-1:${format(ontem, "yyyy-MM-dd")}:${subprefeituraFilter}`;
  }

  const cardsKey = `ipt:cards:${periodoKpisInicio}:${periodoKpisFim}:${subprefeituraFilter}`;
  const kpisKey = `kpis:${periodoKpisInicio}:${periodoKpisFim}`;
  const reportDiarioKey = `ipt:report-diario:${periodoKpisInicio}:${periodoKpisFim}`;

  let obsScopeStart: string | undefined;
  let obsScopeEnd: string | undefined;
  if (tableScope === "todos") {
    obsScopeStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
    obsScopeEnd = format(endOfMonth(new Date()), "yyyy-MM-dd");
  } else if (tableScope === "periodo" && tablePeriodRange) {
    obsScopeStart = format(tablePeriodRange.inicio, "yyyy-MM-dd");
    obsScopeEnd = format(tablePeriodRange.fim, "yyyy-MM-dd");
  } else {
    const ontem = subDays(new Date(), 1);
    const d = format(ontem, "yyyy-MM-dd");
    obsScopeStart = obsScopeEnd = d;
  }
  const obsKey = `ipt:obs:${obsScopeStart}:${obsScopeEnd}`;

  const observacoesSwr = useSWR(
    obsKey,
    () => apiService.getIptObservacoes(obsScopeStart, obsScopeEnd),
    { revalidateOnFocus: false, dedupingInterval: DEDUP_INTERVAL_MS }
  );

  const previewCardsSwr = useSWR(cardsKey, () =>
    apiService.getIptPreview(periodoKpisInicio, periodoKpisFim, false, subprefeituraFilter), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
  });

  const previewTableSwr = useSWR(
    tableKey,
    async () => {
      if (tableScope === "todos") {
        return apiService.getIptPreview(undefined, undefined, true, subprefeituraFilter);
      }
      if (tableScope === "periodo" && tablePeriodRange) {
        return apiService.getIptPreview(
          format(tablePeriodRange.inicio, "yyyy-MM-dd"),
          format(tablePeriodRange.fim, "yyyy-MM-dd"),
          false,
          subprefeituraFilter
        );
      }
      return apiService.getIptPreview(undefined, undefined, false, subprefeituraFilter);
    },
    { revalidateOnFocus: false, dedupingInterval: DEDUP_INTERVAL_MS }
  );

  const kpisSwr = useSWR(kpisKey, () => apiService.getKPIs(periodoKpisInicio, periodoKpisFim), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
  });

  const reportDiarioSwr = useSWR<ReportDiarioResponse>(
    reportDiarioKey,
    () => apiService.getIptReportDiario(periodoKpisInicio, periodoKpisFim),
    { revalidateOnFocus: false, dedupingInterval: DEDUP_INTERVAL_MS }
  );

  const isLoading = previewCardsSwr.isLoading || previewTableSwr.isLoading;
  const isValidating = previewCardsSwr.isValidating || previewTableSwr.isValidating || kpisSwr.isValidating;

  const mutate = async () => {
    await Promise.all([
      previewCardsSwr.mutate(),
      previewTableSwr.mutate(),
      kpisSwr.mutate(),
      observacoesSwr.mutate(),
      reportDiarioSwr.mutate(),
    ]);
  };

  return {
    previewCards: previewCardsSwr.data ?? null,
    previewTable: previewTableSwr.data ?? previewCardsSwr.data ?? null,
    observacoes: observacoesSwr.data ?? { globais: {}, diarias: {} },
    reportDiario: reportDiarioSwr.data ?? null,
    mutate,
    kpis: kpisSwr.data ?? null,
    isLoading,
    isValidating,
  };
}
