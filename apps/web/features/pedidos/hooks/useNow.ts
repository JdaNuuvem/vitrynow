"use client";

import { useEffect, useState } from "react";

// Relógio que anda sozinho (a cada `everyMs`) para o "há N min" dos cartões não congelar.
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
