using System.Collections.Generic;
using System.Globalization;
using MeuCardapio.PrintClient.Models;

namespace MeuCardapio.PrintClient.Printing
{
    // Monta o TicketDocument a partir do PrintableOrder da nossa API (layout e textos próprios).
    // Todo texto livre passa por TicketText.Sanitize: dado do cliente nunca vira comando de impressora.
    // O tíquete completo da B4 (subtotal, desconto, taxa, troco, reimpressão) entra no PC-07, quando a
    // API (API-14) entregar esses campos.
    public static class TicketBuilder
    {
        public static TicketDocument Build(PrintableOrder order, int paperMm)
        {
            var doc = new TicketDocument { PaperMm = paperMm };
            if (order == null) return doc;

            doc.Text(S(order.StoreName), TicketAlign.Center, bold: true, scale: 1.5f);
            doc.Text("Pedido #" + S(order.Code) + " - " + TypeLabel(order.Type), TicketAlign.Center, bold: true);
            doc.Rule();

            foreach (var item in order.Items ?? new List<PrintableOrderItem>())
            {
                doc.Pair(item.Quantity + "x " + S(item.ProductName), Money(item.UnitPriceCents));
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>())
                    doc.Pair("  + " + S(add.Name), Money(add.PriceCents), scale: 0.85f);
                if (!string.IsNullOrWhiteSpace(item.Notes))
                    doc.Text("  obs: " + S(item.Notes), italic: true, scale: 0.85f);
            }

            doc.Rule();
            doc.Pair("TOTAL", Money(order.TotalCents), bold: true);
            doc.Gap();

            if (!string.IsNullOrWhiteSpace(order.CustomerName)) doc.Text("Cliente: " + S(order.CustomerName));
            if (!string.IsNullOrWhiteSpace(order.CustomerPhone)) doc.Text("Telefone: " + S(order.CustomerPhone));
            if (!string.IsNullOrWhiteSpace(order.Address)) doc.Text("Endereço: " + S(order.Address));
            if (!string.IsNullOrWhiteSpace(order.Notes)) doc.Text("Obs: " + S(order.Notes), bold: true);

            if (!string.IsNullOrWhiteSpace(order.CreatedAt))
            {
                doc.Gap();
                doc.Text(S(order.CreatedAt), TicketAlign.Center, scale: 0.85f);
            }
            return doc;
        }

        static string S(string v) { return TicketText.PrintSafe(v); }

        static string TypeLabel(string type)
        {
            switch ((type ?? "").Trim().ToUpperInvariant())
            {
                case "DELIVERY": return "ENTREGA";
                case "BALCAO": case "PICKUP": case "RETIRADA": return "RETIRADA";
                case "MESA": case "TABLE": return "MESA";
                default: return S(type).ToUpperInvariant();
            }
        }

        public static string Money(int cents)
        {
            bool neg = cents < 0;
            long abs = cents < 0 ? -(long)cents : cents;
            var s = "R$ " + (abs / 100) + "," + (abs % 100).ToString("00", CultureInfo.InvariantCulture);
            return neg ? "-" + s : s;
        }
    }
}
