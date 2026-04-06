import "dotenv/config";

const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

const authSecret = process.env.AUTH_SECRET?.trim();
const fallbackDevSecret = "dev-auth-secret-change-me";

if (!authSecret && process.env.NODE_ENV === "production") {
  throw new Error("Missing env: AUTH_SECRET");
}

const envInt = (key: string, fallback: number): number => {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Intervalo mínimo entre UPDATE de last_seen_at por sessão (reduz writes no Neon). */
const authLastSeenThrottleMs = envInt("AUTH_LAST_SEEN_THROTTLE_MS", 10 * 60 * 1000);

/** TTL do cache in-memory de KPIs/SACs/CNCs/IPT (ms). */
const cacheTtlMs = envInt("CACHE_TTL_MS", 2 * 60 * 1000);

/** Máximo de conexões no pool pg (0 = default do driver). */
const dbPoolMax = envInt("DB_POOL_MAX", 0);

const dbIdleTimeoutMs = envInt("DB_IDLE_TIMEOUT_MS", 30_000);

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  authSecret: authSecret || fallbackDevSecret,
  /** Mínimo entre atualizações de last_seen_at por sessão (memória por processo). */
  authLastSeenThrottleMs: Math.max(60_000, authLastSeenThrottleMs),
  /** TTL do cache em memória das rotas pesadas. */
  cacheTtlMs: Math.max(10_000, cacheTtlMs),
  /** Pool: máximo de clientes (0 = default). */
  dbPoolMax: dbPoolMax > 0 ? dbPoolMax : undefined,
  dbIdleTimeoutMs: dbIdleTimeoutMs > 0 ? dbIdleTimeoutMs : undefined,
  /** Domicílios IBGE 2024 para cálculo do IRD */
  domicilios: 511_093,
  /** Valor mensal do contrato (R$) - base para cálculo da glosa. Fonte: GLOSA.xlsx */
  valorMensalContrato: Number(process.env.VALOR_MENSAL_CONTRATO ?? 14573274.23),
};
