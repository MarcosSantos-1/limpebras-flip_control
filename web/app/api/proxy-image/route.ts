/**
 * Proxy para carregar imagens externas (ex: Firebase Storage) sem CORS.
 * Usado na geração de PDF quando as fotos estão em URLs externas.
 * LRU em memória por instância reduz downloads repetidos do Storage na mesma janela.
 */
import { NextRequest, NextResponse } from "next/server";

const PROXY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_PROXY_CACHE_ENTRIES = 48;

type CacheEntry = { buffer: ArrayBuffer; contentType: string; expiresAt: number };

/** Map preserva ordem de inserção; usamos delete+set para LRU simples. */
const proxyImageCache = new Map<string, CacheEntry>();

function cacheGet(url: string): CacheEntry | null {
  const e = proxyImageCache.get(url);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    proxyImageCache.delete(url);
    return null;
  }
  proxyImageCache.delete(url);
  proxyImageCache.set(url, e);
  return e;
}

function cacheSet(url: string, buffer: ArrayBuffer, contentType: string): void {
  if (proxyImageCache.has(url)) proxyImageCache.delete(url);
  proxyImageCache.set(url, {
    buffer,
    contentType,
    expiresAt: Date.now() + PROXY_CACHE_TTL_MS,
  });
  while (proxyImageCache.size > MAX_PROXY_CACHE_ENTRIES) {
    const oldest = proxyImageCache.keys().next().value;
    if (oldest) proxyImageCache.delete(oldest);
    else break;
  }
}

function isAllowedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.protocol === "https:" &&
      (url.hostname === "firebasestorage.googleapis.com" ||
        url.hostname.endsWith(".firebasestorage.app"))
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !isAllowedUrl(url)) {
    return NextResponse.json({ error: "URL inválida ou não permitida" }, { status: 400 });
  }

  const cached = cacheGet(url);
  if (cached) {
    return new NextResponse(cached.buffer, {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "private, max-age=900",
      },
    });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "FlipControl-PDF/1.0" },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Falha ao buscar imagem: ${res.status}` }, { status: res.status });
    }
    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/jpeg";
    cacheSet(url, buffer, contentType);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch (err) {
    console.error("Proxy image error:", err);
    return NextResponse.json({ error: "Erro ao carregar imagem" }, { status: 500 });
  }
}
