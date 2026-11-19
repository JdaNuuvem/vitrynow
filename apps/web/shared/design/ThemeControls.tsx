"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/shared/icons/Icon";
import { getServerTheme, readThemePreference, setThemePreference, subscribeToSystemTheme, subscribeToTheme, themePreferences } from "./themePreference";

const labels = { light: "Claro", dark: "Escuro", system: "Sistema" };

export function ThemeSync() {
  useEffect(subscribeToSystemTheme, []);
  return null;
}

export function ThemeControls({ compact = false }: { compact?: boolean }) {
  const preference = useSyncExternalStore(subscribeToTheme, readThemePreference, getServerTheme);
  return (
    <label className="ds-theme-control">
      <Icon name={preference === "dark" ? "moon" : "sun"} size={17} />
      {!compact && <span>Tema</span>}
      <select aria-label="Tema de cores" value={preference} onChange={(event) => {
        const selected = themePreferences.find((value) => value === event.target.value);
        if (selected) setThemePreference(selected);
      }}>
        {themePreferences.map((theme) => <option key={theme} value={theme}>{labels[theme]}</option>)}
      </select>
    </label>
  );
}
