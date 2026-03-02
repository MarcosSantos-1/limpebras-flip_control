"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { 
  LayoutDashboard, 
  FileText, 
  AlertTriangle, 
  Upload, 
  Settings,
  FileWarning,
  ChartPie,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/indicadores", label: "Indicadores", icon: ChartPie  },
  { href: "/ipt", label: "IPT", icon: Activity },
  { href: "/sacs", label: "SACs", icon: FileText },
  { href: "/bfs", label: "BFSs", icon: AlertTriangle },
  { href: "/acic", label: "ACICs", icon: FileWarning },
  { href: "/upload", label: "Upload", icon: Upload },
]

interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        "app-sidebar fixed left-0 top-0 z-40 h-screen border-r border-border/70 transition-all duration-300",
        "bg-linear-to-b from-blue-600/8 via-background to-cyan-600/5 dark:from-cyan-500/15 dark:via-background dark:to-cyan-500/10",
        "backdrop-blur-sm shadow-[0_0_50px_-25px_rgba(99,102,241,0.55)]",
        collapsed ? "w-0 -translate-x-full opacity-0 pointer-events-none" : "w-72"
      )}
    >
      <div className="flex h-full flex-col">
        <div className="flex h-20 pt-12 items-center justify-between border-b border-border/70 px-6">
          <h1 className="text-2xl font-extrabold bg-linear-to-r from-zinc-800 via-indigo-700 to-blue-700 dark:from-zinc-300 dark:via-indigo-300 dark:to-blue-300 bg-clip-text text-transparent tracking-tight">
            ADC Control
          </h1>
          <Settings className="h-4 w-4 text-indigo-500/70" />
        </div>
        <nav className="flex-1 space-y-2 p-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-200",
                  isActive
                    ? "bg-linear-to-r from-indigo-600/20 to-cyan-500/20 text-foreground border border-indigo-500/35 shadow-sm"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground border border-transparent hover:border-violet-500/15"
                )}
              >
                <Icon className={cn("h-5 w-5 transition-transform group-hover:scale-110", isActive ? "text-blue-500" : "")} />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-border/70 p-4 bg-background/50">
          <div className="flex items-center justify-between gap-4 px-2">
            <span className="text-xs font-medium text-muted-foreground">Tema</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  )
}

