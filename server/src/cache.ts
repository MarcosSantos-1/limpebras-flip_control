/**
 * Cache in-memory com TTL para reduzir consultas ao Neon (Network Transfer).
 * Cacheia respostas pesadas de KPIs, SACs, CNCs e IPT preview.
 */

const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutos

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

/** Gera chave de cache a partir de prefixo e params */
export function cacheKey(prefix: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((k) => params[k] != null && params[k] !== "")
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  return `${prefix}:${sorted}`;
}

/** Obtém do cache se válido */
export function get<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

/** Salva no cache com TTL opcional */
export function set<T>(key: string, data: T, ttlMs = DEFAULT_TTL_MS): void {
  store.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/** Obtém ou executa e cacheia */
export async function getOrSet<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const cached = get<T>(key);
  if (cached != null) return cached;
  const data = await fn();
  set(key, data, ttlMs);
  return data;
}

/** Limpa entradas por prefixo (ex: "sacs", "cnc", "kpis", "ipt") */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(`${prefix}:`) || key === prefix) {
      store.delete(key);
    }
  }
}

/** Limpa todo o cache */
export function clearAll(): void {
  store.clear();
}
