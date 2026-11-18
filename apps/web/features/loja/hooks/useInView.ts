"use client";

import { useEffect, useState } from "react";

// `true` enquanto o elemento está na janela. IntersectionObserver, sem ouvir `scroll`. Sem elemento (outra tela por
// cima) ou sem suporte, fica `false`.
export function useInView(element: Element | null): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!element) {
      setInView(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return inView;
}
