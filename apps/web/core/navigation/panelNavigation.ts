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
  { id: "mesas", label: "Mesas e QR", tooltip: "Gerenciar mesas e códigos QR", href: "/dashboard/mesas", icon: "mesa", keywords: ["salão", "qr code", "atendimento à mesa"] },
  { id: "salao", label: "Salão 3D", tooltip: "Mapa 3D das mesas com status em tempo real", href: "/dashboard/salao", icon: "mesa", keywords: ["mapa", "mesas", "3d", "planta", "garçom", "conta"] },
  { id: "catalogo", label: "Produtos", tooltip: "Produtos", href: "/dashboard/catalogo", icon: "products", keywords: ["cardápio", "categoria", "preço", "item", "adicionais"] },
  { id: "reels", label: "Reels", tooltip: "Vídeos curtos dos pratos no cardápio", href: "/dashboard/reels", icon: "image", keywords: ["vídeo", "video", "reels", "stories", "instagram", "tiktok"] },
  { id: "pratos-3d", label: "Pratos 3D", tooltip: "Modelo 3D do prato a partir de fotos", href: "/dashboard/pratos-3d", icon: "image", keywords: ["3d", "realidade aumentada", "ar", "foto", "modelo", "girar prato"] },
  { id: "estoque", label: "Estoque", tooltip: "Insumos, fichas técnicas, compras e perdas", href: "/dashboard/estoque", icon: "stock", keywords: ["insumo", "ficha técnica", "compra", "perda", "desperdício", "estragado", "contagem", "carne"] },
  { id: "lucro", label: "Lucro e margens", tooltip: "Lucro real, CMV e margem por prato", href: "/dashboard/lucro", icon: "profit", keywords: ["lucro", "cmv", "margem", "custo", "dre", "prejuízo"] },
  { id: "relatorios", label: "Relatórios", tooltip: "Relatórios", href: "/dashboard/relatorios", icon: "reports", keywords: ["vendas", "faturamento", "ticket médio", "mais vendidos"] },
  { id: "caixa", label: "Caixa", tooltip: "Controle de caixa", href: "/dashboard/caixa", icon: "wallet", keywords: ["abrir caixa", "fechar caixa", "sangria", "suprimento"] },
  { id: "cupons", label: "Cupons", tooltip: "Cupons", href: "/dashboard/cupons", icon: "coupons", keywords: ["desconto", "promoção", "código"] },
  { id: "entregadores", label: "Entregadores", tooltip: "Entregadores", href: "/dashboard/entregadores", icon: "delivery", keywords: ["motoboy", "cadastrar motoboy", "entrega", "delivery"] },
  { id: "impressoras", label: "Impressoras", tooltip: "Impressoras", href: "/dashboard/impressoras", icon: "printer", keywords: ["impressão", "chave", "térmica", "tíquete"] },
  { id: "equipe", label: "Equipe", tooltip: "Equipe", href: "/dashboard/equipe", icon: "team", keywords: ["usuários", "funcionários", "acessos", "permissões"] },
  { id: "pagamentos", label: "Pagamentos", tooltip: "Configurar os pagamentos da loja", href: "/dashboard/pagamentos", icon: "payments", keywords: ["pix", "mercado pago", "cobrança"] },
  { id: "auditoria", label: "Auditoria", tooltip: "Auditoria", href: "/dashboard/auditoria", icon: "audit", keywords: ["log", "histórico", "segurança"] },
  { id: "planos", label: "Plano", tooltip: "Gerenciamento de plano", href: "/dashboard/planos", icon: "plan", keywords: ["assinatura", "pagamento", "pix", "teste grátis", "upgrade", "cancelar"] },
  { id: "conta", label: "Minha loja", tooltip: "Dados e configurações da loja", href: "/dashboard/conta", icon: "store", keywords: ["horários", "endereço", "whatsapp", "logo", "plano", "senha"] },
  { id: "aparencia", label: "Aparência do cardápio", tooltip: "Editar cores e banner do cardápio", href: "/dashboard/conta/aparencia", icon: "settings", keywords: ["cardapio", "cor", "cores", "capa", "banner", "personalizar"] },
  { id: "horarios", label: "Horários e preparo", tooltip: "Horários, pausas e tempo de preparo", href: "/dashboard/conta/horarios", icon: "clock", keywords: ["funcionamento", "abertura", "fechamento", "pausar", "preparo"] },
  { id: "zonas", label: "Áreas de entrega", tooltip: "Configurar os bairros de entrega", href: "/dashboard/conta/entrega", icon: "delivery", keywords: ["zonas", "bairros", "taxas", "frete"] },
  { id: "primeiros-passos", label: "Primeiros passos", tooltip: "Configuração inicial e confirmação do e-mail", href: "/dashboard/primeiros-passos", icon: "check", keywords: ["configuração", "onboarding", "checklist", "e-mail", "verificação"] },
];

export const PRIVACY_ROUTE: PanelRoute = {
  id: "privacidade", label: "Privacidade", tooltip: "Gerenciar dados de clientes", href: "/dashboard/privacidade",
  icon: "lock", keywords: ["exportação", "anonimização", "titular", "lgpd"],
};

export function isRouteActive(route: PanelRoute, pathname: string): boolean {
  if (route.exact) return pathname === route.href;
  if (PANEL_ROUTES.some((other) => other.href.startsWith(`${route.href}/`) && (pathname === other.href || pathname.startsWith(`${other.href}/`)))) return false;
  return pathname === route.href || pathname.startsWith(`${route.href}/`);
}
