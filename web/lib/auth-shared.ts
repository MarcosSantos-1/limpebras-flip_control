export const AUTH_PAGE_KEYS = [
  "dashboard",
  "indicadores",
  "ipt",
  "sacs",
  "bfs",
  "defesa",
  "acic",
  "upload",
  "admin_users",
] as const;

export type AuthPageKey = (typeof AUTH_PAGE_KEYS)[number];
