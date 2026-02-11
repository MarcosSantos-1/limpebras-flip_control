"use client"

import { Sidebar } from "./sidebar"

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 ml-64 relative">
        <div className="absolute inset-0 grid-pattern -z-10" />
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

