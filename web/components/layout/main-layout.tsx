"use client"

import { useState } from "react"
import { Sidebar } from "./sidebar"

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const sidebarWidth = 288 // 18rem (w-72)

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

