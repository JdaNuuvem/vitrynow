"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "panel.inicio.hideRevenue";

export function useHiddenValues() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const toggle = useCallback(() => {
    setHidden((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // sem armazenamento: a preferência vale só para esta sessão
      }
      return next;
    });
  }, []);

  return { hidden, toggle };
}
