import useSWR from "swr";
import { apiService } from "./api";

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min - alinha com cache do server
const DEDUP_INTERVAL_MS = 30 * 1000; // 30s entre refetches automáticos

export function useDashboardData(periodoInicial: string, periodoFinal: string) {
  const kpisKey = periodoInicial && periodoFinal ? `kpis:${periodoInicial}:${periodoFinal}` : null;
  const sacsKey = periodoInicial && periodoFinal
    ? `sacs:${periodoInicial}:${periodoFinal}:10000`
    : null;
  const cncsKey = "cnc:all";

  const kpisSwr = useSWR(kpisKey, () => apiService.getKPIs(periodoInicial, periodoFinal), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
    revalidateIfStale: true,
  });

  const sacsSwr = useSWR(sacsKey, () =>
    apiService.getSACs({
      periodo_inicial: periodoInicial,
      periodo_final: periodoFinal,
      full: true,
      limit: 10000,
    }), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
  });

  const cncsSwr = useSWR(cncsKey, () =>
    apiService.getCNCs({ page: 1, page_size: 1000 }), {
    revalidateOnFocus: false,
    dedupingInterval: DEDUP_INTERVAL_MS,
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
