"use client";

import { useState } from "react";
import { useAuthGateway } from "@/core/services/AuthServices";

export function useResetPassword(token: string) {
  const auth = useAuthGateway();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [failures, setFailures] = useState(0);
  const [done, setDone] = useState(false);

  async function submit(newPassword: string, email: string) {
    setLoading(true);
    setError(null);
    setStatus(null);
    const result = await auth.resetPassword(token, newPassword, email);
    setLoading(false);
    if (!result.ok) {
      setStatus(result.status);
      setFailures((previous) => previous + 1);
      return setError(result.error);
    }
    setDone(true);
  }

  return { submit, loading, error, status, failures, done };
}
