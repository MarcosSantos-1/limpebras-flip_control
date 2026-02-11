import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "FLIP Control - Sistema de Gestão ADC",
  description: "Sistema de gestão e acompanhamento do ADC/FLIP - Limpebras Lote III",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
          storageKey="flip-theme"
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
