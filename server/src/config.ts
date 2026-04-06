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

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  authSecret: authSecret || fallbackDevSecret,
  /** Domicílios IBGE 2024 para cálculo do IRD */
  domicilios: 511_093,
  /** Valor mensal do contrato (R$) - base para cálculo da glosa. Fonte: GLOSA.xlsx */
  valorMensalContrato: Number(process.env.VALOR_MENSAL_CONTRATO ?? 14573274.23),
};
