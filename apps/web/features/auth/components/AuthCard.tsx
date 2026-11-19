import Link from "next/link";
import type { ReactNode } from "react";
import { VitryBrand } from "@/shared/ui/VitryBrand";
import { ThemeControls } from "@/shared/design/ThemeControls";

export function AuthCard({ title, children, backToLogin = false }: { title?: string; children: ReactNode; backToLogin?: boolean }) {
  return (
    <div className="auth__card">
      <header className="auth__brandline">
        <Link href="/" className="auth__brand" aria-label="VitryNow, página inicial"><VitryBrand /></Link>
        <ThemeControls compact />
      </header>
      {title && <h1 className="auth__title">{title}</h1>}
      {children}
      {backToLogin && (
        <Link href="/login" className="auth__link">
          Voltar ao login
        </Link>
      )}
    </div>
  );
}
