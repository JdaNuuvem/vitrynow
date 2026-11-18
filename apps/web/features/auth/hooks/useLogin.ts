"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuthGateway } from "@/core/services/AuthServices";

export function useLogin() {
  const auth = useAuthGateway();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(email: string, password: string) {
    setLoading(true);
    setError(null);
    const result = await auth.login(email, password);
    setLoading(false);
    if (result.ok) return router.push("/dashboard");
    setError(result.status === 429 ? "Muitas tentativas. Aguarde um minuto e tente de novo." : "E-mail ou senha inválidos.");
  }

  return { submit, loading, error };
}
