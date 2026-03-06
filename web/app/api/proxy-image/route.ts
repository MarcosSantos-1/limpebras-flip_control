/**
 * Proxy para carregar imagens externas (ex: Firebase Storage) sem CORS.
 * Usado na geração de PDF quando as fotos estão em URLs externas.
 */
import { NextRequest, NextResponse } from "next/server";

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
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "FlipControl-PDF/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Falha ao buscar imagem: ${res.status}` }, { status: res.status });
    }
    const blob = await res.blob();
    const contentType = res.headers.get("content-type") || blob.type || "image/png";
    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    console.error("Proxy image error:", err);
    return NextResponse.json({ error: "Erro ao carregar imagem" }, { status: 500 });
  }
}
