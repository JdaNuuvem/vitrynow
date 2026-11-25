// SSOT D5: a cotação do pedido mora em shared-types/quote (a MESMA função que o checkout usa na prévia).
// Este arquivo só reexporta, para as rotas (vitrine, mesa, balcão) continuarem importando do mesmo lugar.
export { quoteOrder } from "@meucardapio/shared-types";
export type { Quote, QuoteCoupon, QuoteDelivery, QuoteInput } from "@meucardapio/shared-types";