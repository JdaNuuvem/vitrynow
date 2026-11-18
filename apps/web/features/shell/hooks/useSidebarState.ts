"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "panel.sidebar.collapsed";
const AUTO_COLLAPSE_BELOW = 1400;
const MOBILE_MAX_WIDTH = 800;

export function useSidebarState() {
  const [collapsedPreference, setCollapsedPreference] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    setCollapsedPreference(stored === null ? window.innerWidth <= AUTO_COLLAPSE_BELOW : stored === "1");

    const syncMobile = () => setIsMobile(window.innerWidth <= MOBILE_MAX_WIDTH);
    syncMobile();
    window.addEventListener("resize", syncMobile);
    return () => window.removeEventListener("resize", syncMobile);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedPreference((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // armazenamento indisponível: o estado só vale para esta sessão
      }
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return { collapsed: collapsedPreference && !isMobile, toggleCollapsed, mobileOpen, openMobile, closeMobile };
}
