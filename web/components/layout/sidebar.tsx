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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/theme-toggle"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/indicadores", label: "Indicadores", icon: ChartPie  },
  { href: "/sacs", label: "SACs", icon: FileText },
  { href: "/bfs", label: "BFSs", icon: AlertTriangle },
  { href: "/acic", label: "ACICs", icon: FileWarning },
  { href: "/upload", label: "Upload", icon: Upload },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-border bg-background">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between border-b border-border px-6">
          <h1 className="text-xl font-bold bg-linear-to-r from-zinc-900 to-zinc-700 dark:from-zinc-50 dark:to-zinc-300 bg-clip-text text-transparent">
            FLIP Control
          </h1>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-border p-4">
          <div className="flex items-center justify-between gap-4 px-2">
            <span className="text-xs font-medium text-muted-foreground">Tema</span>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  )
}

