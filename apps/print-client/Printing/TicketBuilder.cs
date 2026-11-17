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
            if (order.IsTest) return BuildTest(order, paperMm, timeZone);
            if (order.CancelNotice == true) return BuildCancelNotice(order, paperMm, timeZone);
            var items = order.Items ?? new List<PrintableOrderItem>();
            string type = (order.Type ?? "").Trim().ToUpperInvariant();

            // 1) cabeçalho
            doc.Text(S(order.StoreName), TicketAlign.Center, bold: true, scale: 1.5f);
            doc.Text("PEDIDO #" + S(order.Code), TicketAlign.Center, bold: true);
            // Mesa: "MESA 12" quando a API informa o rótulo (tableLabel), senão só "MESA".
            var label = TypeLabel(order.Type);
            var table = S(order.TableLabel);
            if (type == "MESA" && table.Length > 0) label = table.StartsWith("MESA", StringComparison.OrdinalIgnoreCase) ? table.ToUpperInvariant() : "MESA " + table.ToUpperInvariant();
            doc.Text(label, TicketAlign.Center, bold: true, scale: 1.3f);
            if (order.ReprintCount.HasValue && order.ReprintCount.Value > 0)
            {
                doc.Text("2ª VIA (" + order.ReprintCount.Value + ")", TicketAlign.Center, bold: true);
                var first = FormatDate(order.PrintedAtOriginal, timeZone);
                if (first.Length > 0) doc.Text("1ª impressão: " + first, TicketAlign.Center, scale: 0.85f);
            }
            var when = FormatDate(order.CreatedAt, timeZone);
            if (when.Length > 0) doc.Text(when, TicketAlign.Center, scale: 0.85f);
            doc.Rule();

            // 2) cliente
            bool anyCustomer = false;
            if (!string.IsNullOrWhiteSpace(order.CustomerName)) { doc.Text("Cliente: " + S(order.CustomerName)); CutWarning(doc, order.CustomerName, "nome do cliente cortado"); anyCustomer = true; }
            if (!string.IsNullOrWhiteSpace(order.CustomerPhone)) { doc.Text("Telefone: " + S(order.CustomerPhone)); anyCustomer = true; }
            if (!string.IsNullOrWhiteSpace(order.Address)) { doc.Text("Endereço: " + S(order.Address)); CutWarning(doc, order.Address, "endereço cortado"); anyCustomer = true; }
            if (anyCustomer) doc.Rule();

            // 3) itens: valor da LINHA (unitário + adicionais) x quantidade; adicional mostra o extra por unidade
            long sumLines = 0;
            int shownItems = 0, hiddenItems = 0;
            long hiddenSum = 0;
            foreach (var item in items)
            {
                long extras = 0;
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>()) extras += add.PriceCents;
                long lineTotal = ((long)item.UnitPriceCents + extras) * item.Quantity;
                sumLines += lineTotal;
                // Teto de itens no papel (PC-15): o subtotal e o TOTAL continuam corretos; a lista corta e uma linha
                // "e mais N itens" leva a soma dos escondidos, para a coluna continuar somando o subtotal.
                if (shownItems >= TicketText.MaxItemLines) { hiddenItems++; hiddenSum += lineTotal; continue; }
                shownItems++;
                // Linha do item = produto x qtd; cada adicional = extra x qtd, com "(Nx)" escrito. Assim a coluna
                // de valores soma exatamente o subtotal (parecer funcional do Leonardo).
                doc.Pair(item.Quantity + "x " + S(item.ProductName), Money((long)item.UnitPriceCents * item.Quantity));
                CutWarning(doc, item.ProductName, "nome do item cortado");
                int shownAdds = 0, hiddenAdds = 0; long hiddenAddSum = 0;
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>())
                {
                    long addTotal = (long)add.PriceCents * item.Quantity;
                    if (shownAdds >= TicketText.MaxAdditionalsPerItem) { hiddenAdds++; hiddenAddSum += addTotal; continue; }
                    shownAdds++;
                    doc.Pair("  + " + S(add.Name) + (item.Quantity > 1 ? " (" + item.Quantity + "x)" : ""), "+" + Money(addTotal), scale: 0.85f);
                    CutWarning(doc, add.Name, "adicional cortado");
                }
                if (hiddenAdds > 0) doc.Pair("  + mais " + hiddenAdds + " adicionais", "+" + Money(hiddenAddSum), scale: 0.85f);
                if (!string.IsNullOrWhiteSpace(item.Notes))
                {
                    doc.Text("  obs: " + S(item.Notes), italic: true, scale: 0.85f);
                    CutWarning(doc, item.Notes, "observação cortada");
                }
            }
            if (hiddenItems > 0) doc.Pair("... e mais " + hiddenItems + " itens (ver no painel)", Money(hiddenSum), bold: true);

            // 4) observação do pedido
            if (!string.IsNullOrWhiteSpace(order.Notes))
            {
                doc.Rule();
                doc.Text("OBS: " + S(order.Notes), bold: true);
                CutWarning(doc, order.Notes, "observação cortada");
            }
            doc.Rule();

            // 5) valores
            long fee = Math.Max(0, order.DeliveryFeeCents), tip = Math.Max(0, order.TipCents);
            long subtotal = order.SubtotalCents ?? sumLines;
            // Total AUSENTE (versao desencontrada ou bug; a API real sempre manda): nao deriva desconto de um total que nao existe.
            bool hasTotal = order.HasTotalCents;
            long discount = order.DiscountCents ?? (hasTotal ? Math.Max(0, sumLines + fee + tip - order.TotalCents) : 0);
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
            if (hasTotal) doc.Pair("TOTAL", Money(order.TotalCents), bold: true, scale: 1.2f);
            else
            {
                // PC-21 (parecer Nightingale): total AUSENTE nunca vira "TOTAL R$ 0,00" nem "COBRAR R$ 0,00" (o caixa cobraria zero). O papel diz
                // que o total nao veio e, se os itens permitem, mostra o valor CALCULADO (itens + taxa + gorjeta - desconto) marcado como tal.
                doc.Text("TOTAL NÃO INFORMADO - CONFERIR NO PAINEL", TicketAlign.Center, bold: true, scale: 1.2f);
                bool subtotalAgrees = !order.SubtotalCents.HasValue || order.SubtotalCents.Value == sumLines;
                long calc = sumLines + fee + tip - discount;
                if (sumLines > 0 && subtotalAgrees && calc >= 0) doc.Pair("CALCULADO", Money(calc), bold: true);
            }

            // 6) pagamento em destaque (B4.2)
            doc.Rule();
            foreach (var l in PaymentLines(order, type)) doc.Text(l, TicketAlign.Center, bold: true, scale: 1.15f);
            doc.Rule();
            return doc;
        }

        // Relogio do tiquete de teste (so o selftest troca, para o golden ter hora fixa).
        internal static Func<DateTime> Clock = () => DateTime.UtcNow;

        // Tíquete de teste (job TEST, RN-B4-07): confirma que a impressora responde e que acento, R$ e a régua de colunas saem
        // certos. Sem pedido, itens, valores nem dados de cliente.
        public static TicketDocument BuildTest(PrintableOrder order, int paperMm, TimeZoneInfo timeZone)
        {
            var doc = new TicketDocument { PaperMm = paperMm };
            var store = S(order == null ? "" : order.StoreName);
            if (store.Length > 0) doc.Text(store, TicketAlign.Center, bold: true);
            doc.Text("TESTE DE IMPRESSÃO", TicketAlign.Center, bold: true, scale: 1.5f);
            doc.Rule();
            doc.Text("Se você consegue ler este papel, a impressora está funcionando.", TicketAlign.Center);
            doc.Text("Acentos: ação, é, ñ, ü  Valor: R$ 12,34", TicketAlign.Center);
            int cols = TicketText.ColumnsFor(paperMm);
            // Régua: cada bloco de 10 colunas termina em um número; se a última coluna cortar, a bobina é mais estreita que a configurada.
            var ruler = new System.Text.StringBuilder();
            for (int c = 1; c <= cols; c++) ruler.Append(c % 10 == 0 ? (char)('0' + (c / 10) % 10) : '.');
            doc.Text(ruler.ToString());
            doc.Text("Bobina de " + paperMm + " mm: " + cols + " colunas", TicketAlign.Center, scale: 0.85f);
            var when = FormatDate(Clock().ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture), timeZone);
            if (when.Length > 0) doc.Text(when, TicketAlign.Center, scale: 0.85f);
            doc.Rule();
            return doc;
        }

        // Aviso de cancelamento (RN-B4-03, CA-B4-09): curto, sem valores nem itens, para a cozinha/entregador PARAR.
        // O tíquete original não é reimpresso. Só identifica o pedido (loja, número, tipo/mesa, hora e cliente).
        public static TicketDocument BuildCancelNotice(PrintableOrder order, int paperMm, TimeZoneInfo timeZone)
        {
            var doc = new TicketDocument { PaperMm = paperMm };
            string type = (order.Type ?? "").Trim().ToUpperInvariant();
            var label = TypeLabel(order.Type);
            var table = S(order.TableLabel);
            if (type == "MESA" && table.Length > 0) label = table.StartsWith("MESA", StringComparison.OrdinalIgnoreCase) ? table.ToUpperInvariant() : "MESA " + table.ToUpperInvariant();
            doc.Text(S(order.StoreName), TicketAlign.Center, bold: true);
            doc.Rule();
            doc.Text("PEDIDO #" + S(order.Code), TicketAlign.Center, bold: true, scale: 1.4f);
            doc.Text("CANCELADO", TicketAlign.Center, bold: true, scale: 2f);
            doc.Text("NÃO PREPARAR / NÃO ENTREGAR", TicketAlign.Center, bold: true);
            doc.Rule();
            doc.Text(label, TicketAlign.Center, bold: true, scale: 1.2f);
            if (!string.IsNullOrWhiteSpace(order.CustomerName)) doc.Text("Cliente: " + S(order.CustomerName), TicketAlign.Center);
            var when = FormatDate(order.CreatedAt, timeZone);
            if (when.Length > 0) doc.Text("Pedido feito em " + when, TicketAlign.Center, scale: 0.85f);
            doc.Rule();
            return doc;
        }

        // Texto do bloco de pagamento (B4.2) com o que a API entrega hoje; "troco" só com changeForCents.
        public static List<string> PaymentLines(PrintableOrder o, string type)
        {
            var lines = new List<string>();
            string method = (o.PaymentMethod ?? "").Trim().ToUpperInvariant();
            string total = o.HasTotalCents ? Money(o.TotalCents) : "(TOTAL NÃO INFORMADO)";

            // Total zero (cupom que cobre o pedido inteiro; B4.2, RN-CP-12, CA-CP-07/18): a decisao e pelo TOTAL, qualquer paymentStatus
            // ou forma de pagamento, e vale tambem na 2a via. Nao imprime "COBRAR R$ 0,00" nem "PIX - CONFERIR NA HORA".
            if (IsNothingToCharge(o)) { lines.Add("SEM COBRANÇA: NADA A COBRAR"); return lines; }

            // Fail-safe: "NÃO COBRAR" só com PROVA de pagamento online (paymentStatus = PAGO, ADR-0004 §6; o antigo "APROVADO" NÃO vale: não reverta esta regra, ela evita deixar de cobrar um pedido não pago). PIX sem prova
            // (ex.: pedido manual com PIX presencial) manda conferir na hora, nunca deixa de cobrar por engano.
            if (method == "PIX")
            {
                string st = (o.PaymentStatus ?? "").Trim().ToUpperInvariant();
                if (st == "PAGO") lines.Add("PAGO ONLINE (PIX) - NÃO COBRAR");
                else if (st == "ESTORNADO") lines.Add("PIX ESTORNADO - CONFERIR NA HORA");
                else lines.Add("PIX - CONFERIR NA HORA");   // A_COBRAR, ausente ou desconhecido: nunca "não cobrar"
                return lines;
            }
            if (type == "MESA") { lines.Add("PAGAMENTO NA MESA"); return lines; }

            switch (method)
            {
                case "DINHEIRO":
                    lines.Add("COBRAR " + total + " EM DINHEIRO");
                    if (o.ChangeForCents.HasValue && (!o.HasTotalCents || o.ChangeForCents.Value > o.TotalCents))
                    {
                        lines.Add("TROCO PARA " + Money(o.ChangeForCents.Value));
                        // Sem o total nao ha como dizer quanto levar de troco: nunca calcula contra um total ausente.
                        if (o.HasTotalCents) lines.Add("LEVAR " + Money((long)o.ChangeForCents.Value - o.TotalCents) + " DE TROCO");
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

        // "Nada a cobrar" so quando a ARITMETICA fecha (parecer Nightingale, condicao do PC-19): total PRESENTE e igual a zero,
        // o desconto cobre EXATAMENTE o valor dos itens (o cupom so desconta itens), sem taxa de entrega nem gorjeta, e o subtotal
        // informado (se vier) bate com a soma dos itens. Qualquer divergencia (desconto menor ou maior que os itens, subtotal que nao
        // bate, taxa, total ausente) cai no fluxo normal, que COBRA. Desconto ausente conta como zero: sem prova, nao e "de graca".
        //
        // Campo do SERVIDOR (API-66, fonte unica; Atlas/Nightingale/Leonardo): se PRESENTE ele MANDA. `false` => regra normal (cobra), mesmo que a
        // aritmetica local desse zero (ha pagamento vivo). `true` => "nada a cobrar" so com o total PRESENTE e igual a 0 (cinto sempre); `true`
        // com total diferente de 0 ou ausente => regra normal e AVISO no log (IsNothingToChargeConflict). AUSENTE (API antiga) => a aritmetica abaixo.
        static bool IsNothingToCharge(PrintableOrder o)
        {
            if (o.NothingToCharge == false) return false;
            if (!o.HasTotalCents || o.TotalCents != 0) return false;
            if (o.NothingToCharge == true) return true;
            long items = ItemsValue(o);
            long discount = o.DiscountCents ?? 0;
            if (o.SubtotalCents.HasValue && o.SubtotalCents.Value != items) return false;
            return discount == items && o.DeliveryFeeCents == 0 && o.TipCents == 0;
        }

        static long ItemsValue(PrintableOrder o)
        {
            long total = 0;
            foreach (var item in o.Items ?? new List<PrintableOrderItem>())
            {
                long extras = 0;
                foreach (var add in item.Additionals ?? new List<PrintableOrderAdditional>()) extras += add.PriceCents;
                total += ((long)item.UnitPriceCents + extras) * item.Quantity;
            }
            return total;
        }

        // O servidor disse "nada a cobrar" mas o total nao chegou PRESENTE e igual a 0: incoerente (versao desencontrada ou bug). O papel segue a
        // regra normal (que cobra) e o chamador registra um AVISO no log.
        public static bool IsNothingToChargeConflict(PrintableOrder o)
        {
            return o != null && !o.IsTest && o.CancelNotice != true && o.NothingToCharge == true && (!o.HasTotalCents || o.TotalCents != 0);
        }

        // Tiquete SEM itens e total zero: imprime "SEM COBRANCA" (nada a entregar), mas e malformado e o chamador registra um aviso no log.
        public static bool IsEmptyZeroTicket(PrintableOrder o)
        {
            return o != null && !o.IsTest && o.CancelNotice != true && IsNothingToCharge(o) && ItemsValue(o) == 0;
        }

        // Segurança alimentar (parecer Nightingale N1): se o texto foi cortado no teto, o papel AVISA em linha própria.
        // Observação de alergia/restrição não pode sumir em silêncio.
        static void CutWarning(TicketDocument doc, string raw, string what)
        {
            if (TicketText.PrintSafe(raw).Length > TicketText.MaxFieldChars)
                doc.Text("(" + what + " — ver no painel)", bold: true, scale: 0.9f);
        }

        // Texto do servidor no papel: sanitizado, sem emoji e com teto (PC-15): uma observação de 100 mil caracteres
        // não imprime metros de papel.
        static string S(string v) { return TicketText.Truncate(TicketText.PrintSafe(v), TicketText.MaxFieldChars); }

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
