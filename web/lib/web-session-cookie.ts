/**
 * Cookie no **domínio do Next.js** (Vercel/local) para o middleware liberar rotas.
 * O `flip_auth` HttpOnly fica só no domínio da API (Fly); em deploy front≠API o middleware
 * não o enxerga — por isso usamos `flip_web_session` só no browser (não é o segredo de sessão).
 */
const WEB_SESSION_COOKIE = "flip_web_session";

export function setWebSessionCookie(rememberMe: boolean): void {
  if (typeof document === "undefined") return;
  const maxAgeSec = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WEB_SESSION_COOKIE}=1; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${secure}`;
}

export function clearWebSessionCookie(): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WEB_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
