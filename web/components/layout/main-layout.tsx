"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { Sidebar } from "./sidebar"
import { useAuth } from "@/lib/auth"
import type { AuthPageKey } from "@/lib/api"

interface MainLayoutProps {
  children: React.ReactNode
}

const PAGE_ACCESS_BY_PATH: Record<string, AuthPageKey> = {
  "/": "dashboard",
  "/indicadores": "indicadores",
  "/ipt": "ipt",
  "/ipt/bateria": "ipt",
  "/sacs": "sacs",
  "/bfs": "bfs",
  "/defesa": "defesa",
  "/acic": "acic",
  "/upload": "upload",
  "/admin/users": "admin_users",
}

const IPT_RESTRICTED_ALLOWED_PATHS = ["/ipt", "/ipt/bateria", "/upload"] as const

function getPageKeyForPath(pathname: string): AuthPageKey | undefined {
  const direct = PAGE_ACCESS_BY_PATH[pathname]
  if (direct) return direct
  if (pathname.startsWith("/ipt/")) return "ipt"
  if (pathname.startsWith("/upload")) return "upload"
  if (pathname.startsWith("/indicadores/")) return "indicadores"
  if (pathname.startsWith("/admin/users")) return "admin_users"
  return undefined
}

function isAllowedIptRestrictedPath(pathname: string): boolean {
  return IPT_RESTRICTED_ALLOWED_PATHS.some((allowedPath) => pathname === allowedPath || pathname.startsWith(`${allowedPath}/`))
}

export function MainLayout({ children }: MainLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { user, loading, hasPageAccess, isIptRestrictedUser } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const sidebarWidth = 288 // 18rem (w-72)

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/login")
      return
    }
    if (isIptRestrictedUser && !isAllowedIptRestrictedPath(pathname)) {
      router.replace("/ipt/bateria")
      return
    }
    const pageKey = getPageKeyForPath(pathname)
    if (pageKey && !hasPageAccess(pageKey)) {
      router.replace(isIptRestrictedUser ? "/ipt/bateria" : "/")
    }
  }, [hasPageAccess, isIptRestrictedUser, loading, pathname, router, user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="rounded-2xl border border-border bg-card px-6 py-5 text-sm text-muted-foreground shadow-sm">
          Carregando acesso...
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="rounded-2xl border border-border bg-card px-6 py-5 text-sm text-muted-foreground shadow-sm text-center space-y-3 max-w-sm">
          <p>Você não está logado. Abrindo a tela de login…</p>
          <p className="text-xs">
            Se nada mudar em alguns segundos,{" "}
            <Link href="/login" className="font-medium text-primary underline underline-offset-2">
              clique aqui para entrar
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background overflow-x-hidden">
      <Sidebar collapsed={collapsed} />
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="sidebar-toggle fixed left-3 top-3 z-50 rounded-md border border-border bg-card/95 px-2 py-1 text-xs font-semibold text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground print:hidden"
        aria-label={collapsed ? "Mostrar barra lateral" : "Ocultar barra lateral"}
      >
        {collapsed ? "☰ Menu" : "✕ Sidebar"}
      </button>
      <main
        className={`relative transition-all duration-300 overflow-x-hidden ${collapsed ? "ml-0" : "ml-72"}`}
        style={{ width: collapsed ? "100%" : `calc(100% - ${sidebarWidth}px)` }}
      >
        <div className="absolute inset-0 grid-pattern -z-10" />
        <div className="p-6 min-w-0">
          {children}
        </div>
      </main>
    </div>
  )
}

