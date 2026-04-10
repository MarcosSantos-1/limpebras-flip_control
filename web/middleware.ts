import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|json)$/)
  ) {
    return NextResponse.next();
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  /**
   * Só `flip_web_session` (setado pelo front após login válido). Não usar `flip_auth` aqui:
   * em dev a API pode deixar `flip_auth` HttpOnly no mesmo host; se a sessão JS expirar, o cliente
   * apaga só `flip_web_session` e o middleware continuaria achando que há sessão → loop /login ↔ /.
   */
  const hasSessionCookie = request.cookies.has("flip_web_session");

  if (!hasSessionCookie && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
