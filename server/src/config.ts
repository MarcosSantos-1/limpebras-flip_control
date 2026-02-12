import "dotenv/config";

const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required("DATABASE_URL"),
  /** Domicílios IBGE 2024 para cálculo do IRD */
  domicilios: 511_093,
};
