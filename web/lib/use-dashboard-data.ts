import useSWR from "swr";
import { apiService } from "./api";

/** Alinha com CACHE_TTL_MS do servidor (~2 min); evita refetch em rajada. */
const DEDUP_INTERVAL_MS = 90 * 1000;

export function useDashboardData(periodoInicial: string, periodoFinal: string) {
  const kpisKey = periodoInicial && periodoFinal ? `kpis:${periodoInicial}:${periodoFinal}` : null;
  const sacsKey = periodoInicial && periodoFinal
    ? `sacs:${periodoInicial}:${periodoFinal}:p1:10000`
    : null;
  const cncsKey = periodoInicial && periodoFinal
    ? `cnc:${periodoInicial}:${periodoFinal}:p1:10000`
    : null;

  const kpisSwr = useSWR(kpisKey, () => apiService.getKPIs(periodoInicial, periodoFinal), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
    revalidateIfStale: false,
  });

  const sacsSwr = useSWR(sacsKey, () =>
    apiService.getSACs({
      periodo_inicial: periodoInicial,
      periodo_final: periodoFinal,
      page: 1,
      page_size: 10000,
    }), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
    revalidateIfStale: false,
  });

  const cncsSwr = useSWR(cncsKey, () =>
    apiService.getCNCs({
      periodo_inicial: periodoInicial,
      periodo_final: periodoFinal,
      page: 1,
      page_size: 10000,
    }), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
    revalidateIfStale: false,
  });

  const isLoading = kpisSwr.isLoading || sacsSwr.isLoading || cncsSwr.isLoading;
  const isValidating = kpisSwr.isValidating || sacsSwr.isValidating || cncsSwr.isValidating;
  const error = kpisSwr.error || sacsSwr.error || cncsSwr.error;

  const mutate = async () => {
    await Promise.all([kpisSwr.mutate(), sacsSwr.mutate(), cncsSwr.mutate()]);
  };

  return {
    kpisData: kpisSwr.data ?? null,
    sacsData: sacsSwr.data ?? { items: [] },
    cncsData: cncsSwr.data ?? { items: [] },
    isLoading: isLoading && !kpisSwr.data && !sacsSwr.data && !cncsSwr.data,
    isValidating,
    error,
    mutate,
  };
}
