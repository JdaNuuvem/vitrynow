"use client";

import { useState } from "react";
import { useAuthGateway } from "@/core/services/AuthServices";

export function useResetPassword(token: string) {
  const auth = useAuthGateway();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(newPassword: string) {
    setLoading(true);
    setError(null);
    const result = await auth.resetPassword(token, newPassword);
    setLoading(false);
    if (!result.ok) return setError(result.error);
    setDone(true);
  }

  return { submit, loading, error, done };
}
