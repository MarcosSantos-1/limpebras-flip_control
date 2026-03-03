import useSWR from "swr";
import { apiService } from "./api";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";

const DEDUP_INTERVAL_MS = 30 * 1000; // 30s

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
      // dia_anterior: server usa ontem quando periodo não informado
      return apiService.getIptPreview(undefined, undefined, false, subprefeituraFilter);
    },
    { revalidateOnFocus: false, dedupingInterval: DEDUP_INTERVAL_MS }
  );

  const kpisSwr = useSWR(kpisKey, () => apiService.getKPIs(periodoKpisInicio, periodoKpisFim), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
  });

  const isLoading =
    previewCardsSwr.isLoading ||
    previewTableSwr.isLoading ||
    (kpisSwr.isLoading && !kpisSwr.data);
  const isValidating = previewCardsSwr.isValidating || previewTableSwr.isValidating || kpisSwr.isValidating;

  const mutate = async () => {
    await Promise.all([
      previewCardsSwr.mutate(),
      previewTableSwr.mutate(),
      kpisSwr.mutate(),
    ]);
  };

  return {
    previewCards: previewCardsSwr.data ?? null,
    previewTable: previewTableSwr.data ?? previewCardsSwr.data ?? null,
    kpis: kpisSwr.data ?? null,
    isLoading: isLoading && !previewCardsSwr.data && !previewTableSwr.data,
    isValidating,
    mutate,
  };
}
