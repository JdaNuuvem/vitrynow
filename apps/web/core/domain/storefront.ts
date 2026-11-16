export type Additional = { id: string; name: string; priceCents: number };

export type Product = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  additionals: Additional[];
};

export type Category = { id: string; name: string; icon: string | null; products: Product[] };

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
  deliveryFeeCents: number;
};

export type Menu = { store: StoreInfo; categories: Category[] };

export type CartLine = { productId: string; quantity: number; additionalIds: string[]; notes?: string };

export type DeliveryType = "DELIVERY" | "BALCAO";
export type PaymentMethod = "PIX" | "DINHEIRO" | "CREDITO" | "DEBITO" | "VR" | "VA";

export type PixPayment = { pixQrCode: string | null; pixQrCodeBase64: string | null };

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
  customerName: string;
  customerPhone: string;
  address: string;
  couponCode: string;
  paymentMethod: PaymentMethod;
  // Só com DINHEIRO: valor da nota que o cliente vai entregar (precisa cobrir o total).
  changeForCents?: number;
  tipCents?: number;
  cart: CartLine[];
};

export type PlacedOrderResponse = { orderId: string; code: string; payment?: PixPayment };
