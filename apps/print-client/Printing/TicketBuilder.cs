using System;
using System.Collections.Generic;
using System.Globalization;
using MeuCardapio.PrintClient.Models;

namespace MeuCardapio.PrintClient.Printing
{
    // Monta o TicketDocument a partir do PrintableOrder da nossa API (layout e textos próprios), na ordem da
    // spec B4.1 (leonardo\especificacao-onda1-restante.md): cabeçalho, cliente, itens, observação, valores,
    // bloco de pagamento (B4.2) e rodapé. Todo texto livre passa por TicketText.PrintSafe: dado do cliente
    // nunca vira comando de impressora.
    //
    // Campos que a API de hoje já entrega: taxa de entrega, gorjeta, forma de pagamento, data ISO em UTC.
    // Campos OPCIONAIS que a API-14 vai entregar (subtotal, desconto, código do cupom, "troco para", nº da
    // reimpressão): se vierem, são usados; se não, o desconto é derivado (soma das linhas + taxa + gorjeta -
    // total) e o resto simplesmente não aparece.
    public static class TicketBuilder
    {
        public static TicketDocument Build(PrintableOrder order, int paperMm, TimeZoneInfo timeZone = null)
        {
            var doc = new TicketDocument { PaperMm = paperMm };
            if (order == null) return doc;
            var items = order.Items ?? new List<PrintableOrderItem>();
            string type = (order.Type ?? "").Trim().ToUpperInvariant();

            // 1) cabeçalho
            doc.Text(S(order.StoreName), TicketAlign.Center, bold: true, scale: 1.5f);
            doc.Text("PEDIDO #" + S(order.Code), TicketAlign.Center, bold: true);
            doc.Text(TypeLabel(order.Type), TicketAlign.Center, bold: true, scale: 1.3f);
            if (order.ReprintCount.HasValue && order.ReprintCount.Value > 0)
                doc.Text("2ª VIA (" + order.ReprintCount.Value + ")", TicketAlign.Center, bold: true);
            var when = FormatDate(order.CreatedAt, timeZone);
            if (when.Length > 0) doc.Text(when, TicketAlign.Center, scale: 0.85f);
            doc.Rule();

            // 2) cliente
            bool anyCustomer = false;
            if (!string.IsNullOrWhiteSpace(order.CustomerName)) { doc.Text("Cliente: " + S(order.CustomerName)); anyCustomer = true; }
            if (!string.IsNullOrWhiteSpace(order.CustomerPhone)) { doc.Text("Telefone: " + S(order.CustomerPhone)); anyCustomer = true; }
            if (!string.IsNullOrWhiteSpace(order.Address)) { doc.Text("Endereço: " + S(order.Address)); anyCustomer = true; }
            if (anyCustomer) doc.Rule();

            // 3) itens: valor da LINHA (unitário + adicionais) x quantidade; adicional mostra o extra por unidade
            long sumLines = 0;
            foreach (var item in items)
            {
                long extras = 0;
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>()) extras += add.PriceCents;
                long line = ((long)item.UnitPriceCents + extras) * item.Quantity;
                sumLines += line;
                doc.Pair(item.Quantity + "x " + S(item.ProductName), Money(line));
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>())
                    doc.Pair("  + " + S(add.Name), "+" + Money(add.PriceCents), scale: 0.85f);
                if (!string.IsNullOrWhiteSpace(item.Notes))
                    doc.Text("  obs: " + S(item.Notes), italic: true, scale: 0.85f);
            }

            // 4) observação do pedido
            if (!string.IsNullOrWhiteSpace(order.Notes))
            {
                doc.Rule();
                doc.Text("OBS: " + S(order.Notes), bold: true);
            }
            doc.Rule();

            // 5) valores
            long fee = Math.Max(0, order.DeliveryFeeCents), tip = Math.Max(0, order.TipCents);
            long subtotal = order.SubtotalCents ?? sumLines;
            long discount = order.DiscountCents ?? Math.Max(0, sumLines + fee + tip - order.TotalCents);
            if (discount > 0 || fee > 0 || tip > 0)
            {
                doc.Pair("Subtotal", Money(subtotal));
                if (discount > 0)
                {
                    var code = S(order.CouponCode);
                    doc.Pair(code.Length > 0 ? "Desconto (" + code + ")" : "Desconto", "-" + Money(discount));
                }
                if (fee > 0) doc.Pair("Taxa de entrega", Money(fee));
                if (tip > 0) doc.Pair("Gorjeta", Money(tip));
            }
            doc.Pair("TOTAL", Money(order.TotalCents), bold: true, scale: 1.2f);

            // 6) pagamento em destaque (B4.2)
            doc.Rule();
            foreach (var l in PaymentLines(order, type)) doc.Text(l, TicketAlign.Center, bold: true, scale: 1.15f);
            doc.Rule();
            return doc;
        }

        // Texto do bloco de pagamento (B4.2) com o que a API entrega hoje; "troco" só com changeForCents.
        public static List<string> PaymentLines(PrintableOrder o, string type)
        {
            var lines = new List<string>();
            string method = (o.PaymentMethod ?? "").Trim().ToUpperInvariant();
            string total = Money(o.TotalCents);

            if (method == "PIX") { lines.Add("PAGO ONLINE (PIX) - NÃO COBRAR"); return lines; }
            if (type == "MESA") { lines.Add("PAGAMENTO NA MESA"); return lines; }

            switch (method)
            {
                case "DINHEIRO":
                    lines.Add("COBRAR " + total + " EM DINHEIRO");
                    if (o.ChangeForCents.HasValue && o.ChangeForCents.Value > o.TotalCents)
                    {
                        lines.Add("TROCO PARA " + Money(o.ChangeForCents.Value));
                        lines.Add("LEVAR " + Money((long)o.ChangeForCents.Value - o.TotalCents) + " DE TROCO");
                    }
                    break;
                case "CREDITO": lines.Add("COBRAR " + total + " NO CARTÃO (crédito)"); break;
                case "DEBITO": lines.Add("COBRAR " + total + " NO CARTÃO (débito)"); break;
                case "VR": lines.Add("COBRAR " + total + " NO CARTÃO (VR)"); break;
                case "VA": lines.Add("COBRAR " + total + " NO CARTÃO (VA)"); break;
                default:
                    lines.Add(type == "BALCAO" && method.Length == 0 ? "COBRAR NO CAIXA " + total : "FORMA DE PAGAMENTO NÃO INFORMADA");
                    break;
            }
            return lines;
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

        // A API manda ISO 8601 em UTC ("2026-11-17T01:31:00.000Z"). No papel: dd/MM/aaaa HH:mm no fuso pedido
        // (o da loja quando a API passar a informar; hoje, o do computador). Texto que não é data sai como veio, limpo.
        public static string FormatDate(string iso, TimeZoneInfo timeZone)
        {
            if (string.IsNullOrWhiteSpace(iso)) return "";
            DateTimeOffset dto;
            if (!DateTimeOffset.TryParse(iso.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out dto))
                return S(iso);
            var local = TimeZoneInfo.ConvertTime(dto, timeZone ?? TimeZoneInfo.Local);
            return local.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture);
        }

        public static string Money(long cents)
        {
            bool neg = cents < 0;
            long abs = neg ? -cents : cents;
            var s = "R$ " + (abs / 100) + "," + (abs % 100).ToString("00", CultureInfo.InvariantCulture);
            return neg ? "-" + s : s;
        }
    }
}
