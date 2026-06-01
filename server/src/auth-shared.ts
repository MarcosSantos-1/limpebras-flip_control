export const APP_PAGE_KEYS = [
  "dashboard",
  "indicadores",
  "ipt",
  "ipt_restrito",
  "sacs",
  "bfs",
  "defesa",
  "acic",
  "upload",
  "admin_users",
] as const;

export type AppPageKey = (typeof APP_PAGE_KEYS)[number];

export const DEFAULT_USER_ALLOWED_PAGES: AppPageKey[] = [
  "dashboard",
  "indicadores",
  "ipt",
  "sacs",
  "bfs",
  "acic",
];

export type UserRole = "host" | "user";

export function isAppPageKey(value: string): value is AppPageKey {
  return (APP_PAGE_KEYS as readonly string[]).includes(value);
}

export function buildDefaultPermissions(role: UserRole): Record<AppPageKey, boolean> {
  const entries = APP_PAGE_KEYS.map((pageKey) => {
    const allowed = role === "host" ? true : DEFAULT_USER_ALLOWED_PAGES.includes(pageKey);
    return [pageKey, allowed] as const;
  });
  return Object.fromEntries(entries) as Record<AppPageKey, boolean>;
}
