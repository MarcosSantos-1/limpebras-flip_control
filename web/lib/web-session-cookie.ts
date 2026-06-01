/**
 * Cookie no **domínio do Next.js** (Vercel/local) para o middleware liberar rotas.
 * O `flip_auth` HttpOnly fica só no domínio da API (Fly); em deploy front≠API o middleware
 * não o enxerga — por isso usamos `flip_web_session` só no browser (não é o segredo de sessão).
 *
 * Sempre cookie de **sessão** (sem Max-Age): ao fechar o navegador o usuário volta à tela de login.
 * "Lembrar" no login só grava usuário/senha no localStorage para preencher os campos.
 */
const WEB_SESSION_COOKIE = "flip_web_session";

export function setWebSessionCookie(): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WEB_SESSION_COOKIE}=1; Path=/; SameSite=Lax${secure}`;
}

export function clearWebSessionCookie(): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${WEB_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
