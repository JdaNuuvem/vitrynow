import type { OrderStatus, OrderType } from "./orders";

export type Additional = { id: string; name: string; priceCents: number };

export type OptionSelection = { optionId: string; quantity: number };

export type PublicOptionGroup = {
  id: string;
  name: string;
  helpText: string | null;
  minSelect: number;
  maxSelect: number | null;
  maxPerOption: number;
  priceMode: "BASE" | "SUM";
  options: Additional[];
};

export type ProductOptions = {
  optionGroups?: PublicOptionGroup[];
  fromPriceCents?: number | null;
  unavailableByOptions?: boolean;
};

export type OrderOptionSnapshot = {
  groupName: string;
  name: string;
  priceCents: number;
  quantity: number;
  priceMode: PublicOptionGroup["priceMode"];
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  featured?: boolean;
  soldOut?: boolean;
  model3dUrl?: string | null; // PRATO 3D: GLB publicado pelo dono (null/ausente = sem 3D)
  additionals: Additional[];
} & ProductOptions;

export type Category = { id: string; name: string; icon: string | null; products: Product[] };

export type PublicStoreHours = {
  status: "ABERTO" | "FECHADO" | "PAUSADO";
  reason: "SWITCHED_OFF" | "PAUSED" | "CLOSED_TODAY" | "OUTSIDE_HOURS" | null;
  nextOpenAt: string | null;
  closesAt: string | null;
  message: string;
};

export type StoreInfo = {
  name: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  address: string | null;
  whatsapp: string | null;
  openingHours: string | null;
  minOrderCents: number | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  acceptingOrders: boolean;
  accepting?: boolean;
  hours?: PublicStoreHours | null;
  prepMinutes?: { delivery: number | null; pickup: number | null };
  deliveryFeeCents: number;
  payment?: { pixAvailable: boolean };
  campaign?: MenuBannerConfig | null;
  // API-40: a loja aceita pedido agendado (a vitrine mostra "Agendar"). Fuso da loja: datas e horários do agendamento.
  scheduling?: boolean;
  menuLayout?: "CLASSIC" | "REELS"; // modelo do cardápio escolhido pelo dono
  hasReels?: boolean; // REELS: a loja tem vídeo publicado (a vitrine só busca a lista quando true)
  timezone?: string;
};

export type MenuBannerTarget = { kind: "category" | "product"; id: string };
export type MenuBannerConfig = {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  imagePosition?: string;
  imageLayout?: "photo" | "cutout";
  action?: { label: string; target: MenuBannerTarget };
};
export type DeliveryZone = {
  id: string;
  name: string;
  feeCents: number;
  freeFromCents?: number | null;
  etaMinMinutes?: number | null;
  etaMaxMinutes?: number | null;
};

export type DeliveryZones = {
  zones: DeliveryZone[];
  outsideMode: "REFUSE" | "DEFAULT_FEE";
  defaultFeeCents: number;
  freeShippingFromCents: number | null;
};

export type Menu = { store: StoreInfo; categories: Category[] };

export type CartLine = { productId: string; quantity: number; additionalIds: string[]; optionSelections?: OptionSelection[]; notes?: string };

export type DeliveryType = "DELIVERY" | "BALCAO";
export type PaymentMethod = "PIX" | "DINHEIRO" | "CREDITO" | "DEBITO" | "VR" | "VA";

export type PixPayment = { pixQrCode: string | null; pixQrCodeBase64: string | null; expiresAt?: string | null };

export type OrderTracking = {
  store: { name: string };
  order: { code: string; type: OrderType; status: OrderStatus; createdAt: string; awaitingPayment: boolean };
  timeline: { status: OrderStatus; at: string }[];
  cancelReason: { customerMessage: string; moneyLine: string | null } | null;
};

// GET /stores/:slug/orders/:orderId/payment-status (ADR-0007 §3.2). `terminal` e `cancelReason`
// só existem depois do API-02; até lá o front deduz dos estados.
export type PaymentStatusResponse = {
  awaitingPayment: boolean;
  orderStatus?: string;
  paymentStatus?: string | null;
  terminal?: boolean;
  cancelReason?: { customerMessage?: string | null } | null;
};

export type PlaceOrderInput = {
  type: DeliveryType;
  neighborhoodId?: string;
  expectedDeliveryFeeCents?: number;
  customerName: string;
  customerPhone: string;
  address: string;
  couponCode: string;
  paymentMethod: PaymentMethod;
  // Só com DINHEIRO: valor da nota que o cliente vai entregar (precisa cobrir o total).
  changeForCents?: number;
  tipCents?: number;
  /** API-40: instante ISO do agendamento (só quando o cliente agendou). */
  scheduledFor?: string;
  cart: (CartLine & { expectedUnitPriceCents?: number })[];
};

// NG-16: `token` é o acesso do cliente ao PRÓPRIO pedido; a API o devolve UMA vez, na criação. Vai no cabeçalho
// `x-order-token` (nunca na URL) para consultar o pagamento e cancelar. Ausente = pedido sem acesso por este aparelho.
export const ORDER_TOKEN_HEADER = "x-order-token";
export type PlacedOrderResponse = {
  orderId: string;
  code: string;
  token?: string;
  totalCents?: number;
  discountCents?: number;
  payment?: PixPayment;
};
