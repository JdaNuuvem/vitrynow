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
        [JsonProperty("code")] public string Code { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("storeName")] public string StoreName { get; set; }
        [JsonProperty("customerName")] public string CustomerName { get; set; }
        [JsonProperty("customerPhone")] public string CustomerPhone { get; set; }
        [JsonProperty("address")] public string Address { get; set; }
        [JsonProperty("notes")] public string Notes { get; set; }
        [JsonProperty("totalCents")] public int TotalCents { get; set; }
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
    }

    public class PrintableOrderResponse
    {
        [JsonProperty("order")] public PrintableOrder Order { get; set; }
    }
}
