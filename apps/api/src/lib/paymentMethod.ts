import type { OrderPaymentMethod } from "@meucardapio/db";
import type { PaymentMethod } from "@meucardapio/shared-types";

// "CARTAO" é o valor legado do checkout antigo e vale como crédito.
export function toOrderPaymentMethod(method: PaymentMethod | undefined): OrderPaymentMethod | null {
  if (!method) return null;
  return method === "CARTAO" ? "CREDITO" : method;
}
