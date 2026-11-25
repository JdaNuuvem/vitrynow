import type { Metadata } from "next";
import { ThemeSync } from "@/shared/design/ThemeControls";
import { initializeThemeScript } from "@/shared/design/themePreference";
import "./globals.css";
import "@/shared/design/tokens.css";
import "@/shared/design/components.css";

export const metadata: Metadata = {
  title: "VitryNow",
  icons: { icon: "/vitry-mark.svg" },
  description: "Plataforma própria de pedidos — painel e cardápio online",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: initializeThemeScript }} /></head>
      <body><ThemeSync />{children}</body>
    </html>
  );
}
