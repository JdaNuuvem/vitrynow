using System.Collections.Generic;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Models
{
    // Espelha o schema Zod `printableOrderSchema` de @meucardapio/shared-types.
    public class PrintableOrderItem
    {
        [JsonProperty("productName")] public string ProductName { get; set; }
        [JsonProperty("quantity")] public int Quantity { get; set; }
        [JsonProperty("unitPriceCents")] public int UnitPriceCents { get; set; }
        [JsonProperty("notes")] public string Notes { get; set; }
        [JsonProperty("additionals")] public List<PrintableOrderAdditional> Additionals { get; set; } = new List<PrintableOrderAdditional>();
    }

    public class PrintableOrderAdditional
    {
        [JsonProperty("name")] public string Name { get; set; }
        [JsonProperty("priceCents")] public int PriceCents { get; set; }
    }

    public class PrintableOrder
    {
        [JsonProperty("orderId")] public string OrderId { get; set; }
        // Id REAL do pedido (o OrderId vira a chave "job:<id>" no modo fila). So o alerta central usa; nunca vai ao servidor no corpo do tiquete.
        [JsonIgnore] public string SourceOrderId { get; set; }
        [JsonProperty("code")] public string Code { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("storeName")] public string StoreName { get; set; }
        [JsonProperty("customerName")] public string CustomerName { get; set; }
        [JsonProperty("customerPhone")] public string CustomerPhone { get; set; }
        [JsonProperty("address")] public string Address { get; set; }
        [JsonProperty("notes")] public string Notes { get; set; }
        // Total: AUSENTE nao e ZERO (parecer Nightingale, PC-19). Campo ausente na resposta deixa HasTotalCents falso; so um "totalCents": 0
        // ESCRITO pelo servidor (ou atribuido em codigo) vale como zero. A decisao "nada a cobrar" exige a presenca.
        // "totalCents": null no JSON tambem e AUSENTE (nao derruba a leitura: o pedido da cozinha tem de sair mesmo assim, pela regra normal que cobra).
        int? _totalCents;
        [JsonProperty("totalCents")] public int? TotalCentsOrNull { get { return _totalCents; } set { _totalCents = value; } }
        [JsonIgnore] public int TotalCents { get { return _totalCents ?? 0; } set { _totalCents = value; } }
        [JsonIgnore] public bool HasTotalCents { get { return _totalCents.HasValue; } }
        // Já entregues pela API (printable.ts): taxa, gorjeta e forma de pagamento (DINHEIRO, PIX, CREDITO, DEBITO, VR, VA ou null).
        [JsonProperty("deliveryFeeCents")] public int DeliveryFeeCents { get; set; }
        [JsonProperty("tipCents")] public int TipCents { get; set; }
        [JsonProperty("paymentMethod")] public string PaymentMethod { get; set; }
        // OPCIONAIS (API-14, B4): se a API passar a enviar, o tíquete usa; senão deriva ou omite.
        [JsonProperty("subtotalCents")] public int? SubtotalCents { get; set; }
        [JsonProperty("discountCents")] public int? DiscountCents { get; set; }
        [JsonProperty("couponCode")] public string CouponCode { get; set; }
        [JsonProperty("changeForCents")] public int? ChangeForCents { get; set; }
        [JsonProperty("reprintCount")] public int? ReprintCount { get; set; }
        // Contrato do tíquete: ADR-0004 §6. paymentStatus = PAGO | A_COBRAR | ESTORNADO ("NÃO COBRAR" só com PAGO).
        // Sem token, QR, e-mail nem id do provedor de pagamento. Campo desconhecido é ignorado (cliente antigo não quebra).
        [JsonProperty("paymentStatus")] public string PaymentStatus { get; set; }
        [JsonProperty("printedAtOriginal")] public string PrintedAtOriginal { get; set; }   // ISO UTC, só na 2ª via
        [JsonProperty("cancelNotice")] public bool? CancelNotice { get; set; }              // true = imprime o aviso de cancelamento
        [JsonProperty("ticketSchemaVersion")] public int? TicketSchemaVersion { get; set; }
        // API-66 (schema 3): o SERVIDOR diz se nao ha nada a cobrar (fonte unica: total 0 E nenhuma cobranca possivel). Ausente (API antiga) = null.
        // So um BOOLEANO de verdade vale (parecer Nightingale): 1, "true", "lixo" ou lista NAO sao coagidos e NAO derrubam a leitura do tiquete; viram AUSENTE.
        [JsonProperty("nothingToCharge")] public Newtonsoft.Json.Linq.JToken NothingToChargeRaw { get; set; }
        // O servidor mandou o campo, mas com um valor que NAO e booleano (1, "false", "lixo", lista...): dado corrompido, diferente de campo AUSENTE (API antiga).
        [JsonIgnore]
        public bool NothingToChargeInvalid
        {
            get { var t = NothingToChargeRaw; return t != null && t.Type != Newtonsoft.Json.Linq.JTokenType.Null && t.Type != Newtonsoft.Json.Linq.JTokenType.Boolean; }
        }
        [JsonIgnore]
        public bool? NothingToCharge
        {
            get { var t = NothingToChargeRaw; return t != null && t.Type == Newtonsoft.Json.Linq.JTokenType.Boolean ? (bool?)t.ToObject<bool>() : null; }
            set { NothingToChargeRaw = value.HasValue ? new Newtonsoft.Json.Linq.JValue(value.Value) : null; }
        }
        [JsonProperty("tableLabel")] public string TableLabel { get; set; }
        // v4: rodada da mesa, quem pediu (garçom/cliente) e LGPD (dados do cliente anonimizados)
        [JsonProperty("round")] public int? Round { get; set; }
        [JsonProperty("requestedBy")] public string RequestedBy { get; set; }
        [JsonProperty("customerRemoved")] public bool? CustomerRemoved { get; set; }
        // Job TEST sem tíquete do servidor: o cliente imprime o tíquete de teste próprio (não vem da API).
        [JsonIgnore] public bool IsTest { get; set; }
        [JsonProperty("createdAt")] public string CreatedAt { get; set; }
        [JsonProperty("items")] public List<PrintableOrderItem> Items { get; set; } = new List<PrintableOrderItem>();
    }

    public class PendingOrderRef
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("code")] public string Code { get; set; }
    }

    public class PendingOrdersResponse
    {
        [JsonProperty("orders")] public List<PendingOrderRef> Orders { get; set; } = new List<PendingOrderRef>();
        // API-12b: o modo da loja tambem vai no corpo da lista legada ("LEGACY" | "QUEUE"); ausente (API antiga) = null.
        [JsonProperty("mode")] public string Mode { get; set; }
    }

    public class PrintableOrderResponse
    {
        [JsonProperty("order")] public PrintableOrder Order { get; set; }
    }
}
