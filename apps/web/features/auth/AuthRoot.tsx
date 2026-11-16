"use client";

import { useMemo, type ReactNode } from "react";
import { AuthServicesProvider } from "@/core/services/AuthServices";
import { createHttpAuthGateway } from "@/core/services/createHttpAuthGateway";
import "@/shared/styles/panel-tokens.css";
import "./auth.css";

// Raiz de composição das telas públicas de autenticação: escolhe a implementação HTTP do
// gateway uma vez e entrega pro resto via contexto.
export function AuthRoot({ children }: { children: ReactNode }) {
  const auth = useMemo(() => createHttpAuthGateway(), []);
  return (
    <AuthServicesProvider auth={auth}>
      <main className="auth">{children}</main>
    </AuthServicesProvider>
  );
}
