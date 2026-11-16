using System.Globalization;
using System.Text;
using System.Net;
using MeuCardapio.PrintClient.Models;

namespace MeuCardapio.PrintClient.Services
{
    // Monta o HTML (gramática própria, suportada pelo TicketRenderer) a partir do PrintableOrder
    // vindo da nossa API. Layout e textos são nossos — não reproduz o tíquete do cardapio.ai.
    public static class TicketTemplate
    {
        public static string Build(PrintableOrder order)
        {
            var sb = new StringBuilder();
            sb.Append("<div class=\"center title\">").Append(Enc(order.StoreName)).Append("</div>");
            sb.Append("<div class=\"center\">Pedido #").Append(Enc(order.Code)).Append(" - ").Append(Enc(order.Type)).Append("</div>");
            sb.Append("<div class=\"divider\"></div>");

            foreach (var item in order.Items)
            {
                sb.Append("<p>").Append(item.Quantity).Append("x ").Append(Enc(item.ProductName))
                  .Append(" (").Append(Money(item.UnitPriceCents)).Append(")</p>");
                foreach (var additional in item.Additionals)
                    sb.Append("<p class=\"min\">+ ").Append(Enc(additional.Name)).Append(" (").Append(Money(additional.PriceCents)).Append(")</p>");
                if (!string.IsNullOrWhiteSpace(item.Notes))
                    sb.Append("<p class=\"min\">obs: ").Append(Enc(item.Notes)).Append("</p>");
            }

            sb.Append("<div class=\"divider\"></div>");
            sb.Append("<p class=\"bold\">TOTAL: ").Append(Money(order.TotalCents)).Append("</p>");

            if (!string.IsNullOrWhiteSpace(order.CustomerName))
                sb.Append("<p>Cliente: ").Append(Enc(order.CustomerName)).Append("</p>");
            if (!string.IsNullOrWhiteSpace(order.CustomerPhone))
                sb.Append("<p>Telefone: ").Append(Enc(order.CustomerPhone)).Append("</p>");
            if (!string.IsNullOrWhiteSpace(order.Address))
                sb.Append("<p>Endereco: ").Append(Enc(order.Address)).Append("</p>");
            if (!string.IsNullOrWhiteSpace(order.Notes))
                sb.Append("<p>Obs: ").Append(Enc(order.Notes)).Append("</p>");

            sb.Append("<p class=\"center min\">").Append(Enc(order.CreatedAt)).Append("</p>");
            return sb.ToString();
        }

        static string Money(int cents) => "R$ " + (cents / 100.0).ToString("0.00", CultureInfo.InvariantCulture).Replace('.', ',');

        static string Enc(string value) => WebUtility.HtmlEncode(value ?? "");
    }
}
