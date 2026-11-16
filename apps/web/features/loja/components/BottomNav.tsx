import { ListIcon, OrdersIcon, SearchIcon } from "../icons";

export type NavTab = "itens" | "pesquisa" | "pedidos";

// Spec 09 §2.3: três destinos, todos com rótulo visível. Os ids ficam (itens/pesquisa/pedidos);
// o que muda é o texto: "Itens" é o cardápio, "Pesquisa" é buscar, "Pedidos" é a lista do aparelho.
const TABS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
  { id: "itens", label: "Cardápio", icon: <ListIcon /> },
  { id: "pesquisa", label: "Buscar", icon: <SearchIcon size="lg" /> },
  { id: "pedidos", label: "Meus pedidos", icon: <OrdersIcon /> },
];

// Barra inferior fixa de navegação. Só renderiza as abas e avisa qual foi tocada. O item ativo
// se distingue por ícone cheio, barra no topo e negrito (não só pela cor).
export function BottomNav({ active, onSelect }: { active: NavTab; onSelect: (tab: NavTab) => void }) {
  return (
    <nav className="loja__nav" aria-label="Navegação do cardápio">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={active === tab.id ? "page" : undefined}
          onClick={() => onSelect(tab.id)}
          className={`loja__nav-tab${active === tab.id ? " loja__nav-tab--active" : ""}`}
        >
          {tab.icon}
          <span className="loja__nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
