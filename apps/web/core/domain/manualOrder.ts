import type { OrderPaymentMethod } from "./orderDetail";
import type { OptionSelection } from "./storefront";

export type DiscountReason = "CORTESIA" | "ERRO_DO_PEDIDO" | "CLIENTE_FREQUENTE" | "PROMOCAO_DO_DIA" | "OUTRO";
export type ManualOrderInput = {
  type: "BALCAO" | "DELIVERY";
  customerName?: string;
  customerPhone?: string;
  address?: string;
  notes?: string;
  items: { productId: string; quantity: number; additionalIds?: string[]; optionSelections?: OptionSelection[]; expectedUnitPriceCents?: number; notes?: string }[];
  couponCode?: string;
  forceCoupon?: boolean;
  discount?: { percent: number; reason: DiscountReason };
  paymentMethod?: OrderPaymentMethod;
  alreadyPaid?: boolean;
  changeForCents?: number;
  tipCents?: number;
  channel?: "BALCAO" | "TELEFONE" | "WHATSAPP" | "OUTRO";
};
export type ManualOrderResult = { orderId: string; code: string; replay?: boolean };
