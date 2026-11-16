import type { IconName } from "@/shared/icons/Icon";

export type PanelRoute = {
  id: string;
  label: string;
  tooltip: string;
  href: string;
  icon: IconName;
  exact?: boolean;
  keywords: string[];
};

export const PANEL_ROUTES: readonly PanelRoute[] = [
  { id: "inicio", label: "Início", tooltip: "Início", href: "/dashboard", icon: "home", exact: true, keywords: ["resumo", "home", "faturamento", "painel"] },
  { id: "pedidos", label: "Pedidos", tooltip: "Pedidos", href: "/dashboard/pedidos", icon: "orders", keywords: ["kanban", "vendas", "pedido", "cozinha"] },
  { id: "catalogo", label: "Produtos", tooltip: "Produtos", href: "/dashboard/catalogo", icon: "products", keywords: ["cardápio", "categoria", "preço", "item", "adicionais"] },
  { id: "relatorios", label: "Relatórios", tooltip: "Relatórios", href: "/dashboard/relatorios", icon: "reports", keywords: ["vendas", "faturamento", "ticket médio", "mais vendidos"] },
  { id: "caixa", label: "Caixa", tooltip: "Controle de caixa", href: "/dashboard/caixa", icon: "wallet", keywords: ["abrir caixa", "fechar caixa", "sangria", "suprimento"] },
  { id: "cupons", label: "Cupons", tooltip: "Cupons", href: "/dashboard/cupons", icon: "coupons", keywords: ["desconto", "promoção", "código"] },
  { id: "entregadores", label: "Entregadores", tooltip: "Entregadores", href: "/dashboard/entregadores", icon: "delivery", keywords: ["motoboy", "cadastrar motoboy", "entrega", "delivery"] },
  { id: "impressoras", label: "Impressoras", tooltip: "Impressoras", href: "/dashboard/impressoras", icon: "printer", keywords: ["impressão", "chave", "térmica", "tíquete"] },
  { id: "equipe", label: "Equipe", tooltip: "Equipe", href: "/dashboard/equipe", icon: "team", keywords: ["usuários", "funcionários", "acessos", "permissões"] },
  { id: "auditoria", label: "Auditoria", tooltip: "Auditoria", href: "/dashboard/auditoria", icon: "audit", keywords: ["log", "histórico", "segurança"] },
  { id: "planos", label: "Plano", tooltip: "Gerenciamento de plano", href: "/dashboard/planos", icon: "plan", keywords: ["assinatura", "pagamento", "pix", "teste grátis", "upgrade", "cancelar"] },
  { id: "conta", label: "Minha loja", tooltip: "Minha loja", href: "/dashboard/conta", icon: "store", keywords: ["horários", "endereço", "whatsapp", "cor", "logo", "plano", "senha"] },
];

export function isRouteActive(route: PanelRoute, pathname: string): boolean {
  if (route.exact) return pathname === route.href;
  return pathname === route.href || pathname.startsWith(`${route.href}/`);
}
