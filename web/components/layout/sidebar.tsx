"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  LayoutDashboard,
  FileText,
  AlertTriangle,
  Upload,
  FileWarning,
  ChartPie,
  Activity,
  ShieldCheck,
  ChartColumnStacked,
  Users,
  LogOut,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Map,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"
import { useAuth } from "@/lib/auth"
import type { AuthPageKey } from "@/lib/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type SidebarNavItem = {
  href: string
  label: string
  icon: LucideIcon
  pageKey?: AuthPageKey
  skipAccessCheck?: boolean
  external?: boolean
  match?: "exact" | "prefix"
}

type SidebarNavDotItem = SidebarNavItem & {
  dotClassName: string
}

const navItems: SidebarNavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, pageKey: "dashboard" as AuthPageKey },
  { href: "/indicadores", label: "Indicadores", icon: ChartPie, pageKey: "indicadores" as AuthPageKey },
  { href: "/ipt", label: "IPT", icon: Activity, pageKey: "ipt" as AuthPageKey },
  {
    href: "https://geoplano-limpebras.vercel.app/",
    label: "Plano de trabalho",
    icon: Map,
    skipAccessCheck: true,
    external: true,
  },
  { href: "/upload", label: "Upload", icon: Upload, pageKey: "upload" as AuthPageKey },
]

const flipNavItems: SidebarNavDotItem[] = [
  {
    href: "/sacs",
    label: "SACs",
    icon: FileText,
    pageKey: "sacs" as AuthPageKey,
    dotClassName: "bg-sky-500 shadow-sky-500/40",
  },
  {
    href: "/bfs",
    label: "BFSs",
    icon: FileWarning,
    pageKey: "bfs" as AuthPageKey,
    dotClassName: "bg-amber-500 shadow-amber-500/40",
  },
  {
    href: "/defesa",
    label: "Defesa / Contestação",
    icon: ShieldCheck,
    pageKey: "defesa" as AuthPageKey,
    dotClassName: "bg-emerald-500 shadow-emerald-500/40",
  },
  {
    href: "/acic",
    label: "ACICs",
    icon: AlertTriangle,
    pageKey: "acic" as AuthPageKey,
    dotClassName: "bg-rose-500 shadow-rose-500/40",
  },
]

const userMenuItems: SidebarNavItem[] = [
  { href: "/admin/users", label: "Usuários", icon: Users, pageKey: "admin_users" as AuthPageKey },
]

const iptRestrictedNavItems: SidebarNavItem[] = [
  { href: "/ipt/bateria", label: "Análise de Módulos", icon: ChartColumnStacked, pageKey: "ipt" as AuthPageKey },
  { href: "/ipt", label: "IPT", icon: Activity, pageKey: "ipt" as AuthPageKey, match: "exact" as const },
  {
    href: "https://geoplano-limpebras.vercel.app/",
    label: "GeoPlano / Plano de trabalho",
    icon: Map,
    skipAccessCheck: true,
    external: true,
  },
  { href: "/upload", label: "Uploads", icon: Upload, pageKey: "upload" as AuthPageKey },
]

interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const pathname = usePathname()
  const { user, hasPageAccess, logout, isIptRestrictedUser, getDefaultAuthorizedPath } = useAuth()

  const canShowItem = (item: SidebarNavItem) =>
    item.skipAccessCheck === true || (item.pageKey != null && hasPageAccess(item.pageKey))

  const sourceItems = isIptRestrictedUser ? iptRestrictedNavItems : navItems
  const visibleItems = sourceItems.filter(canShowItem)
  const visibleFlipItems = isIptRestrictedUser ? [] : flipNavItems.filter(canShowItem)
  const visibleUserMenuItems = userMenuItems.filter(canShowItem)

  const isItemActive = (item: SidebarNavItem) =>
    item.external
      ? false
      : item.match === "exact"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`)

  const flipActive = visibleFlipItems.some(isItemActive)
  const [flipOpen, setFlipOpen] = useState(false)
  const isFlipExpanded = flipOpen || flipActive

  const renderNavItem = (item: SidebarNavItem, opts?: { dotClassName?: string; compact?: boolean }) => {
    const Icon = item.icon
    const isActive = isItemActive(item)
    const className = cn(
      "group flex items-center gap-3 rounded-xl text-sm font-semibold transition-all duration-200",
      opts?.compact ? "px-3 py-2.5" : "px-4 py-3",
      isActive
        ? "bg-linear-to-r from-indigo-600/20 to-cyan-500/20 text-foreground border border-indigo-500/35 shadow-sm"
        : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground border border-transparent hover:border-violet-500/15"
    )
    const content = (
      <>
        {opts?.dotClassName && (
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full shadow-sm", opts.dotClassName)} />
        )}
        <Icon className={cn("h-5 w-5 shrink-0 transition-transform group-hover:scale-110", isActive ? "text-blue-500" : "")} />
        <span className="truncate">{item.label}</span>
      </>
    )

    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      )
    }

    return (
      <Link key={item.href} href={item.href} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <aside
      className={cn(
        "app-sidebar fixed left-0 top-0 z-40 h-screen border-r border-border/70 transition-all duration-300",
        "bg-linear-to-b from-blue-600/8 via-background to-cyan-600/5 dark:from-cyan-500/15 dark:via-background dark:to-cyan-500/10",
        "backdrop-blur-sm shadow-[0_0_50px_-25px_rgba(99,102,241,0.55)]",
        collapsed ? "w-0 -translate-x-full opacity-0 pointer-events-none" : "w-72"
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-24 items-center justify-start border-b border-border/70 px-6 pb-4 pt-[15px]">
          <Link href={getDefaultAuthorizedPath()} className="ml-6 flex shrink-0 items-center" aria-label="Limpebras — início">
            <Image
              src="/logotipo.png"
              alt="Limpebras"
              width={180}
              height={48}
              className="h-10 w-auto max-w-[200px] object-contain object-left dark:hidden"
              style={{ width: "auto", height: "auto" }}
              priority
            />
            <Image
              src="/logotipo-white.png"
              alt="Limpebras"
              width={230}
              height={55}
              className="hidden h-10 w-auto max-w-[230px] object-contain object-left dark:block"
              style={{ width: "auto", height: "auto" }}
              priority
            />
          </Link>
        </div>

        <nav className="flex-1 min-h-0 space-y-2 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleItems.map((item) => renderNavItem(item))}

          {visibleFlipItems.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-background/40 p-2 shadow-sm">
              <button
                type="button"
                onClick={() => setFlipOpen((prev) => !prev)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition",
                  flipActive
                    ? "bg-cyan-500/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
                )}
                aria-expanded={isFlipExpanded}
              >
                <span className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-sm shadow-cyan-500/40" />
                  <span>FLIP</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isFlipExpanded ? "rotate-180" : "")} />
              </button>
              {isFlipExpanded && (
                <div className="mt-2 space-y-1">
                  {visibleFlipItems.map((item) =>
                    renderNavItem(item, { dotClassName: item.dotClassName, compact: true })
                  )}
                </div>
              )}
            </div>
          )}
        </nav>

        <div className="border-t border-border/70 bg-background/50 p-4">
          <div className="px-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-linear-to-r from-background via-background to-cyan-500/5 px-3 py-3 text-left shadow-sm transition hover:border-blue-400/35 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-blue-600 to-cyan-500 text-white shadow-md">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {user?.display_name || user?.username || "Sem sessão"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-medium text-blue-700 dark:text-blue-300">
                        {user?.role === "host" ? "Host" : "Usuário"}
                      </span>
                      <span className="truncate">
                        {user?.status === "active" ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                  </div>
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground transition group-data-[state=open]:rotate-180" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="top" className="w-72 rounded-2xl border-border/80 p-3 shadow-xl">
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-3">
                    <div className="text-sm font-semibold text-foreground">
                      {user?.display_name || user?.username || "Sem sessão"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      @{user?.username || "usuario"}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                        {user?.role === "host" ? "Host" : "Usuário padrão"}
                      </span>
                      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        {user?.status === "active" ? "Status ativo" : "Status inativo"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-border/70 px-3 py-2.5">
                    <span className="text-sm font-medium text-foreground">Tema</span>
                    <ThemeToggle />
                  </div>

                  {visibleUserMenuItems.length > 0 && (
                    <div className="space-y-1 rounded-xl border border-border/70 p-1.5">
                      {visibleUserMenuItems.map((item) => renderNavItem(item, { compact: true }))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <LogOut className="h-4 w-4" />
                    Sair
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </aside>
  )
}
