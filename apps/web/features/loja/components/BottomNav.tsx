import { ListIcon, OrdersIcon, SearchIcon } from "../icons";

export type NavTab = "itens" | "pesquisa" | "pedidos";

const TABS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
  { id: "itens", label: "Itens", icon: <ListIcon /> },
  { id: "pesquisa", label: "Pesquisa", icon: <SearchIcon size="lg" /> },
  { id: "pedidos", label: "Pedidos", icon: <OrdersIcon /> },
];

// Barra inferior fixa de navegação. Só renderiza as abas e avisa qual foi tocada.
export function BottomNav({ active, onSelect }: { active: NavTab; onSelect: (tab: NavTab) => void }) {
  return (
    <nav className="loja__nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={`loja__nav-tab${active === tab.id ? " loja__nav-tab--active" : ""}`}
        >
          {tab.icon}
          {active === tab.id && <span className="loja__nav-label">{tab.label}</span>}
        </button>
      ))}
    </nav>
  );
}
