export const themePreferences = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof themePreferences)[number];

const themeKey = "vitrynow-theme";
const query = "(prefers-color-scheme: dark)";
const eventName = "vitrynow:theme";
const defaultPreference: ThemePreference = "light";
let temporaryPreference: ThemePreference | undefined;

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return defaultPreference;
  if (temporaryPreference) return temporaryPreference;
  try {
    const stored = window.localStorage.getItem(themeKey);
    return themePreferences.find((preference) => preference === stored) ?? defaultPreference;
  } catch {
    return defaultPreference;
  }
}

export function applyThemePreference(preference = readThemePreference()) {
  const dark = preference === "dark" || (preference === "system" && window.matchMedia?.(query).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference) {
  temporaryPreference = undefined;
  try {
    window.localStorage.setItem(themeKey, preference);
  } catch {
    temporaryPreference = preference;
  }
  applyThemePreference(preference);
  window.dispatchEvent(new Event(eventName));
}

export function subscribeToTheme(notify: () => void) {
  window.addEventListener(eventName, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener("storage", notify);
  };
}

export function subscribeToSystemTheme() {
  const media = window.matchMedia?.(query);
  const sync = () => applyThemePreference();
  sync();
  media?.addEventListener("change", sync);
  window.addEventListener("storage", sync);
  return () => {
    media?.removeEventListener("change", sync);
    window.removeEventListener("storage", sync);
  };
}

export const getServerTheme = () => defaultPreference;

// Executa antes da pintura. Só os três valores conhecidos influenciam o HTML.
export const initializeThemeScript = [
  "(()=>{let p='light';",
  "try{p=localStorage.getItem(" + JSON.stringify(themeKey) + ")||p}catch{}",
  "const dark=p==='dark'||(p==='system'&&typeof matchMedia==='function'&&matchMedia(" + JSON.stringify(query) + ").matches);",
  "document.documentElement.dataset.theme=dark?'dark':'light'})()",
].join("");
