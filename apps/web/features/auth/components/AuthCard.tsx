import Link from "next/link";
import type { ReactNode } from "react";

export function AuthCard({ title, children, backToLogin = false }: { title?: string; children: ReactNode; backToLogin?: boolean }) {
  return (
    <div className="auth__card">
      {title && <h1 className="auth__title">{title}</h1>}
      {children}
      {backToLogin && (
        <Link href="/login" className="auth__link">
          Voltar pro login
        </Link>
      )}
    </div>
  );
}
