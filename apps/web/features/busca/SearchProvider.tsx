"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { PANEL_ROUTES, type PanelRoute } from "@/core/navigation/panelNavigation";
import { Icon } from "@/shared/icons/Icon";
import { Modal } from "@/shared/ui/Modal";
import { buildSearchIndex, searchEntries } from "./searchIndex";
import "./busca.css";

type SearchApi = { openSearch: () => void };

const SearchContext = createContext<SearchApi | null>(null);

export function useSearch(): SearchApi {
  const api = useContext(SearchContext);
  if (!api) throw new Error("useSearch precisa estar dentro de <SearchProvider>");
  return api;
}

export function SearchProvider({ children, routes = PANEL_ROUTES }: { children: ReactNode; routes?: readonly PanelRoute[] }) {
  const router = useRouter();
  const index = useMemo(() => buildSearchIndex(routes), [routes]);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchEntries(index, query), [index, query]);

  const close = useCallback(() => setOpen(false), []);
  const openSearch = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);
  const api = useMemo<SearchApi>(() => ({ openSearch }), [openSearch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.querySelector('[role="dialog"][aria-modal="true"], #shell-sidebar:not([hidden])')) return;
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.max(0, Math.min(current + 1, results.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      go(results[active].href);
    }
  }

  return (
    <SearchContext.Provider value={api}>
      {children}
      <Modal open={open} onClose={close} labelledBy={id + "-title"} width={560} sheetOnMobile fitContent>
          <div className="search-modal__panel">
            <h2 id={id + "-title"} className="sr-only">Buscar no painel</h2>
            <div className="search-modal__field">
              <Icon name="search" size={20} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                placeholder="Buscar por seção ou ação"
                autoComplete="off"
                spellCheck={false}
                aria-label="Buscar no painel"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={results.length > 0}
                aria-controls={results.length ? id + "-results" : undefined}
                aria-activedescendant={results[active] ? id + "-result-" + active : undefined}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
              />
              <kbd>Esc</kbd>
            </div>
            {results.length > 0 ? (
              <ul id={id + "-results"} className="search-modal__list" role="listbox" aria-label="Resultados">
                {results.map((entry, position) => (
                  <li
                    key={entry.id}
                    id={id + "-result-" + position}
                    role="option"
                    aria-selected={position === active}
                    className={position === active ? "is-active" : undefined}
                    onMouseEnter={() => setActive(position)}
                    onClick={() => go(entry.href)}
                  >
                    <Icon name={entry.icon} size={18} />
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="search-modal__empty">Nada encontrado com esse termo. Tente outra palavra.</p>
            )}
            <div className="search-modal__footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> navegar
              </span>
              <span>
                <kbd>Enter</kbd> abrir
              </span>
              <span>
                <kbd>Esc</kbd> fechar
              </span>
            </div>
          </div>
      </Modal>
    </SearchContext.Provider>
  );
}
