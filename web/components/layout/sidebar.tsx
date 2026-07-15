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
  ChevronDown,
  Map,
  Battery,
  Network,
  Send,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth"
import type { AuthPageKey } from "@/lib/api"
import { UserToolbar } from "@/components/motion-ui/user-toolbar"

type SidebarNavItem = {
  href: string
  label: string
  icon: LucideIcon
  pageKey?: AuthPageKey
  skipAccessCheck?: boolean
  external?: boolean
  match?: "exact" | "prefix"
  disabled?: boolean
}

type SidebarNavDotItem = SidebarNavItem & {
  dotClassName: string
}

const navItemsBeforeIpt: SidebarNavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, pageKey: "dashboard" as AuthPageKey },
  { href: "/indicadores", label: "Indicadores", icon: ChartPie, pageKey: "indicadores" as AuthPageKey },
]

const navItemsAfterFlip: SidebarNavItem[] = [
  {
    href: "https://geoplano-limpebras.vercel.app/map",
    label: "Plano de trabalho",
    icon: Map,
    pageKey: "plano_trabalho" as AuthPageKey,
    external: true,
  },
  { href: "/upload", label: "Upload", icon: Upload, pageKey: "upload" as AuthPageKey },
]

const iptNavItems: SidebarNavDotItem[] = [
  {
    href: "/ipt",
    label: "IPT Geral",
    icon: Activity,
    pageKey: "ipt" as AuthPageKey,
    match: "exact" as const,
    dotClassName: "bg-blue-500 shadow-blue-500/40",
  },
  {
    href: "/ipt/bateria",
    label: "Bateria",
    icon: Battery,
    pageKey: "ipt" as AuthPageKey,
    dotClassName: "bg-emerald-500 shadow-emerald-500/40",
  },
  {
    href: "/ipt/cruzamento",
    label: "Cruzamento inteligente",
    icon: Network,
    pageKey: "ipt" as AuthPageKey,
    dotClassName: "bg-violet-500 shadow-violet-500/40",
  },
  {
    href: "/ipt/despachos",
    label: "Despachos SELIMP",
    icon: Send,
    pageKey: "ipt_despachos" as AuthPageKey,
    dotClassName: "bg-amber-500 shadow-amber-500/40",
  },
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

const ccoAfterNavItems: SidebarNavItem[] = [
  { href: "/upload", label: "Upload", icon: Upload, pageKey: "upload" as AuthPageKey },
  {
    href: "https://geoplano-limpebras.vercel.app/map",
    label: "Plano de trabalho",
    icon: Map,
    pageKey: "plano_trabalho" as AuthPageKey,
    external: true,
  },
]

const iptRestrictedNavItems: SidebarNavItem[] = [
  { href: "/ipt/bateria", label: "Análise de Módulos", icon: ChartColumnStacked, pageKey: "ipt" as AuthPageKey },
  { href: "/ipt", label: "IPT", icon: Activity, pageKey: "ipt" as AuthPageKey, match: "exact" as const },
  {
    href: "https://geoplano-limpebras.vercel.app/map",
    label: "GeoPlano / Plano de trabalho",
    icon: Map,
    pageKey: "plano_trabalho" as AuthPageKey,
    external: true,
  },
  { href: "/upload", label: "Uploads", icon: Upload, pageKey: "upload" as AuthPageKey },
]

interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const pathname = usePathname()
  const { user, hasPageAccess, logout, isIptRestrictedUser, isCcoUser, getDefaultAuthorizedPath } = useAuth()

  const canShowItem = (item: SidebarNavItem) =>
    item.disabled === true ||
    item.skipAccessCheck === true ||
    (item.pageKey != null && hasPageAccess(item.pageKey))

  const visibleBeforeIpt = isIptRestrictedUser || isCcoUser ? [] : navItemsBeforeIpt.filter(canShowItem)
  const visibleAfterFlip = isCcoUser
    ? ccoAfterNavItems.filter(canShowItem)
    : isIptRestrictedUser
    ? iptRestrictedNavItems.filter(canShowItem)
    : navItemsAfterFlip.filter(canShowItem)
  const visibleIptItems = isIptRestrictedUser ? [] : iptNavItems.filter(canShowItem)
  const visibleFlipItems = isIptRestrictedUser || isCcoUser ? [] : flipNavItems.filter(canShowItem)
  const visibleUserMenuItems = userMenuItems.filter(canShowItem)

  const isItemActive = (item: SidebarNavItem) =>
    item.disabled || item.external
      ? false
      : item.match === "exact"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`)

  const iptActive = visibleIptItems.some(isItemActive)
  const flipActive = visibleFlipItems.some(isItemActive)
  const [iptOpen, setIptOpen] = useState(false)
  const [flipOpen, setFlipOpen] = useState(false)
  const isIptExpanded = iptOpen || iptActive
  const isFlipExpanded = flipOpen || flipActive

  const renderNavItem = (item: SidebarNavItem, opts?: { dotClassName?: string; compact?: boolean }) => {
    const Icon = item.icon
    const isActive = isItemActive(item)
    const className = cn(
      "group flex items-center gap-2.5 max-[1440px]:gap-2 rounded-xl text-[13px] max-[1440px]:text-xs font-semibold transition-all duration-200",
      opts?.compact ? "px-2.5 py-2 max-[1440px]:py-1.5" : "px-3 py-2.5 max-[1440px]:px-2.5 max-[1440px]:py-1.5",
      item.disabled
        ? "cursor-not-allowed border border-transparent text-muted-foreground/60 opacity-70"
        : isActive
          ? "bg-linear-to-r from-indigo-600/20 to-cyan-500/20 text-foreground border border-indigo-500/35 shadow-sm"
          : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground border border-transparent hover:border-violet-500/15"
    )
    const content = (
      <>
        {opts?.dotClassName && (
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full shadow-sm",
              item.disabled ? "opacity-50" : "",
              opts.dotClassName
            )}
          />
        )}
        <Icon
          className={cn(
            "h-[18px] w-[18px] max-[1440px]:h-4 max-[1440px]:w-4 shrink-0 transition-transform",
            item.disabled ? "" : "group-hover:scale-110",
            isActive ? "text-blue-500" : ""
          )}
        />
        <span className="truncate">{item.label}</span>
        {item.disabled && (
          <span className="ml-auto rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Em breve
          </span>
        )}
      </>
    )

    if (item.disabled) {
      return (
        <span key={`${item.href}-${item.label}`} className={className} aria-disabled="true">
          {content}
        </span>
      )
    }

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
        collapsed ? "w-0 -translate-x-full opacity-0 pointer-events-none" : "w-72 max-[1440px]:w-60"
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-24 max-[1440px]:h-20 items-start justify-start border-b border-border/70 px-6 max-[1440px]:px-4 pb-3 pt-8 max-[1440px]:pt-6 max-[1440px]:pb-2.5">
          <Link href={getDefaultAuthorizedPath()} className="ml-6 max-[1440px]:ml-2 flex shrink-0 items-center" aria-label="Limpebras — início">
            <Image
              src="/logotipo.png"
              alt="Limpebras"
              width={180}
              height={48}
              className="h-10 max-[1440px]:h-8 w-auto max-w-[200px] max-[1440px]:max-w-[160px] object-contain object-left dark:hidden"
              style={{ width: "auto", height: "auto" }}
              priority
            />
            <Image
              src="/logotipo-white.png"
              alt="Limpebras"
              width={230}
              height={55}
              className="hidden h-10 max-[1440px]:h-8 w-auto max-w-[230px] max-[1440px]:max-w-[180px] object-contain object-left dark:block"
              style={{ width: "auto", height: "auto" }}
              priority
            />
          </Link>
        </div>

        <nav className="flex-1 min-h-0 space-y-1.5 max-[1440px]:space-y-1 overflow-y-auto p-3 max-[1440px]:p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleBeforeIpt.map((item) => renderNavItem(item))}

          {visibleIptItems.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-background/40 p-1.5 max-[1440px]:p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setIptOpen((prev) => !prev)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2.5 py-2 max-[1440px]:py-1.5 text-left text-[13px] max-[1440px]:text-xs font-semibold transition",
                  iptActive
                    ? "bg-indigo-500/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
                )}
                aria-expanded={isIptExpanded}
              >
                <span className="flex items-center gap-2.5 max-[1440px]:gap-2">
                  <Activity className="h-[18px] w-[18px] max-[1440px]:h-4 max-[1440px]:w-4 shrink-0" />
                  <span>IPT</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isIptExpanded ? "rotate-180" : "")} />
              </button>
              {isIptExpanded && (
                <div className="mt-1.5 space-y-0.5">
                  {visibleIptItems.map((item) =>
                    renderNavItem(item, { dotClassName: item.dotClassName, compact: true })
                  )}
                </div>
              )}
            </div>
          )}

          {visibleFlipItems.length > 0 && (
            <div className="rounded-2xl border border-border/60 bg-background/40 p-1.5 max-[1440px]:p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setFlipOpen((prev) => !prev)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2.5 py-2 max-[1440px]:py-1.5 text-left text-[13px] max-[1440px]:text-xs font-semibold transition",
                  flipActive
                    ? "bg-cyan-500/10 text-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"
                )}
                aria-expanded={isFlipExpanded}
              >
                <span className="flex items-center gap-2.5 max-[1440px]:gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-500 shadow-sm shadow-cyan-500/40" />
                  <span>FLIP</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", isFlipExpanded ? "rotate-180" : "")} />
              </button>
              {isFlipExpanded && (
                <div className="mt-1.5 space-y-0.5">
                  {visibleFlipItems.map((item) =>
                    renderNavItem(item, { dotClassName: item.dotClassName, compact: true })
                  )}
                </div>
              )}
            </div>
          )}

          {visibleAfterFlip.map((item) => renderNavItem(item))}
        </nav>

        <div className="border-t border-border/70 bg-background/50 p-4 max-[1440px]:p-3">
          <div className="px-2 max-[1440px]:px-1">
            <UserToolbar
              displayName={user?.display_name || user?.username || "Sem sessão"}
              username={user?.username || "usuario"}
              roleLabel={user?.role === "host" ? "Host" : "Usuário"}
              statusLabel={user?.status === "active" ? "Ativo" : "Inativo"}
              menuItems={visibleUserMenuItems.map((item) => ({
                href: item.href,
                label: item.label,
                icon: item.icon,
              }))}
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </div>
    </aside>
  )
}
