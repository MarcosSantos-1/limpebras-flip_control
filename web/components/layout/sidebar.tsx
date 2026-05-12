"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
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
  /** Quando true, o item aparece para qualquer usuário autenticado (sem checar page_permissions). */
  skipAccessCheck?: boolean
  /** Abre em nova aba e usa <a> em vez de rota interna. */
  external?: boolean
  match?: "exact" | "prefix"
}

const navItems: SidebarNavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, pageKey: "dashboard" as AuthPageKey },
  { href: "/indicadores", label: "Indicadores", icon: ChartPie, pageKey: "indicadores" as AuthPageKey },
  { href: "/ipt", label: "IPT", icon: Activity, pageKey: "ipt" as AuthPageKey },
  { href: "/sacs", label: "SACs", icon: FileText, pageKey: "sacs" as AuthPageKey },
  { href: "/bfs", label: "BFSs", icon: FileWarning, pageKey: "bfs" as AuthPageKey },
  { href: "/defesa", label: "Defesa / Contestação", icon: ShieldCheck, pageKey: "defesa" as AuthPageKey },
  { href: "/acic", label: "ACICs", icon: AlertTriangle, pageKey: "acic" as AuthPageKey },
  {
    href: "https://geoplano-limpebras.vercel.app/",
    label: "Plano de trabalho",
    icon: Map,
    skipAccessCheck: true,
    external: true,
  },
  { href: "/upload", label: "Upload", icon: Upload, pageKey: "upload" as AuthPageKey },
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
  const sourceItems = isIptRestrictedUser ? iptRestrictedNavItems : navItems
  const visibleItems = sourceItems.filter(
    (item) => item.skipAccessCheck === true || (item.pageKey != null && hasPageAccess(item.pageKey))
  )

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
        <div className="flex h-20 pt-12 items-center justify-start border-b border-border/70 px-6">
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
              className="hidden h-10 mb-2 w-auto max-w-[230px] object-contain object-left dark:block"
              style={{ width: "auto", height: "auto" }}
              priority
            />
          </Link>
        </div>
        <nav className="flex-1 min-h-0 space-y-2 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const isActive = item.external
              ? false
              : item.match === "exact"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`)
            const className = cn(
              "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200",
              isActive
                ? "bg-linear-to-r from-indigo-600/20 to-cyan-500/20 text-foreground border border-indigo-500/35 shadow-sm"
                : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground border border-transparent hover:border-violet-500/15"
            )
            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  <Icon className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110" />
                  {item.label}
                </a>
              )
            }
            return (
              <Link key={item.href} href={item.href} className={className}>
                <Icon
                  className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive ? "text-blue-500" : "")}
                />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-border/70 p-4 bg-background/50">
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

