using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // Tiquete (PC-12/PC-07, QA-06): modelo proprio, quebra de linha, sanitizacao, bloco de pagamento B4.2 e golden
    // files em 58 e 80 mm. Golden files ficam em tests\golden\ (run-selftest.ps1 passa PC_GOLDEN_DIR). Para
    // regenerar depois de uma mudanca INTENCIONAL de layout: $env:PC_UPDATE_GOLDEN = "1"; .\run-selftest.ps1 e
    // REVISE o diff no git.
    static class SelfTestPrint
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        // Fuso fixo dos testes (Brasilia, UTC-3, sem horario de verao): a data do tiquete nao depende da maquina.
        internal static readonly TimeZoneInfo Tz = TimeZoneInfo.CreateCustomTimeZone("BRT-teste", TimeSpan.FromHours(-3), "BRT", "BRT");

        // ---- Dados de exemplo (FICTICIOS). Totais coerentes com as linhas: total = soma - desconto + taxa + gorjeta. ----

        // Entrega em dinheiro com troco, cupom, taxa e todos os campos opcionais da API-14.
        internal static PrintableOrder Basic()
        {
            return new PrintableOrder
            {
                OrderId = "ord-1042", Code = "1042", Type = "DELIVERY", StoreName = "Pizzaria do Zé",
                CustomerName = "Maria da Silva", CustomerPhone = "(11) 91234-5678",
                Address = "Rua das Flores, 123, apto 45 - Jardim Paulista, São Paulo",
                Notes = "Tocar o interfone", CreatedAt = "2026-11-16T23:31:00.000Z",
                DeliveryFeeCents = 600, TipCents = 0, SubtotalCents = 9450, DiscountCents = 450, CouponCode = "BEM10",
                TotalCents = 9600, PaymentMethod = "DINHEIRO", ChangeForCents = 10000,
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "Pizza Calabresa G", Quantity = 2, UnitPriceCents = 3500, Notes = "sem cebola",
                        Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Borda catupiry", PriceCents = 800 } } },
                    new PrintableOrderItem { ProductName = "Refrigerante 2L", Quantity = 1, UnitPriceCents = 850 },
                },
            };
        }

        // Como a API entrega HOJE (sem campos opcionais): PIX pago, taxa e gorjeta, desconto so DERIVADO (sem codigo do cupom).
        internal static PrintableOrder CurrentContract()
        {
            return new PrintableOrder
            {
                OrderId = "ord-4100", Code = "4100", Type = "DELIVERY", StoreName = "Hamburgueria Central",
                CustomerName = "Paulo Souza", CustomerPhone = "(31) 98888-7777", Address = "Av. Brasil, 500 - Centro",
                CreatedAt = "2026-11-17T01:31:00.000Z",
                DeliveryFeeCents = 600, TipCents = 200, PaymentMethod = "PIX", TotalCents = 5400,
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "X-Burger", Quantity = 2, UnitPriceCents = 2000 },
                    new PrintableOrderItem { ProductName = "Batata P", Quantity = 1, UnitPriceCents = 1000 },
                },
            };
        }

        internal static PrintableOrder LongAndHostile()
        {
            return new PrintableOrder
            {
                OrderId = "ord-2077", Code = "2077", Type = "MESA", StoreName = "Casa do Pastel & Caldo de Cana Premium",
                CustomerName = "José Antônio D'Ávila Júnior", CustomerPhone = "+55 (21) 99876-5432",
                Address = "Avenida-Engenheiro-Luís-Carlos-Berrini-1234567890-Cidade-Monções, bloco B",
                // ESC @ (reset), GS V 0 (corte), BEL, tabulação e quebra de linha: tudo isso é texto do cliente, nunca comando.
                Notes = "Sem pimenta\u0007\u001b@ \u001dV\u0000 por favor\nsegunda linha\tcom tab \u202eevil",
                TotalCents = 10820, CreatedAt = "2026-11-17T00:05:00Z", PaymentMethod = null, TableLabel = "Mesa 12",
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "Pastel de Camarão com Catupiry e Cream Cheese Especial da Casa", Quantity = 3, UnitPriceCents = 2890,
                        Notes = "capricha no molho 🌶️🔥 e sem coentro, por favor, obrigado",
                        Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Molho verde especial da casa com pimenta", PriceCents = 350 } } },
                    new PrintableOrderItem { ProductName = "Caldo de cana grande com limão", Quantity = 1, UnitPriceCents = 1100 },
                },
            };
        }

        internal static PrintableOrder ManyItems()
        {
            var items = new List<PrintableOrderItem>();
            long sum = 0;
            string[] names = { "X-Burger", "X-Salada", "X-Bacon", "Batata M", "Batata G", "Onion rings", "Coca 350", "Guaraná 350", "Suco laranja", "Água s/ gás", "Brownie", "Sorvete 2 bolas" };
            for (int i = 0; i < names.Length; i++)
            {
                var it = new PrintableOrderItem { ProductName = names[i], Quantity = (i % 3) + 1, UnitPriceCents = 590 + i * 130 };
                sum += (long)it.Quantity * it.UnitPriceCents;
                items.Add(it);
            }
            return new PrintableOrder { OrderId = "ord-3001", Code = "3001", Type = "BALCAO", StoreName = "Lanches 24h", CustomerName = "Cliente balcão",
                PaymentMethod = "CREDITO", TotalCents = (int)sum, CreatedAt = "2026-11-17T03:12:00Z", Items = items };
        }

        // 2a via (reimpressao) de um pedido pago por PIX.
        // Cupom de 100% (FUNC-02): itens com valor, desconto igual ao subtotal, total 0, sem forma de pagamento. O servidor continua
        // mandando paymentStatus A_COBRAR (sem enum novo); o print-client decide pelo TOTAL (CA-CP-18).
        internal static PrintableOrder ZeroTotal()
        {
            return new PrintableOrder
            {
                OrderId = "ord-5200", Code = "5200", Type = "BALCAO", StoreName = "Lanchonete Boa Vista",
                CustomerName = "Rita Gomes", CustomerPhone = "(21) 97777-6666", CreatedAt = "2026-11-17T14:05:00.000Z",
                SubtotalCents = 5000, DiscountCents = 5000, CouponCode = "TUDOGRATIS", DeliveryFeeCents = 0, TipCents = 0,
                TotalCents = 0, PaymentMethod = null, PaymentStatus = "A_COBRAR",
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "X-Burger", Quantity = 2, UnitPriceCents = 2500 },
                },
            };
        }

        // Como a API manda o AVISO DE CANCELAMENTO (printable.ts, montado do zero): total 0, sem itens, sem contato.
        internal static PrintableOrder CancelFromApi()
        {
            return new PrintableOrder
            {
                OrderId = "ord-5300", Code = "5300", Type = "DELIVERY", StoreName = "Lanchonete Boa Vista", CreatedAt = "2026-11-17T14:05:00.000Z",
                TotalCents = 0, SubtotalCents = 0, DiscountCents = 0, DeliveryFeeCents = 0, TipCents = 0, PaymentMethod = null, PaymentStatus = "A_COBRAR",
                CancelNotice = true, PrintedAtOriginal = "2026-11-17T14:06:00Z", Items = new List<PrintableOrderItem>(),
            };
        }

        // Como o cliente monta o TESTE (o servidor manda total 0 e sem itens; o cliente ignora tudo menos o nome da loja).
        internal static PrintableOrder TestFromClient()
        {
            return new PrintableOrder { IsTest = true, Code = "TESTE", StoreName = "Lanchonete Boa Vista", TotalCents = 0, Items = new List<PrintableOrderItem>() };
        }

        // Pedido SEM totalCents (versao desencontrada): entrega com taxa, cupom, dinheiro e troco. Desconto informado, total ausente.
        internal static PrintableOrder AbsentTotal()
        {
            var json = "{\"orderId\":\"ord-5400\",\"code\":\"5400\",\"type\":\"DELIVERY\",\"storeName\":\"Lanchonete Boa Vista\",\"customerName\":\"Lia Nunes\",\"customerPhone\":\"(21) 96666-5555\","
                + "\"address\":\"Rua Nova, 10\",\"createdAt\":\"2026-11-17T14:05:00.000Z\",\"deliveryFeeCents\":600,\"tipCents\":0,\"subtotalCents\":5000,\"discountCents\":500,\"couponCode\":\"BEM10\","
                + "\"paymentMethod\":\"DINHEIRO\",\"changeForCents\":10000,\"paymentStatus\":\"A_COBRAR\","
                + "\"items\":[{\"productName\":\"X-Burger\",\"quantity\":2,\"unitPriceCents\":2500}]}";
            return Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrder>(json);
        }

        // Balcao, sem forma de pagamento, sem desconto e sem taxa, total AUSENTE.
        internal static PrintableOrder AbsentTotalCounter()
        {
            var o = AbsentTotal();
            o.OrderId = "ord-5401"; o.Code = "5401"; o.Type = "BALCAO"; o.DeliveryFeeCents = 0; o.DiscountCents = null; o.CouponCode = null;
            o.SubtotalCents = null; o.PaymentMethod = null; o.ChangeForCents = null; o.Address = null;
            return o;
        }

        internal static PrintableOrder ZeroTotalReprint()
        {
            var o = ZeroTotal();
            o.ReprintCount = 1; o.PrintedAtOriginal = "2026-11-17T14:06:00Z";
            return o;
        }

        internal static PrintableOrder Reprint()
        {
            var o = Basic();
            o.OrderId = "ord-1042"; o.PaymentMethod = "PIX"; o.PaymentStatus = "PAGO"; o.PrintedAtOriginal = "2026-11-16T23:35:00Z"; o.ChangeForCents = null; o.ReprintCount = 1;
            return o;
        }

        // Quantidades diferentes com adicional: qtd 1 (sem "(1x)"), qtd 3 e item sem adicional. Entrega com taxa, dinheiro.
        internal static PrintableOrder Quantities()
        {
            // itens: 1 x (18,00 + 3,00) + 3 x (15,00 + 4,00) + 2 x 9,00 = 96,00; + taxa 5,00 = 101,00
            return new PrintableOrder
            {
                OrderId = "ord-5005", Code = "5005", Type = "DELIVERY", StoreName = "Sucos & Lanches", CustomerName = "Rita", CreatedAt = "2026-11-17T15:00:00Z",
                DeliveryFeeCents = 500, PaymentMethod = "DINHEIRO", TotalCents = 10100,
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "X-Tudo", Quantity = 1, UnitPriceCents = 1800, Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Bacon extra", PriceCents = 300 } } },
                    new PrintableOrderItem { ProductName = "Suco 300ml", Quantity = 3, UnitPriceCents = 1500, Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Queijo duplo", PriceCents = 400 } } },
                    new PrintableOrderItem { ProductName = "Água", Quantity = 2, UnitPriceCents = 900 },
                },
            };
        }

        // Soma da coluna de valores das linhas de item e de adicional (o que o entregador soma no papel).
        static long ColumnSum(TicketDocument d)
        {
            long sum = 0;
            foreach (var l in d.Lines)
                if (l.RightText.Length > 0 && (l.Text.Length > 1 && char.IsDigit(l.Text[0]) && l.Text.Contains("x ") || l.Text.StartsWith("  + ")))
                    sum += Cents(l.RightText);
            return sum;
        }

        // "R$ 1.234,56" / "+R$ 8,00" / "-R$ 4,50" -> centavos.
        static long Cents(string money)
        {
            var digits = new string(money.Where(char.IsDigit).ToArray());
            long v = digits.Length == 0 ? 0 : long.Parse(digits);
            return money.StartsWith("-") ? -v : v;
        }

        internal static PrintableOrder CancelFixture() { var o = Basic(); o.CancelNotice = true; return o; }

        static TicketDocument Build(PrintableOrder o, int mm = 58) { return TicketBuilder.Build(o, mm, Tz); }
        static string Txt(PrintableOrder o, int mm = 58) { return TextTicketWriter.RenderText(Build(o, mm), TicketText.ColumnsFor(mm)); }

        public static void Run()
        {
            Sanitize();
            Wrapping();
            Builder();
            ContractV1();
            Limits();
            DateAndMoney();
            PaymentBlock();
            TotalZero();
            AbsentTotals();
            NothingToChargeField();
            Writer();
            Golden();
            Probe();
            Png();
        }

        static void Sanitize()
        {
            Check("sanitiza: ESC, GS, BEL e NUL saem (nada vira comando de impressora)", TicketText.Sanitize("a\u001b@b\u001dV\u0000c\u0007d") == "a@bVcd");
            Check("sanitiza: tab, CR, LF e separadores unicode viram espaco unico", TicketText.Sanitize("a\tb\r\nc\u2028d  e") == "a b c d e");
            Check("sanitiza: marcas de direcao (bidi override) saem", TicketText.Sanitize("ab\u202ecd\u2066e\u2069") == "abcde");
            Check("sanitiza: acentos e emoji ficam", TicketText.Sanitize("Pão 🍕 çá") == "Pão 🍕 çá");
            Check("sanitiza: null e so controle viram vazio", TicketText.Sanitize(null) == "" && TicketText.Sanitize("\u0001\u0002") == "");
            Check("papel: emoji, estrelas e seletores saem; o texto em volta fica", TicketText.PrintSafe("Pão 🍕 çá") == "Pão çá" && TicketText.PrintSafe("⭐ promo ❤️ !") == "promo !"
                && TicketText.PrintSafe("molho 🌶️🔥 e sem coentro") == "molho e sem coentro" && TicketText.PrintSafe("🍕") == "");
            Check("papel: acentos, moeda e pontuacao ficam", TicketText.PrintSafe("R$ 5,00 – ação «ok» ñ ü") == "R$ 5,00 – ação «ok» ñ ü");
            Check("sanitiza: C1 (0x80-0x9f) saem", TicketText.Sanitize("a\u0085b\u009bc") == "a b" + "c");
        }

        static void Wrapping()
        {
            Func<string, float> len = s => s.Length;
            Check("quebra: palavras cabem em linhas de ate N", string.Join("|", TicketText.Wrap("aaaa bbbb cccc", 9, len)) == "aaaa bbbb|cccc");
            Check("quebra: palavra gigante e cortada na largura", string.Join("|", TicketText.Wrap("abcdefghijkl", 5, len)) == "abcde|fghij|kl");
            Check("quebra: texto vazio devolve 1 linha vazia", TicketText.Wrap("", 10, len).Count == 1);
            var emoji = TicketText.Wrap("🍕🍕🍕🍕", 2, TicketText.CellWidthF);
            Check("quebra: par substituto de emoji nunca e partido ao meio", emoji.All(l => !l.Any(ch => char.IsSurrogate(ch)) || (l.Length % 2 == 0)) && string.Concat(emoji) == "🍕🍕🍕🍕");
            var combining = TicketText.Wrap("e\u0301e\u0301e\u0301", 2, TicketText.CellWidthF);
            Check("quebra: acento combinado fica com a letra", combining.All(l => !l.StartsWith("\u0301")) && string.Concat(combining) == "e\u0301e\u0301e\u0301");
            Check("quebra: recuo inicial vale para todas as linhas do trecho", string.Join("|", TicketText.Wrap("  + bacon crocante extra", 12, len)) == "  + bacon|  crocante|  extra");
            Check("largura: acento vale 1 coluna e emoji vale 2", TicketText.CellWidth("ação") == 4 && TicketText.CellWidth("🍕") == 2);
            Check("colunas por bobina: 58 mm = 32, 57 mm = 32, 80 mm = 48", TicketText.ColumnsFor(58) == 32 && TicketText.ColumnsFor(57) == 32 && TicketText.ColumnsFor(80) == 48);
        }

        static void Builder()
        {
            var d = Build(Basic());
            var title = d.Lines[0];
            Check("tiquete: titulo da loja centralizado, negrito e maior", title.Text == "Pizzaria do Zé" && title.Align == TicketAlign.Center && title.Bold && title.Scale > 1f);
            Check("tiquete: PEDIDO #codigo e tipo em destaque (DELIVERY => ENTREGA)", d.Lines[1].Text == "PEDIDO #1042" && d.Lines[2].Text == "ENTREGA" && d.Lines[2].Bold && d.Lines[2].Scale > 1f);
            Check("tiquete: data e hora sob o tipo, centralizada", d.Lines[3].Text == "16/11/2026 20:31" && d.Lines[3].Align == TicketAlign.Center);
            Check("tiquete: cliente, telefone e endereco antes dos itens", d.Lines.FindIndex(l => l.Text.StartsWith("Cliente: Maria")) < d.Lines.FindIndex(l => l.Text.StartsWith("2x Pizza"))
                && d.Lines.Any(l => l.Text.StartsWith("Telefone:")) && d.Lines.Any(l => l.Text.StartsWith("Endereço:")));
            Check("tiquete: linha do item = produto x qtd (2 x 35,00 = 70,00)", d.Lines.Any(l => l.Text == "2x Pizza Calabresa G" && l.RightText == "R$ 70,00"));
            Check("tiquete: adicional x qtd escrito, recuado e menor ('(2x)' e +16,00)", d.Lines.Any(l => l.Text == "  + Borda catupiry (2x)" && l.RightText == "+R$ 16,00" && l.Scale < 1f));
            Check("tiquete: a coluna de valores dos itens SOMA o subtotal (70,00 + 16,00 + 8,50 = 94,50)", ColumnSum(d) == 9450 && d.Lines.Any(l => l.Text == "Subtotal" && l.RightText == "R$ 94,50"));
            foreach (var q in new[] { Quantities() })
            {
                var dq = Build(q);
                Check("tiquete qtd 1 com adicional: sem '(1x)' e coluna soma o subtotal", dq.Lines.Any(l => l.Text == "  + Bacon extra" && l.RightText == "+R$ 3,00") && ColumnSum(dq) == 9600);
                Check("tiquete qtd 3 com adicional: '(3x)' e extra x 3", dq.Lines.Any(l => l.Text == "  + Queijo duplo (3x)" && l.RightText == "+R$ 12,00") && dq.Lines.Any(l => l.Text == "3x Suco 300ml" && l.RightText == "R$ 45,00"));
                Check("tiquete: total coerente com a coluna (soma dos itens + taxa + gorjeta - desconto = TOTAL)", ColumnSum(dq) + dq.Lines.Where(l => l.Text == "Taxa de entrega").Sum(l => Cents(l.RightText)) == dq.Lines.Where(l => l.Text == "TOTAL").Sum(l => Cents(l.RightText)));
            }
            Check("tiquete: observacao do item em italico", d.Lines.Any(l => l.Text == "  obs: sem cebola" && l.Italic));
            Check("tiquete: observacao do pedido em destaque", d.Lines.Any(l => l.Text == "OBS: Tocar o interfone" && l.Bold));
            Check("tiquete: subtotal, desconto com o cupom, taxa e TOTAL (CA-B4-03)", d.Lines.Any(l => l.Text == "Subtotal" && l.RightText == "R$ 94,50")
                && d.Lines.Any(l => l.Text == "Desconto (BEM10)" && l.RightText == "-R$ 4,50") && d.Lines.Any(l => l.Text == "Taxa de entrega" && l.RightText == "R$ 6,00")
                && d.Lines.Any(l => l.Text == "TOTAL" && l.RightText == "R$ 96,00" && l.Bold && l.Scale > 1f));
            Check("tiquete: sem gorjeta nao imprime a linha de gorjeta", !d.Lines.Any(l => l.Text == "Gorjeta"));
            Check("tiquete: PaperMm segue o pedido de montagem", Build(Basic(), 80).PaperMm == 80);

            var simple = Build(new PrintableOrder { Code = "1", StoreName = "x", Type = "BALCAO", TotalCents = 1000, PaymentMethod = "DINHEIRO",
                Items = new List<PrintableOrderItem> { new PrintableOrderItem { ProductName = "Café", Quantity = 1, UnitPriceCents = 1000 } } });
            Check("tiquete: sem taxa, gorjeta nem desconto so aparece o TOTAL (sem subtotal)", !simple.Lines.Any(l => l.Text == "Subtotal") && simple.Lines.Any(l => l.Text == "TOTAL"));

            var cur = Build(CurrentContract());
            Check("contrato de hoje: desconto DERIVADO (soma 50,00 + taxa 6,00 + gorjeta 2,00 - total 54,00 = 4,00), sem codigo de cupom",
                cur.Lines.Any(l => l.Text == "Desconto" && l.RightText == "-R$ 4,00") && cur.Lines.Any(l => l.Text == "Gorjeta" && l.RightText == "R$ 2,00"));
            Check("2a via: 'PEDIDO' ganha '2ª VIA (1)' (CA-B4-06)", Build(Reprint()).Lines.Any(l => l.Text == "2ª VIA (1)" && l.Bold) && !Build(Basic()).Lines.Any(l => l.Text.StartsWith("2ª VIA")));

            var h = Build(LongAndHostile());
            bool clean = h.Lines.All(l => l.Text.All(c => c >= ' ' && c != '\u007f') && l.RightText.All(c => c >= ' ' && c != '\u007f'));
            Check("tiquete hostil: nenhum caractere de controle chega ao modelo", clean);
            var notes = h.Lines.First(l => l.Text.StartsWith("OBS:")).Text;
            Check("tiquete hostil: texto do cliente vira texto (ESC/GS removidos, linhas unidas)", notes == "OBS: Sem pimenta@ V por favor segunda linha com tab evil");
            Check("tiquete: pedido nulo / sem itens nao estoura", Build(null).Lines.Count == 0
                && TicketBuilder.Build(new PrintableOrder { Code = "1", StoreName = "x", Items = null }, 58, Tz).Lines.Count > 0);
        }

        // ADR-0004 §6: aviso de cancelamento, 1a impressao na 2a via e cliente antigo/novo (campos desconhecidos).
        static void ContractV1()
        {
            var cancel = Basic();
            cancel.CancelNotice = true;
            var d = Build(cancel);
            var all = string.Join("\n", d.Lines.Select(l => l.Text + " " + l.RightText));
            Check("cancelamento: aviso 'PEDIDO #1042' + 'CANCELADO' grande + 'NAO PREPARAR / NAO ENTREGAR' (CA-B4-09)",
                d.Lines.Any(l => l.Text == "PEDIDO #1042") && d.Lines.Any(l => l.Text == "CANCELADO" && l.Scale >= 2f && l.Bold) && d.Lines.Any(l => l.Text == "NÃO PREPARAR / NÃO ENTREGAR"));
            Check("cancelamento: NAO reimprime o tiquete original (sem itens, valores, endereco, telefone nem pagamento)",
                !all.Contains("Calabresa") && !all.Contains("Refrigerante") && !all.Contains("R$") && !all.Contains("Endereço") && !all.Contains("Telefone") && !all.Contains("COBRAR") && !all.Contains("TOTAL"));
            Check("cancelamento: mostra o tipo e o cliente para achar o pedido", d.Lines.Any(l => l.Text == "ENTREGA") && d.Lines.Any(l => l.Text == "Cliente: Maria da Silva"));
            var mesa = LongAndHostile(); mesa.CancelNotice = true;
            Check("cancelamento de mesa mostra 'MESA 12'", Build(mesa).Lines.Any(l => l.Text == "MESA 12"));
            var hostile = Basic(); hostile.CancelNotice = true; hostile.CustomerName = "Eve\u001b@\u001dV\u0000";
            Check("cancelamento: texto do cliente tambem passa pela sanitizacao", Build(hostile).Lines.All(l => l.Text.All(c => c >= ' ')));
            Check("cancelamento: cancelNotice false/ausente imprime o tiquete normal", Build(Basic()).Lines.Any(l => l.Text.StartsWith("2x Pizza")) && !Build(Basic()).Lines.Any(l => l.Text == "CANCELADO"));
            Check("cancelamento cabe em 58 e 80 mm", new[] { 58, 80 }.All(mm => TextTicketWriter.Render(Build(cancel, mm), TicketText.ColumnsFor(mm)).All(l => TicketText.CellWidth(l) <= TicketText.ColumnsFor(mm))));

            var reprint = Build(Reprint());
            Check("2a via: mostra '1a impressao' (printedAtOriginal 23:35Z => 20:35)", reprint.Lines.Any(l => l.Text == "1ª impressão: 16/11/2026 20:35"));
            Check("2a via: sem printedAtOriginal nao imprime a linha da 1a impressao", !Build(new PrintableOrder { Code = "1", StoreName = "x", ReprintCount = 2, Items = new List<PrintableOrderItem>() }).Lines.Any(l => l.Text.StartsWith("1ª impressão")));

            // O JSON da API pode trazer campos que este cliente nao conhece (versao nova do contrato): nao quebra, e a versao e lida.
            var json = "{\"orderId\":\"o1\",\"code\":\"7\",\"type\":\"BALCAO\",\"storeName\":\"Loja\",\"totalCents\":500,\"paymentMethod\":\"PIX\",\"paymentStatus\":\"PAGO\",\"ticketSchemaVersion\":2,"
                + "\"campoDoFuturo\":{\"x\":1},\"cancelNotice\":null,\"items\":[{\"productName\":\"Cafe\",\"quantity\":1,\"unitPriceCents\":500,\"novo\":true}]}";
            var parsed = Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrderResponse>("{\"order\":" + json + "}").Order;
            Check("contrato: campos desconhecidos e ticketSchemaVersion novo sao tolerados (cliente antigo nao quebra)", parsed != null && parsed.TicketSchemaVersion == 2 && parsed.CancelNotice == null);
            Check("contrato: tiquete de versao nova ainda imprime com os campos que conhece (PIX pago => NAO COBRAR)", Build(parsed).Lines.Any(l => l.Text == "PAGO ONLINE (PIX) - NÃO COBRAR"));
            Check("contrato: JSON do §6 completo mapeia todos os campos", MapAll());
        }

        static bool MapAll()
        {
            var json = "{\"orderId\":\"o\",\"code\":\"1\",\"type\":\"MESA\",\"storeName\":\"L\",\"totalCents\":1000,\"subtotalCents\":1200,\"discountCents\":200,\"couponCode\":\"BEM10\","
                + "\"changeForCents\":2000,\"paymentMethod\":\"DINHEIRO\",\"paymentStatus\":\"A_COBRAR\",\"tableLabel\":\"Mesa 3\",\"reprintCount\":2,"
                + "\"printedAtOriginal\":\"2026-11-16T20:00:00Z\",\"cancelNotice\":false,\"ticketSchemaVersion\":1,\"items\":[]}";
            var o = Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrder>(json);
            return o.SubtotalCents == 1200 && o.DiscountCents == 200 && o.CouponCode == "BEM10" && o.ChangeForCents == 2000 && o.PaymentStatus == "A_COBRAR"
                && o.TableLabel == "Mesa 3" && o.ReprintCount == 2 && o.PrintedAtOriginal == "2026-11-16T20:00:00Z" && o.CancelNotice == false && o.TicketSchemaVersion == 1;
        }

        static string C(int cp) { return ((char)cp).ToString(); }

        sealed class OverlapTarget : IPrintTarget
        {
            int _inside; public int MaxInside; public int Printed;
            public void Print(TicketDocument d)
            {
                int n = System.Threading.Interlocked.Increment(ref _inside);
                lock (this) MaxInside = Math.Max(MaxInside, n);
                System.Threading.Thread.Sleep(30);
                System.Threading.Interlocked.Decrement(ref _inside);
                System.Threading.Interlocked.Increment(ref Printed);
            }
        }

        // PC-15 (parecer Nightingale P12-C1/C2 e recomendacoes): tetos de tamanho, invisiveis, zalgo, WMI com timeout.
        static void Limits()
        {
            foreach (var cp in new[] { 0x061c, 0x2060, 0x180e, 0x034f, 0xfff9, 0xfffa, 0xfffb, 0xfffc, 0xe000, 0xf8ff })
                if (TicketText.Sanitize("a" + C(cp) + "b") != "ab") { Check("sanitiza: invisivel/privado U+" + cp.ToString("X4") + " sai", false); }
            Check("sanitiza: U+061C, U+2060, U+180E, U+034F, U+FFF9-FFFC e uso privado (E000-F8FF) saem", true);
            Check("sanitiza: substituto solto (alto ou baixo) sai; par valido (emoji) fica", TicketText.Sanitize("a" + C(0xd800) + "b" + C(0xdc00) + "c") == "abc" && TicketText.Sanitize("a" + char.ConvertFromUtf32(0x1F355) + "b").Length == 4);
            Check("sanitiza: plano privado 15/16 (par) sai", TicketText.Sanitize("a" + char.ConvertFromUtf32(0xF0000) + "b" + char.ConvertFromUtf32(0x10FFFD) + "c") == "abc");
            Check("sanitiza: acento combinado normal fica", TicketText.Sanitize("e" + C(0x0301)).Length == 2 && TicketText.Sanitize("ac" + C(0x0327) + C(0x0301)).Length == 4);
            var zalgo = "e" + string.Concat(Enumerable.Repeat(C(0x0301), 40)) + "x";
            Check("zalgo: no maximo 2 marcas combinantes por letra (40 viram 2)", TicketText.Sanitize(zalgo) == "e" + C(0x0301) + C(0x0301) + "x");

            var huge = new string('a', 100000);
            var trunc = TicketText.Truncate(TicketText.PrintSafe(huge), TicketText.MaxFieldChars);
            Check("teto: campo de 100 000 caracteres vira 300 + reticencias", trunc.Length == TicketText.MaxFieldChars + 1 && trunc.EndsWith(C(0x2026)));
            var emoji = TicketText.Truncate(string.Concat(Enumerable.Repeat(char.ConvertFromUtf32(0x1F355), 500)), 301);
            Check("teto: nao parte par de emoji ao meio", emoji.All(ch => !char.IsSurrogate(ch) || true) && !emoji.Where((ch, i) => char.IsHighSurrogate(ch) && (i + 1 >= emoji.Length || !char.IsLowSurrogate(emoji[i + 1]))).Any());
            Check("teto: texto curto passa intacto e nulo vira vazio", TicketText.Truncate("abc", 300) == "abc" && TicketText.Truncate(null, 300) == "");

            var big = Basic();
            big.Notes = huge; big.CustomerName = huge; big.Address = huge; big.StoreName = huge;
            var bd = Build(big);
            Check("teto: nome, endereco e observacao de 100 000 caracteres saem com 300 + reticencias", bd.Lines.All(l => l.Text.Length <= TicketText.MaxFieldChars + 20));
            Check("teto: tiquete com campos gigantes continua pequeno no papel (58 mm: < 120 linhas)", TextTicketWriter.Render(bd, 32).Count < 120);

            // N1 (seguranca alimentar): cortar texto NUNCA e silencioso
            Func<PrintableOrder, TicketDocument> bd2 = o => Build(o);
            var allergy = Basic(); allergy.Notes = "ALERGIA A AMENDOIM " + new string('x', 400);
            var ad = bd2(allergy);
            int oi = ad.Lines.FindIndex(l => l.Text.StartsWith("OBS: ALERGIA"));
            Check("N1: observacao do pedido cortada => linha propria '(observação cortada — ver no painel)' logo depois, em negrito",
                oi >= 0 && ad.Lines[oi].Text.EndsWith(C(0x2026)) && ad.Lines[oi + 1].Text == "(observação cortada — ver no painel)" && ad.Lines[oi + 1].Bold);
            Check("N1: a alergia (o comeco da observacao) continua impressa", ad.Lines[oi].Text.Contains("ALERGIA A AMENDOIM"));
            var exact = Basic(); exact.Notes = new string('y', 300);
            Check("N1: observacao com exatamente 300 caracteres NAO tem aviso (nao foi cortada)", !bd2(exact).Lines.Any(l => l.Text.Contains("cortada")));
            var over = Basic(); over.Notes = new string('y', 301);
            Check("N1: observacao com 301 caracteres tem aviso", bd2(over).Lines.Any(l => l.Text == "(observação cortada — ver no painel)"));
            var itemCut = Basic(); itemCut.Items[0].Notes = "sem gluten " + new string('z', 400);
            var icd = bd2(itemCut);
            int ii = icd.Lines.FindIndex(l => l.Text.StartsWith("  obs: sem gluten"));
            Check("N1: observacao do ITEM cortada => aviso logo depois do item", ii >= 0 && icd.Lines[ii + 1].Text == "(observação cortada — ver no painel)");
            var addrCut = Basic(); addrCut.Address = new string('a', 500);
            Check("N1: endereco cortado => aviso (entregador nao pode ir a um endereco incompleto sem saber)", bd2(addrCut).Lines.Any(l => l.Text == "(endereço cortado — ver no painel)"));
            var nameCut = Basic(); nameCut.Items[1].ProductName = new string('n', 400);
            Check("N1: nome de item cortado => aviso", bd2(nameCut).Lines.Any(l => l.Text == "(nome do item cortado — ver no painel)"));
            var addCut = Basic(); addCut.Items[0].Additionals[0].Name = "Borda " + new string('q', 400);
            var acd = bd2(addCut);
            int ai = acd.Lines.FindIndex(l => l.Text.StartsWith("  + Borda q"));
            Check("N1: nome de ADICIONAL cortado => aviso em linha propria logo depois do adicional, em negrito", ai >= 0 && acd.Lines[ai].Text.Contains(C(0x2026)) && acd.Lines[ai + 1].Text == "(adicional cortado — ver no painel)" && acd.Lines[ai + 1].Bold);
            var addExact = Basic(); addExact.Items[0].Additionals[0].Name = new string('q', 300);
            Check("N1: adicional com exatamente 300 caracteres NAO tem aviso", !bd2(addExact).Lines.Any(l => l.Text.Contains("adicional cortado")));
            var custCut = Basic(); custCut.CustomerName = new string('m', 400);
            Check("N1: nome do cliente cortado => aviso", bd2(custCut).Lines.Any(l => l.Text == "(nome do cliente cortado — ver no painel)"));
            Check("N1: pedido normal nao tem nenhum aviso de corte", !bd2(Basic()).Lines.Any(l => l.Text.Contains("cortad")));

            // 500 itens, 40 adicionais no primeiro: papel limitado, subtotal e TOTAL corretos, coluna ainda soma
            var many = new List<PrintableOrderItem>();
            long expected = 0;
            for (int i = 0; i < 500; i++) { many.Add(new PrintableOrderItem { ProductName = "Item " + i, Quantity = 2, UnitPriceCents = 100 + i }); expected += 2L * (100 + i); }
            var adds = new List<PrintableOrderAdditional>();
            for (int i = 0; i < 40; i++) { adds.Add(new PrintableOrderAdditional { Name = "Extra " + i, PriceCents = 10 }); }
            many[0].Additionals = adds; expected += 2L * 40 * 10;
            var order = new PrintableOrder { Code = "9", StoreName = "L", Type = "BALCAO", PaymentMethod = "CREDITO", TotalCents = (int)expected, Items = many };
            var md = Build(order);
            Check("teto de itens: so 80 itens no papel + 'e mais 420 itens (ver no painel)'", md.Lines.Count(l => l.Text.Length > 1 && char.IsDigit(l.Text[0]) && l.Text.Contains("x ")) == TicketText.MaxItemLines
                && md.Lines.Any(l => l.Text == "... e mais 420 itens (ver no painel)"));
            Check("teto de adicionais: 12 por item + '+ mais 28 adicionais'", md.Lines.Count(l => l.Text.StartsWith("  + Extra")) == TicketText.MaxAdditionalsPerItem && md.Lines.Any(l => l.Text == "  + mais 28 adicionais" && l.RightText == "+R$ 5,60"));
            Check("teto: a coluna (itens, adicionais e linha dos escondidos) AINDA soma o subtotal e o TOTAL fica certo",
                ColumnSumWithHidden(md) == expected && md.Lines.Any(l => l.Text == "TOTAL" && Cents(l.RightText) == expected));
            Check("teto: tiquete de 500 itens tem menos de 200 linhas logicas", md.Lines.Count < 200);

            // propriedade: texto aleatorio (todas as classes) nunca gera caractere proibido, e Sanitize e idempotente
            var rnd = new Random(20261116);
            int[] pool = { 0x41, 0x20, 0x09, 0x0a, 0x1b, 0x1d, 0x00, 0x07, 0x7f, 0x85, 0x9b, 0x0301, 0x061c, 0x2060, 0x180e, 0x034f, 0xfff9, 0xfffc, 0xe000, 0xf8ff, 0x202e, 0x2066, 0x200b, 0xfeff, 0xd800, 0xdc00, 0xe9, 0x2026 };
            bool allClean = true, idem = true, noThrow = true;
            for (int n = 0; n < 3000 && allClean && idem && noThrow; n++)
            {
                var sb = new System.Text.StringBuilder();
                int len = rnd.Next(0, 80);
                for (int k = 0; k < len; k++)
                {
                    int r = rnd.Next(pool.Length + 3);
                    if (r < pool.Length) sb.Append((char)pool[r]);
                    else if (r == pool.Length) sb.Append(char.ConvertFromUtf32(0x1F355));
                    else if (r == pool.Length + 1) sb.Append(char.ConvertFromUtf32(0xF0001));
                    else sb.Append((char)rnd.Next(0x20, 0xFFFF));
                }
                try
                {
                    var once = TicketText.Sanitize(sb.ToString());
                    var twice = TicketText.Sanitize(once);
                    if (once != twice) idem = false;
                    for (int i = 0; i < once.Length; i++)
                    {
                        char ch = once[i];
                        if (char.IsHighSurrogate(ch)) { if (i + 1 >= once.Length || !char.IsLowSurrogate(once[i + 1])) allClean = false; else { if (char.ConvertToUtf32(ch, once[i + 1]) >= 0xF0000) allClean = false; i++; } continue; }
                        if (char.IsLowSurrogate(ch)) { allClean = false; continue; }
                        if (ch < ' ' || ch == (char)0x7f || (ch >= (char)0x80 && ch <= (char)0x9f) || (ch >= (char)0xe000 && ch <= (char)0xf8ff) || (ch >= (char)0xfff9 && ch <= (char)0xfffc)
                            || ch == (char)0x061c || ch == (char)0x2060 || ch == (char)0x180e || ch == (char)0x034f || ch == (char)0x202e || ch == (char)0x2066 || ch == (char)0x200b || ch == (char)0xfeff) allClean = false;
                    }
                    TicketText.PrintSafe(sb.ToString());
                    TicketText.Truncate(once, 20);
                }
                catch { noThrow = false; }
            }
            Check("propriedade (3 000 textos aleatorios): saida sem controle, invisivel, uso privado nem substituto solto", allClean);
            Check("propriedade: Sanitize e idempotente e nunca lanca excecao", idem && noThrow);

            // WMI: timeout e nao bloqueia
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var slow = PrinterProbe.WithTimeout(() => { System.Threading.Thread.Sleep(3000); return "A impressora esta offline"; }, 200);
            sw.Stop();
            Check("WMI: consulta lenta desiste no timeout (devolve 'desconhecido', nao bloqueia a cozinha)", slow == null && sw.ElapsedMilliseconds < 2500);
            // voo unico (N2): com a consulta anterior ainda presa, a proxima NAO cria tarefa e devolve 'desconhecido' na hora
            int started = 0;
            sw.Restart();
            var second = PrinterProbe.WithTimeout(() => { System.Threading.Interlocked.Increment(ref started); return "outra"; }, 1000);
            sw.Stop();
            Check("WMI voo unico: com uma consulta presa, a seguinte nao cria tarefa (nao e executada) e volta na hora", second == null && started == 0 && sw.ElapsedMilliseconds < 500);
            System.Threading.Thread.Sleep(3200); // a consulta lenta termina e libera o voo
            Check("WMI voo unico: terminada a presa, a proxima consulta roda normalmente", PrinterProbe.WithTimeout(() => "livre", 1000) == "livre");
            Check("WMI: consulta rapida devolve o motivo; excecao vira 'desconhecido'", PrinterProbe.WithTimeout(() => "sem papel", 1000) == "sem papel" && PrinterProbe.WithTimeout(() => { throw new InvalidOperationException("x"); }, 1000) == null);
            Check("WMI: tetos configurados (enumeracao 3 s, total 5 s)", PrinterProbe.EnumerationTimeoutMs == 3000 && PrinterProbe.TotalTimeoutMs == 5000);

            // impressao serializada: 8 pedidos ao mesmo tempo nunca imprimem sobrepostos
            var target = new OverlapTarget();
            var device = new DeviceClient(new PrintLedger(null), new AppSettings { ApiBaseUrl = "http://127.0.0.1:9", DeviceToken = "t" });
            var coord = new PrintCoordinator(device, target, () => 58, Tz);
            var threads = Enumerable.Range(0, 8).Select(i => new System.Threading.Thread(() => { var o = Basic(); o.OrderId = "ser-" + i; o.Code = "S" + i; coord.Handle(o); })).ToList();
            threads.ForEach(t => t.Start()); threads.ForEach(t => t.Join());
            Check("impressao: 8 pedidos simultaneos imprimem um de cada vez (sem tiquetes misturados)", target.Printed == 8 && target.MaxInside == 1);
            device.Dispose();
        }

        // Soma da coluna incluindo a linha dos itens escondidos ("... e mais N itens").
        static long ColumnSumWithHidden(TicketDocument d)
        {
            long sum = 0;
            foreach (var l in d.Lines)
                if (l.RightText.Length > 0 && ((l.Text.Length > 1 && char.IsDigit(l.Text[0]) && l.Text.Contains("x ")) || l.Text.StartsWith("  + ") || l.Text.StartsWith("... e mais ")))
                    sum += Cents(l.RightText);
            return sum;
        }

        static void DateAndMoney()
        {
            Check("data: ISO em UTC vira dd/MM/aaaa HH:mm no fuso pedido (01:31Z => 22:31 do dia anterior em UTC-3)", TicketBuilder.FormatDate("2026-11-17T01:31:00.000Z", Tz) == "16/11/2026 22:31");
            Check("data: cruza a meia-noite e o mes/ano", TicketBuilder.FormatDate("2027-01-01T01:00:00Z", Tz) == "31/12/2026 22:00");
            Check("data: com offset explicito converte para o fuso pedido", TicketBuilder.FormatDate("2026-11-16T20:31:00-03:00", Tz) == "16/11/2026 20:31" && TicketBuilder.FormatDate("2026-11-16T20:31:00+00:00", Tz) == "16/11/2026 17:31");
            var utc = TimeZoneInfo.Utc;
            Check("data: fuso UTC mantem a hora", TicketBuilder.FormatDate("2026-11-17T01:31:00.000Z", utc) == "17/11/2026 01:31");
            Check("data: vazia some; texto que nao e data sai limpo, sem controle", TicketBuilder.FormatDate("", Tz) == "" && TicketBuilder.FormatDate(null, Tz) == "" && TicketBuilder.FormatDate("ontem\u0007 a noite", Tz) == "ontem a noite");
            Check("data: nunca imprime o ISO cru no papel", !Txt(CurrentContract()).Contains("T01:31") && Txt(CurrentContract()).Contains("16/11/2026 22:31"));
            Check("dinheiro: centavos, zero, negativo e valores grandes", TicketBuilder.Money(0) == "R$ 0,00" && TicketBuilder.Money(5) == "R$ 0,05"
                && TicketBuilder.Money(123456) == "R$ 1234,56" && TicketBuilder.Money(-250) == "-R$ 2,50" && TicketBuilder.Money(10000000000L) == "R$ 100000000,00");
        }

        // Os cenarios do bloco de pagamento (B4.2) e CA-B4-01/02/08: o que o entregador/balcao precisa saber.
        static void PaymentBlock()
        {
            string status = "PAGO"; // prova de pagamento online; os cenarios sem PIX nao dependem dela
            Func<string, string, int, int?, string[]> lines = (type, method, total, changeFor) =>
                TicketBuilder.PaymentLines(new PrintableOrder { Type = type, PaymentMethod = method, TotalCents = total, ChangeForCents = changeFor, PaymentStatus = status }, type.ToUpperInvariant()).ToArray();
            Func<string[], string> one = a => string.Join(" | ", a);

            Check("pagamento 1: PIX aprovado (com prova) => PAGO ONLINE, sem frase de cobranca (CA-B4-02)", one(lines("DELIVERY", "PIX", 4500, null)) == "PAGO ONLINE (PIX) - NÃO COBRAR");
            foreach (var noProof in new string[] { null, "", "A_COBRAR", "APROVADO", "PENDENTE", "qualquer" })
            {
                status = noProof;
                Check("fail-safe: PIX sem prova (status '" + (noProof ?? "null") + "') NUNCA diz NÃO COBRAR, manda conferir na hora", one(lines("DELIVERY", "PIX", 4500, null)) == "PIX - CONFERIR NA HORA");
            }
            status = "pago";
            Check("fail-safe: status em minusculas tambem e prova", one(lines("DELIVERY", "PIX", 4500, null)) == "PAGO ONLINE (PIX) - NÃO COBRAR");
            status = "PAGO";
            Check("fail-safe: pedido manual com PIX presencial (sem status) imprime 'conferir na hora', inclusive na mesa e no balcao",
                one(TicketBuilder.PaymentLines(new PrintableOrder { Type = "BALCAO", PaymentMethod = "PIX", TotalCents = 100 }, "BALCAO").ToArray()) == "PIX - CONFERIR NA HORA"
                && one(TicketBuilder.PaymentLines(new PrintableOrder { Type = "MESA", PaymentMethod = "PIX", TotalCents = 100 }, "MESA").ToArray()) == "PIX - CONFERIR NA HORA");
            status = "ESTORNADO";
            Check("pagamento: PIX ESTORNADO nunca diz NAO COBRAR (manda conferir)", one(lines("DELIVERY", "PIX", 4500, null)) == "PIX ESTORNADO - CONFERIR NA HORA");
            status = "PAGO";
            Check("contrato ADR-0004 §6: 'APROVADO' (enum antigo do banco) NAO vale como prova; so PAGO", TicketBuilder.PaymentLines(new PrintableOrder { Type = "DELIVERY", PaymentMethod = "PIX", PaymentStatus = "APROVADO", TotalCents = 1 }, "DELIVERY")[0] == "PIX - CONFERIR NA HORA");
            Check("pagamento: status PAGO sem PIX nao muda nada (dinheiro continua cobrando)", one(lines("DELIVERY", "DINHEIRO", 4500, null)) == "COBRAR R$ 45,00 EM DINHEIRO");
            var mesa = Build(LongAndHostile());
            Check("mesa: tableLabel 'Mesa 12' vira 'MESA 12' no topo (CA-B4-08); sem rotulo fica so 'MESA'", mesa.Lines[2].Text == "MESA 12"
                && Build(new PrintableOrder { Code = "9", StoreName = "x", Type = "MESA", Items = new List<PrintableOrderItem>() }).Lines[2].Text == "MESA");
            Check("pagamento 2: dinheiro sem troco => COBRAR R$ X EM DINHEIRO", one(lines("DELIVERY", "DINHEIRO", 4500, null)) == "COBRAR R$ 45,00 EM DINHEIRO");
            Check("pagamento 3: dinheiro com troco => cobrar, troco para, levar de troco (CA-B4-01: 45,00, 100,00 => 55,00)",
                one(lines("DELIVERY", "DINHEIRO", 4500, 10000)) == "COBRAR R$ 45,00 EM DINHEIRO | TROCO PARA R$ 100,00 | LEVAR R$ 55,00 DE TROCO");
            Check("pagamento 4: cartao (credito, debito, VR, VA) => COBRAR NO CARTAO com o tipo",
                one(lines("DELIVERY", "CREDITO", 3000, null)) == "COBRAR R$ 30,00 NO CARTÃO (crédito)" && one(lines("DELIVERY", "DEBITO", 3000, null)) == "COBRAR R$ 30,00 NO CARTÃO (débito)"
                && one(lines("BALCAO", "VR", 3000, null)) == "COBRAR R$ 30,00 NO CARTÃO (VR)" && one(lines("BALCAO", "VA", 3000, null)) == "COBRAR R$ 30,00 NO CARTÃO (VA)");
            Check("pagamento 5: retirada/balcao sem forma escolhida => COBRAR NO CAIXA", one(lines("BALCAO", null, 2500, null)) == "COBRAR NO CAIXA R$ 25,00");
            Check("pagamento 6: mesa sem pagamento online => PAGAMENTO NA MESA (CA-B4-08)", one(lines("MESA", null, 2500, null)) == "PAGAMENTO NA MESA" && one(lines("MESA", "DINHEIRO", 2500, null)) == "PAGAMENTO NA MESA");
            Check("pagamento 7: entrega sem forma de pagamento => FORMA NAO INFORMADA", one(lines("DELIVERY", null, 2500, null)) == "FORMA DE PAGAMENTO NÃO INFORMADA" && one(lines("DELIVERY", "BITCOIN", 2500, null)) == "FORMA DE PAGAMENTO NÃO INFORMADA");
            Check("pagamento 8: 'troco para' menor ou igual ao total e ignorado (sem troco negativo)", one(lines("DELIVERY", "DINHEIRO", 4500, 4500)) == "COBRAR R$ 45,00 EM DINHEIRO" && one(lines("DELIVERY", "DINHEIRO", 4500, 3000)) == "COBRAR R$ 45,00 EM DINHEIRO");
            Check("pagamento 9: mesa paga por PIX online => PAGO ONLINE", one(lines("MESA", "PIX", 2500, null)) == "PAGO ONLINE (PIX) - NÃO COBRAR");
            Check("pagamento: forma em minusculas ou com espacos tambem vale", one(lines("DELIVERY", " pix ", 100, null)) == "PAGO ONLINE (PIX) - NÃO COBRAR");

            var d = Build(Basic());
            int last = d.Lines.Count - 1;
            Check("pagamento: bloco em destaque no fim do tiquete (centralizado, negrito, maior, entre separadores)",
                d.Lines[last].Divider && d.Lines[last - 1].Text == "LEVAR R$ 4,00 DE TROCO" && d.Lines[last - 1].Bold && d.Lines[last - 1].Scale > 1f && d.Lines[last - 1].Align == TicketAlign.Center);
        }

        // PC-23 (API-66): o campo `nothingToCharge` do servidor. Presente MANDA; `true` exige total presente e 0; ausente => aritmetica do PC-19.
        static void NothingToChargeField()
        {
            const string Z = "SEM COBRANÇA: NADA A COBRAR";
            Func<PrintableOrder, string> pay = o => string.Join("|", TicketBuilder.PaymentLines(o, (o.Type ?? "").ToUpperInvariant()));
            Func<string, PrintableOrder> fromJson = j => Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrder>(j);

            var no = ZeroTotal(); no.NothingToCharge = false;
            Check("servidor diz nothingToCharge=false com total 0 e desconto = itens (pagamento vivo): NUNCA 'SEM COBRANÇA' (o campo presente manda)", !pay(no).Contains("SEM COBRANÇA"));
            var noPix = ZeroTotal(); noPix.NothingToCharge = false; noPix.PaymentMethod = "PIX"; noPix.PaymentStatus = "A_COBRAR";
            Check("nothingToCharge=false com PIX pendente e total 0: regra normal do PIX ('PIX - CONFERIR NA HORA'), nao 'nada a cobrar'", pay(noPix) == "PIX - CONFERIR NA HORA");

            var yes = ZeroTotal(); yes.NothingToCharge = true;
            Check("nothingToCharge=true com total PRESENTE e 0: diz 'SEM COBRANÇA'", pay(yes) == Z);
            var yesNoDiscount = ZeroTotal(); yesNoDiscount.NothingToCharge = true; yesNoDiscount.DiscountCents = null; yesNoDiscount.SubtotalCents = null;
            Check("nothingToCharge=true manda mesmo quando a aritmetica local nao fecharia (o servidor e a fonte unica)", pay(yesNoDiscount) == Z);

            var yesTotal = ZeroTotal(); yesTotal.NothingToCharge = true; yesTotal.TotalCents = 5000;
            Check("nothingToCharge=true mas total R$ 50 (incoerente): regra normal (cobra), NUNCA 'SEM COBRANÇA'", !pay(yesTotal).Contains("SEM COBRANÇA") && TicketBuilder.IsNothingToChargeConflict(yesTotal));
            var yesAbsent = fromJson("{\"orderId\":\"x\",\"code\":\"1\",\"type\":\"BALCAO\",\"nothingToCharge\":true,\"items\":[{\"productName\":\"A\",\"quantity\":1,\"unitPriceCents\":1000}]}");
            Check("nothingToCharge=true mas total AUSENTE: regra normal e conflito registrado (nao decide 'nada a cobrar' sozinho)", !pay(yesAbsent).Contains("SEM COBRANÇA") && TicketBuilder.IsNothingToChargeConflict(yesAbsent) && !yesAbsent.HasTotalCents);
            var yesNull = fromJson("{\"orderId\":\"x\",\"code\":\"1\",\"type\":\"BALCAO\",\"nothingToCharge\":true,\"totalCents\":null,\"items\":[]}");
            Check("nothingToCharge=true com totalCents null: tratado como ausente (regra normal + conflito)", !pay(yesNull).Contains("SEM COBRANÇA") && TicketBuilder.IsNothingToChargeConflict(yesNull));
            Check("sem conflito: campo ausente, false, ou true com total 0 presente nao geram aviso", !TicketBuilder.IsNothingToChargeConflict(ZeroTotal()) && !TicketBuilder.IsNothingToChargeConflict(no) && !TicketBuilder.IsNothingToChargeConflict(yes));

            var absentField = ZeroTotal(); absentField.NothingToCharge = null;
            Check("campo AUSENTE (API antiga): vale a aritmetica do PC-19 (desconto = itens, total 0 presente => 'SEM COBRANÇA')", pay(absentField) == Z);
            var absentFieldBad = ZeroTotal(); absentFieldBad.NothingToCharge = null; absentFieldBad.DiscountCents = 100;
            Check("campo AUSENTE e aritmetica nao fecha (desconto R$ 1 em R$ 50): regra normal", !pay(absentFieldBad).Contains("SEM COBRANÇA"));

            // leitura do JSON: true, false, null e ausente
            var jTrue = fromJson("{\"nothingToCharge\":true}"); var jFalse = fromJson("{\"nothingToCharge\":false}"); var jNull = fromJson("{\"nothingToCharge\":null}"); var jMiss = fromJson("{}");
            Check("JSON: nothingToCharge true/false/null/ausente => true/false/ausente/ausente", jTrue.NothingToCharge == true && jFalse.NothingToCharge == false && jNull.NothingToCharge == null && jMiss.NothingToCharge == null);

            // aviso de cancelamento e teste nunca usam o campo (layout proprio, sem linha de pagamento)
            var cancel = CancelFromApi(); cancel.NothingToCharge = true;
            var test = TestFromClient(); test.NothingToCharge = true;
            Check("aviso de cancelamento e TESTE com nothingToCharge=true: continuam sem linha de pagamento e sem conflito", !Txt(cancel).Contains("SEM COBRANÇA") && !Txt(test).Contains("SEM COBRANÇA") && !TicketBuilder.IsNothingToChargeConflict(cancel) && !TicketBuilder.IsNothingToChargeConflict(test));

            // 2a via de total zero com o campo do servidor
            var re = ZeroTotalReprint(); re.NothingToCharge = true;
            Check("2a via de total zero com nothingToCharge=true: 'SEM COBRANÇA' e '2ª VIA'", TextTicketWriter.RenderText(Build(re), 32).Contains(Z) && TextTicketWriter.RenderText(Build(re), 32).Contains("2ª VIA"));

            // lacuna apontada pelo Deming (mutante M6 do PC-21): desconto maior que os itens com total ausente NAO pode calcular um valor negativo
            var over = AbsentTotalCounter(); over.DiscountCents = 6000;
            var overTxt = TextTicketWriter.RenderText(Build(over), 32);
            Check("total ausente com desconto R$ 60 sobre itens R$ 50: 'TOTAL NÃO INFORMADO' e SEM 'CALCULADO' (nao calcula valor negativo)", overTxt.Contains("TOTAL NÃO INFORMADO") && !overTxt.Contains("CALCULADO"));
        }

        // PC-21 (parecer Nightingale): total AUSENTE nunca imprime "TOTAL R$ 0,00" nem "COBRAR R$ 0,00".
        static void AbsentTotals()
        {
            Func<PrintableOrder, int, string> paper = (o, mm) => TextTicketWriter.RenderText(Build(o, mm), TicketText.ColumnsFor(mm));
            Func<string, PrintableOrder> fromJson = j => Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrder>(j);
            foreach (var mm in new[] { 58, 80 })
            {
                var t = paper(AbsentTotal(), mm);
                Check("total ausente (" + mm + " mm): diz 'TOTAL NÃO INFORMADO - CONFERIR NO PAINEL' e NUNCA 'TOTAL R$ 0,00'", t.Replace("\n", " ").Contains("TOTAL NÃO INFORMADO") && !t.Contains("TOTAL                    R$ 0,00") && !t.Contains("R$ 0,00"));
                Check("total ausente (" + mm + " mm): mostra o valor CALCULADO (itens R$ 50 + taxa R$ 6 - desconto R$ 5 = R$ 51,00)", t.Contains("CALCULADO") && t.Contains("R$ 51,00"));
                Check("total ausente (" + mm + " mm): a linha de pagamento nunca manda cobrar R$ 0,00", !t.Contains("COBRAR R$ 0,00") && t.Contains("TOTAL NÃO INFORMADO"));
            }
            var pay = string.Join("|", TicketBuilder.PaymentLines(AbsentTotal(), "DELIVERY"));
            Check("total ausente em dinheiro com troco: 'COBRAR (TOTAL NÃO INFORMADO) EM DINHEIRO' e 'TROCO PARA R$ 100,00', SEM 'LEVAR' (nao calcula contra total ausente)",
                pay == "COBRAR (TOTAL NÃO INFORMADO) EM DINHEIRO|TROCO PARA R$ 100,00");
            Check("total ausente no balcao sem forma de pagamento: 'COBRAR NO CAIXA (TOTAL NÃO INFORMADO)'", string.Join("|", TicketBuilder.PaymentLines(AbsentTotalCounter(), "BALCAO")) == "COBRAR NO CAIXA (TOTAL NÃO INFORMADO)");
            foreach (var m in new[] { "CREDITO", "DEBITO", "VR", "VA" })
            {
                var c = AbsentTotalCounter(); c.PaymentMethod = m;
                Check("total ausente no cartao (" + m + "): sem 'R$ 0,00'", !string.Join("|", TicketBuilder.PaymentLines(c, "BALCAO")).Contains("R$ 0,00"));
            }
            var pix = AbsentTotalCounter(); pix.PaymentMethod = "PIX";
            Check("total ausente com PIX sem prova: continua 'PIX - CONFERIR NA HORA'", string.Join("|", TicketBuilder.PaymentLines(pix, "BALCAO")) == "PIX - CONFERIR NA HORA");
            // sem desconto informado: NAO inventa desconto a partir de um total que nao existe
            var counter = paper(AbsentTotalCounter(), 58);
            Check("total ausente sem desconto informado: nao imprime 'Desconto' (nao deriva de total ausente) e calcula R$ 50,00", !counter.Contains("Desconto") && counter.Contains("CALCULADO") && counter.Contains("R$ 50,00"));
            // sem itens: nao ha o que calcular
            var empty = AbsentTotalCounter(); empty.Items = new List<PrintableOrderItem>();
            Check("total ausente sem itens: avisa que o total nao veio e NAO mostra CALCULADO", paper(empty, 58).Contains("TOTAL NÃO INFORMADO") && !paper(empty, 58).Contains("CALCULADO"));
            // subtotal informado que nao bate com os itens: nao calcula
            var diverge = AbsentTotal(); diverge.SubtotalCents = 4000;
            Check("total ausente com subtotal que nao bate com os itens: NAO mostra CALCULADO (nao chuta)", paper(diverge, 58).Contains("TOTAL NÃO INFORMADO") && !paper(diverge, 58).Contains("CALCULADO"));
            // null explicito e campo ausente se comportam igual
            var viaNull = fromJson("{\"orderId\":\"n\",\"code\":\"7\",\"type\":\"BALCAO\",\"totalCents\":null,\"items\":[{\"productName\":\"A\",\"quantity\":1,\"unitPriceCents\":1000}]}");
            var viaMissing = fromJson("{\"orderId\":\"n\",\"code\":\"7\",\"type\":\"BALCAO\",\"items\":[{\"productName\":\"A\",\"quantity\":1,\"unitPriceCents\":1000}]}");
            Check("totalCents null e campo ausente imprimem o mesmo papel (total nao informado, calculado R$ 10,00)", paper(viaNull, 58) == paper(viaMissing, 58) && paper(viaNull, 58).Contains("TOTAL NÃO INFORMADO") && paper(viaNull, 58).Contains("R$ 10,00"));
            // total PRESENTE continua igual (golden dos demais fixtures cobre); 0 escrito segue sendo "TOTAL R$ 0,00" quando nao e nada-a-cobrar
            var present = AbsentTotalCounter(); present.TotalCents = 5000;
            Check("total presente: continua 'TOTAL R$ 50,00' e nenhuma linha de total nao informado", paper(present, 58).Contains("R$ 50,00") && !paper(present, 58).Contains("NÃO INFORMADO"));
        }

        // PC-19 (RN-CP-12, CA-CP-07/18): total zero imprime "SEM COBRANÇA: NADA A COBRAR", decidido pelo TOTAL.
        static void TotalZero()
        {
            const string Z = "SEM COBRANÇA: NADA A COBRAR";
            Func<PrintableOrder, string> pay = o => string.Join("|", TicketBuilder.PaymentLines(o, (o.Type ?? "").ToUpperInvariant()));
            var z = ZeroTotal();
            Check("total zero: a linha de pagamento e exatamente 'SEM COBRANÇA: NADA A COBRAR' (com A_COBRAR do servidor)", pay(z) == Z);
            foreach (var st in new[] { "A_COBRAR", "PAGO", "ESTORNADO", null, "QUALQUER-COISA" })
                foreach (var method in new[] { null, "PIX", "DINHEIRO", "CREDITO", "DEBITO", "VR", "VA" })
                {
                    var o = ZeroTotal(); o.PaymentStatus = st; o.PaymentMethod = method; o.ChangeForCents = method == "DINHEIRO" ? 10000 : (int?)null;
                    Check("total zero: qualquer paymentStatus/forma (" + (st ?? "ausente") + "/" + (method ?? "nula") + ") imprime so a frase", pay(o) == Z);
                }
            var mesa = ZeroTotal(); mesa.Type = "MESA"; mesa.TableLabel = "12";
            Check("total zero na MESA: tambem 'SEM COBRANÇA' (nao 'PAGAMENTO NA MESA')", pay(mesa) == Z);
            var delivery = ZeroTotal(); delivery.Type = "DELIVERY";
            Check("total zero em ENTREGA: 'SEM COBRANÇA' (sem 'FORMA DE PAGAMENTO NAO INFORMADA')", pay(delivery) == Z);
            var re = ZeroTotalReprint();
            var reTxt = TextTicketWriter.RenderText(Build(re), 32);
            Check("total zero na 2a via: mantem '2ª VIA (1)' e a frase 'SEM COBRANÇA'", reTxt.Contains("2ª VIA (1)") && reTxt.Contains(Z));

            var txt = TextTicketWriter.RenderText(Build(z), 32);
            Check("total zero: o papel traz a frase e NENHUM 'COBRAR R$' nem 'PIX' nem 'CONFERIR'", txt.Contains(Z) && !txt.Contains("COBRAR R$") && !txt.Contains("PIX") && !txt.Contains("CONFERIR") && !txt.Contains("COBRAR NO CAIXA"));
            Check("total zero: o TOTAL R$ 0,00 e o desconto continuam visiveis", txt.Contains("TOTAL") && txt.Contains("R$ 0,00") && txt.Contains("TUDOGRATIS"));

            // taxa de entrega nao e coberta pelo cupom: total R$ 6,00 segue o fluxo normal
            var fee = ZeroTotal(); fee.Type = "DELIVERY"; fee.DeliveryFeeCents = 600; fee.TotalCents = 600; fee.PaymentMethod = "DINHEIRO";
            Check("entrega com taxa de R$ 6,00 e cupom de 100% (total R$ 6,00): fluxo normal, sem 'SEM COBRANÇA'", pay(fee).StartsWith("COBRAR R$ 6,00 EM DINHEIRO") && !pay(fee).Contains("SEM COBRANÇA"));
            var normal = Basic();
            Check("pedido normal (total > 0): nenhuma linha 'SEM COBRANÇA'", !pay(normal).Contains("SEM COBRANÇA"));

            // trava de consistencia: total 0 com itens que valem dinheiro e SEM desconto e dado faltando, nunca "nada a cobrar"
            var missing = ZeroTotal(); missing.DiscountCents = null; missing.SubtotalCents = null; missing.CouponCode = null;
            Check("total 0 SEM desconto e com itens de valor (dado faltando): NAO diz 'nada a cobrar'", !pay(missing).Contains("SEM COBRANÇA"));
            var missing2 = ZeroTotal(); missing2.DiscountCents = 0;
            Check("total 0 com desconto 0 e itens de valor: NAO diz 'nada a cobrar'", !pay(missing2).Contains("SEM COBRANÇA"));
            // ---- Condicao da Nightingale (PC-19): ARITMETICA, e AUSENTE nao e ZERO ----
            Func<string, PrintableOrder> fromJson = j => Newtonsoft.Json.JsonConvert.DeserializeObject<PrintableOrder>(j);
            const string itemsJson = "\"items\":[{\"productName\":\"X-Burger\",\"quantity\":2,\"unitPriceCents\":2500}]";
            var absent = fromJson("{\"orderId\":\"a\",\"code\":\"1\",\"type\":\"BALCAO\",\"subtotalCents\":5000,\"discountCents\":5000," + itemsJson + "}");
            Check("total AUSENTE no JSON (mesmo com desconto igual aos itens): nao e total zero e NAO diz 'nada a cobrar'", !absent.HasTotalCents && !pay(absent).Contains("SEM COBRANÇA"));
            var present0 = fromJson("{\"orderId\":\"a\",\"code\":\"1\",\"type\":\"BALCAO\",\"totalCents\":0,\"subtotalCents\":5000,\"discountCents\":5000," + itemsJson + "}");
            Check("totalCents: 0 ESCRITO pelo servidor com desconto = itens: diz 'SEM COBRANÇA' (b)", present0.HasTotalCents && pay(present0) == Z);
            // "totalCents": null explicito (parecer Nightingale, obs. 1): vale como AUSENTE, nao derruba a leitura e cai na regra normal
            var nullTotal = fromJson("{\"orderId\":\"n\",\"code\":\"1\",\"type\":\"BALCAO\",\"totalCents\":null,\"subtotalCents\":5000,\"discountCents\":5000," + itemsJson + "}");
            Check("\"totalCents\": null no JSON: le sem erro, vale como AUSENTE e NAO diz 'SEM COBRANÇA'", !nullTotal.HasTotalCents && !pay(nullTotal).Contains("SEM COBRANÇA"));
            var rtZero = fromJson(Newtonsoft.Json.JsonConvert.SerializeObject(ZeroTotal()));
            var rtUnset = fromJson(Newtonsoft.Json.JsonConvert.SerializeObject(new PrintableOrder { OrderId = "u", Code = "2", Type = "BALCAO" }));
            Check("ida e volta pelo JSON: total 0 escrito continua PRESENTE e o nao informado continua AUSENTE", rtZero.HasTotalCents && rtZero.TotalCents == 0 && !rtUnset.HasTotalCents && pay(rtZero) == Z);
            var partial = fromJson("{\"orderId\":\"a\",\"code\":\"1\",\"type\":\"BALCAO\",\"subtotalCents\":5000,\"discountCents\":100," + itemsJson + "}");
            Check("itens R$ 50, desconto R$ 1 e total ausente (chegaria como 0): NAO diz 'SEM COBRANÇA' (a)", !pay(partial).Contains("SEM COBRANÇA"));
            var partial0 = ZeroTotal(); partial0.DiscountCents = 100;
            Check("itens R$ 50, desconto R$ 1 e total 0: NAO diz 'SEM COBRANÇA' (a)", !pay(partial0).Contains("SEM COBRANÇA"));
            var over = ZeroTotal(); over.DiscountCents = 6000;
            Check("itens R$ 50, desconto R$ 60 (inconsistente, total 0): fluxo normal (c)", !pay(over).Contains("SEM COBRANÇA"));
            var feeOnly = ZeroTotal(); feeOnly.Type = "DELIVERY"; feeOnly.DeliveryFeeCents = 600;
            Check("total 0 mas taxa de entrega R$ 6,00 (cupom so cobre os itens): fluxo normal (d)", !pay(feeOnly).Contains("SEM COBRANÇA"));
            var tipOnly = ZeroTotal(); tipOnly.TipCents = 200;
            Check("total 0 mas gorjeta R$ 2,00: fluxo normal", !pay(tipOnly).Contains("SEM COBRANÇA"));
            var subDiverge = ZeroTotal(); subDiverge.SubtotalCents = 4000;
            Check("subtotal informado (R$ 40) NAO bate com a soma dos itens (R$ 50): fluxo normal", !pay(subDiverge).Contains("SEM COBRANÇA"));
            var noDiscount = ZeroTotal(); noDiscount.DiscountCents = null;
            Check("desconto AUSENTE com itens de valor e total 0: fluxo normal (sem prova nao e de graca)", !pay(noDiscount).Contains("SEM COBRANÇA"));
            var withAdds = ZeroTotal(); withAdds.Items[0].Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Bacon", PriceCents = 300 } };
            Check("adicionais entram no valor dos itens: desconto de R$ 50 nao cobre itens de R$ 56 (fluxo normal)", !pay(withAdds).Contains("SEM COBRANÇA"));
            withAdds.SubtotalCents = 5600; withAdds.DiscountCents = 5600;
            Check("adicionais entram no valor dos itens: desconto de R$ 56 cobre exatamente (diz 'SEM COBRANÇA')", pay(withAdds) == Z);

            // ---- aviso de cancelamento e TESTE nao passam pela linha de pagamento (vem da API com total 0 e SEM itens) ----
            foreach (var mm in new[] { 58, 80 })
            {
                var oldClock = TicketBuilder.Clock; TicketBuilder.Clock = () => new DateTime(2026, 11, 17, 15, 0, 0, DateTimeKind.Utc);
                try
                {
                    var cancelTxt = Txt(CancelFromApi(), mm);
                    Check("aviso de cancelamento da API (total 0, sem itens) em " + mm + " mm: layout proprio, SEM linha de pagamento", cancelTxt.Contains("CANCELADO") && !cancelTxt.Contains("SEM COBRANÇA") && !cancelTxt.Contains("COBRAR") && !cancelTxt.Contains("PIX"));
                    var testTxt = Txt(TestFromClient(), mm);
                    Check("tiquete de TESTE (total 0, sem itens) em " + mm + " mm: layout proprio, SEM linha de pagamento", testTxt.Contains("TESTE DE IMPRESSÃO") && !testTxt.Contains("SEM COBRANÇA") && !testTxt.Contains("COBRAR") && !testTxt.Contains("PIX"));
                }
                finally { TicketBuilder.Clock = oldClock; }
            }
            Check("so o tiquete de pedido sem itens e total 0 pede o aviso de log (aviso de cancelamento e teste NAO)", TicketBuilder.IsEmptyZeroTicket(new PrintableOrder { OrderId = "v", Code = "9", Type = "BALCAO", TotalCents = 0, Items = new List<PrintableOrderItem>() })
                && !TicketBuilder.IsEmptyZeroTicket(CancelFromApi()) && !TicketBuilder.IsEmptyZeroTicket(TestFromClient()) && !TicketBuilder.IsEmptyZeroTicket(ZeroTotal()));

            var empty = new PrintableOrder { OrderId = "e", Code = "1", Type = "BALCAO", TotalCents = 0, Items = new List<PrintableOrderItem>() };
            Check("pedido sem itens e total 0: 'SEM COBRANÇA' (nada a cobrar de fato)", pay(empty) == Z);
        }

        static void Writer()
        {
            foreach (var fixture in new[] { Basic(), CurrentContract(), LongAndHostile(), ManyItems(), Reprint(), Quantities() })
            {
                foreach (var mm in new[] { 58, 80 })
                {
                    int cols = TicketText.ColumnsFor(mm);
                    var lines = TextTicketWriter.Render(Build(fixture, mm), cols);
                    Check("colunas: " + fixture.Code + " em " + mm + " mm nunca passa de " + cols + " colunas", lines.All(l => TicketText.CellWidth(l) <= cols));
                }
            }
            var txt = TextTicketWriter.Render(Build(Basic()), 32);
            var itemLine = txt.First(l => l.StartsWith("2x Pizza Calabresa G"));
            Check("colunas: valor da linha colado na borda direita", itemLine.EndsWith("R$ 70,00") && TicketText.CellWidth(itemLine) == 32);
            Check("colunas: separador ocupa a largura toda", txt.Any(l => l == new string('-', 32)));
            Check("colunas: titulo centralizado", txt[0].TrimStart().StartsWith("Pizzaria") && txt[0].Length - txt[0].TrimStart().Length >= 7);
            Check("colunas: texto final sem espaco sobrando e com \\n", TextTicketWriter.RenderText(Build(Basic()), 32).Split('\n').All(l => l == l.TrimEnd()) && TextTicketWriter.RenderText(Build(Basic()), 32).EndsWith("\n"));

            // CA-B4-07: nome de produto longo em 58 mm quebra sem cortar o preco
            var longName = TextTicketWriter.Render(Build(LongAndHostile()), 32);
            Check("CA-B4-07: nome longo em 58 mm quebra em varias linhas e o preco da linha fica inteiro", longName.Any(l => l.EndsWith("R$ 86,70") && TicketText.CellWidth(l) <= 32)
                && longName.Count(l => l.Contains("Pastel") || l.Contains("Catupiry") || l.Contains("Cheese")) >= 3);
        }

        static void Golden()
        {
            var dir = Environment.GetEnvironmentVariable("PC_GOLDEN_DIR");
            bool update = Environment.GetEnvironmentVariable("PC_UPDATE_GOLDEN") == "1";
            if (string.IsNullOrEmpty(dir)) { Console.WriteLine("SKIP golden files (PC_GOLDEN_DIR nao definido; use run-selftest.ps1)"); return; }
            Directory.CreateDirectory(dir);
            var oldClock = TicketBuilder.Clock;
            TicketBuilder.Clock = () => new DateTime(2026, 11, 17, 15, 0, 0, DateTimeKind.Utc);   // hora fixa do tiquete de teste
            try {
            var fixtures = new Dictionary<string, PrintableOrder>
            {
                { "basico", Basic() }, { "contrato-atual", CurrentContract() }, { "longo-emoji-hostil", LongAndHostile() },
                { "muitos-itens", ManyItems() }, { "segunda-via", Reprint() }, { "quantidades", Quantities() }, { "cancelamento", CancelFixture() },
                { "total-zero", ZeroTotal() }, { "total-zero-segunda-via", ZeroTotalReprint() },
                { "cancelamento-da-api", CancelFromApi() }, { "teste-da-api", TestFromClient() },
                { "total-ausente", AbsentTotal() }, { "total-ausente-balcao", AbsentTotalCounter() },
            };
            foreach (var kv in fixtures)
            {
                foreach (var mm in new[] { 58, 80 })
                {
                    var name = "ticket-" + kv.Key + "-" + mm + "mm.txt";
                    var path = Path.Combine(dir, name);
                    var actual = Txt(kv.Value, mm);
                    if (update) { File.WriteAllText(path, actual, new UTF8Encoding(false)); Check("golden atualizado: " + name, true); continue; }
                    if (!File.Exists(path)) { Check("golden existe: " + name + " (gere com PC_UPDATE_GOLDEN=1 e revise)", false); continue; }
                    var expected = File.ReadAllText(path, Encoding.UTF8).Replace("\r\n", "\n");
                    Check("golden confere: " + name + (expected == actual ? "" : " | " + FirstDiff(expected, actual)), expected == actual);
                }
            }
            } finally { TicketBuilder.Clock = oldClock; }
        }

        static string FirstDiff(string expected, string actual)
        {
            var e = expected.Split('\n'); var a = actual.Split('\n');
            for (int i = 0; i < Math.Max(e.Length, a.Length); i++)
            {
                var le = i < e.Length ? e[i] : "<fim>"; var la = i < a.Length ? a[i] : "<fim>";
                if (le != la) return "linha " + (i + 1) + ": esperado [" + le + "] obtido [" + la + "]";
            }
            return "";
        }

        static void Probe()
        {
            Check("impressora: sem selecao => aviso claro", PrinterProbe.Check("") == "Nenhuma impressora selecionada." && PrinterProbe.Check(null) != null);
            Check("impressora: offline (WorkOffline, status 7 ou erro 9) => aviso", PrinterProbe.Describe(true, 3, 2) != null && PrinterProbe.Describe(false, 7, 2) != null && PrinterProbe.Describe(false, 3, 9) != null);
            Check("impressora: sem papel (erro 4) => aviso de papel", PrinterProbe.Describe(false, 3, 4).Contains("sem papel"));
            Check("impressora: tampa aberta, papel enroscado, manutencao e fila parada", PrinterProbe.Describe(false, 3, 7).Contains("tampa") && PrinterProbe.Describe(false, 3, 8).Contains("enroscado")
                && PrinterProbe.Describe(false, 3, 10).Contains("manutenção") && PrinterProbe.Describe(false, 6, 2).Contains("parada"));
            Check("impressora: ociosa/imprimindo sem erro => pode imprimir", PrinterProbe.Describe(false, 3, 2) == null && PrinterProbe.Describe(false, 4, 0) == null);
            Check("impressora: nome inexistente nao bloqueia (WMI sem resposta = desconhecido)", PrinterProbe.Check("__impressora_que_nao_existe__") == null);
        }

        static void Png()
        {
            var dir = Path.Combine(Path.GetTempPath(), "meucardapio_selftest_png_" + Guid.NewGuid().ToString("N"));
            try
            {
                var vp = new VirtualPrintTarget(dir, true);
                vp.Print(Build(Basic()));
                vp.Print(Build(ManyItems(), 80));
                var png58 = Directory.GetFiles(dir, "0001.png").FirstOrDefault();
                var png80 = Directory.GetFiles(dir, "0002.png").FirstOrDefault();
                Check("impressora virtual: grava .txt e .png de cada tiquete", png58 != null && png80 != null && File.Exists(Path.Combine(dir, "0001.txt")) && File.Exists(Path.Combine(dir, "0002.txt")));
                using (var a = new Bitmap(png58)) using (var b = new Bitmap(png80))
                {
                    Check("impressora virtual: PNG tem a largura da bobina a 203 dpi (58 mm = 464 px, 80 mm = 640 px)", Math.Abs(a.Width - 464) <= 1 && Math.Abs(b.Width - 640) <= 1);
                    Check("impressora virtual: PNG cresce com o conteudo (tiquete com 12 itens e mais alto)", b.Height > a.Height * 0.9 && a.Height > 150);
                    bool anyBlack = false;
                    for (int y = 0; y < a.Height && !anyBlack; y += 3)
                        for (int x = 0; x < a.Width && !anyBlack; x += 3)
                            if (a.GetPixel(x, y).R < 100) anyBlack = true;
                    Check("impressora virtual: PNG tem tinta (nao saiu em branco)", anyBlack);
                }
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }
    }
}
