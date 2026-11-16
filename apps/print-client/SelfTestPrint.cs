using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;

namespace MeuCardapio.PrintClient
{
    // Tiquete (PC-12/QA-06): modelo proprio, quebra de linha, sanitizacao e golden files em 58 e 80 mm.
    // Golden files ficam em tests\golden\ (run-selftest.ps1 passa PC_GOLDEN_DIR). Para regenerar depois de uma
    // mudanca INTENCIONAL de layout: $env:PC_UPDATE_GOLDEN = "1"; .\run-selftest.ps1 e REVISE o diff no git.
    static class SelfTestPrint
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        // Dados de exemplo (ficticios) para os golden files.
        internal static PrintableOrder Basic()
        {
            return new PrintableOrder
            {
                OrderId = "ord-1042", Code = "1042", Type = "DELIVERY", StoreName = "Pizzaria do Zé",
                CustomerName = "Maria da Silva", CustomerPhone = "(11) 91234-5678",
                Address = "Rua das Flores, 123, apto 45 - Jardim Paulista, São Paulo",
                Notes = "Tocar o interfone", TotalCents = 8650, CreatedAt = "16/11/2026 20:31",
                Items = new List<PrintableOrderItem>
                {
                    new PrintableOrderItem { ProductName = "Pizza Calabresa G", Quantity = 2, UnitPriceCents = 3500, Notes = "sem cebola",
                        Additionals = new List<PrintableOrderAdditional> { new PrintableOrderAdditional { Name = "Borda catupiry", PriceCents = 800 } } },
                    new PrintableOrderItem { ProductName = "Refrigerante 2L", Quantity = 1, UnitPriceCents = 850 },
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
                TotalCents = 12480, CreatedAt = "16/11/2026 21:05",
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
            string[] names = { "X-Burger", "X-Salada", "X-Bacon", "Batata M", "Batata G", "Onion rings", "Coca 350", "Guaraná 350", "Suco laranja", "Água s/ gás", "Brownie", "Sorvete 2 bolas" };
            for (int i = 0; i < names.Length; i++)
                items.Add(new PrintableOrderItem { ProductName = names[i], Quantity = (i % 3) + 1, UnitPriceCents = 590 + i * 130 });
            return new PrintableOrder { OrderId = "ord-3001", Code = "3001", Type = "BALCAO", StoreName = "Lanches 24h", CustomerName = "Cliente balcão", TotalCents = 20990, CreatedAt = "17/11/2026 00:12", Items = items };
        }

        public static void Run()
        {
            Sanitize();
            Wrapping();
            Builder();
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
            var combining = TicketText.Wrap("ééé", 2, TicketText.CellWidthF);
            Check("quebra: acento combinado fica com a letra", combining.All(l => !l.StartsWith("́")) && string.Concat(combining) == "ééé");
            Check("quebra: recuo inicial vale para todas as linhas do trecho", string.Join("|", TicketText.Wrap("  + bacon crocante extra", 12, len)) == "  + bacon|  crocante|  extra");
            Check("largura: acento vale 1 coluna e emoji vale 2", TicketText.CellWidth("ação") == 4 && TicketText.CellWidth("🍕") == 2);
            Check("colunas por bobina: 58 mm = 32, 57 mm = 32, 80 mm = 48", TicketText.ColumnsFor(58) == 32 && TicketText.ColumnsFor(57) == 32 && TicketText.ColumnsFor(80) == 48);
        }

        static void Builder()
        {
            var d = TicketBuilder.Build(Basic(), 58);
            var title = d.Lines[0];
            Check("tiquete: titulo da loja centralizado, negrito e maior", title.Text == "Pizzaria do Zé" && title.Align == TicketAlign.Center && title.Bold && title.Scale > 1f);
            Check("tiquete: pedido e tipo traduzido (DELIVERY => ENTREGA)", d.Lines.Any(l => l.Text == "Pedido #1042 - ENTREGA"));
            var total = d.Lines.First(l => l.Text == "TOTAL");
            Check("tiquete: TOTAL em negrito com valor na direita", total.Bold && total.RightText == "R$ 86,50");
            Check("tiquete: item com quantidade e preco unitario na direita", d.Lines.Any(l => l.Text == "2x Pizza Calabresa G" && l.RightText == "R$ 35,00"));
            Check("tiquete: adicional recuado e menor", d.Lines.Any(l => l.Text == "  + Borda catupiry" && l.RightText == "R$ 8,00" && l.Scale < 1f));
            Check("tiquete: observacao do item em italico", d.Lines.Any(l => l.Text == "  obs: sem cebola" && l.Italic));
            Check("tiquete: separadores presentes", d.Lines.Count(l => l.Divider) == 2);
            Check("tiquete: cliente, telefone, endereco e observacao do pedido", d.Lines.Any(l => l.Text.StartsWith("Cliente: Maria")) && d.Lines.Any(l => l.Text.StartsWith("Telefone:"))
                && d.Lines.Any(l => l.Text.StartsWith("Endereço:")) && d.Lines.Any(l => l.Text == "Obs: Tocar o interfone" && l.Bold));
            Check("tiquete: rodape com a data, centralizado", d.Lines.Last().Text == "16/11/2026 20:31" && d.Lines.Last().Align == TicketAlign.Center);
            Check("tiquete: PaperMm segue o pedido de montagem", TicketBuilder.Build(Basic(), 80).PaperMm == 80);

            var h = TicketBuilder.Build(LongAndHostile(), 58);
            bool clean = h.Lines.All(l => l.Text.All(c => c >= ' ' && c != '\u007f') && l.RightText.All(c => c >= ' ' && c != '\u007f'));
            Check("tiquete hostil: nenhum caractere de controle chega ao modelo", clean);
            var notes = h.Lines.First(l => l.Text.StartsWith("Obs:")).Text;
            Check("tiquete hostil: texto do cliente vira texto (ESC/GS removidos, linhas unidas)", notes == "Obs: Sem pimenta@ V por favor segunda linha com tab evil");
            Check("tiquete: pedido nulo / sem itens nao estoura", TicketBuilder.Build(null, 58).Lines.Count == 0
                && TicketBuilder.Build(new PrintableOrder { Code = "1", StoreName = "x", Items = null }, 58).Lines.Count > 0);
            Check("dinheiro: centavos, zero e negativo", TicketBuilder.Money(0) == "R$ 0,00" && TicketBuilder.Money(5) == "R$ 0,05"
                && TicketBuilder.Money(123456) == "R$ 1234,56" && TicketBuilder.Money(-250) == "-R$ 2,50");
        }

        static void Writer()
        {
            foreach (var fixture in new[] { Basic(), LongAndHostile(), ManyItems() })
            {
                foreach (var mm in new[] { 58, 80 })
                {
                    int cols = TicketText.ColumnsFor(mm);
                    var lines = TextTicketWriter.Render(TicketBuilder.Build(fixture, mm), cols);
                    Check("colunas: " + fixture.Code + " em " + mm + " mm nunca passa de " + cols + " colunas", lines.All(l => TicketText.CellWidth(l) <= cols));
                }
            }
            var doc = TicketBuilder.Build(Basic(), 58);
            var txt = TextTicketWriter.Render(doc, 32);
            var itemLine = txt.First(l => l.StartsWith("2x Pizza Calabresa G"));
            Check("colunas: preco do item colado na borda direita", itemLine.EndsWith("R$ 35,00") && TicketText.CellWidth(itemLine) == 32);
            Check("colunas: separador ocupa a largura toda", txt.Any(l => l == new string('-', 32)));
            Check("colunas: titulo centralizado", txt[0].TrimStart().StartsWith("Pizzaria") && txt[0].Length - txt[0].TrimStart().Length >= 7);
            Check("colunas: texto final sem espaco sobrando e com \\n", TextTicketWriter.RenderText(doc, 32).Split('\n').All(l => l == l.TrimEnd()) && TextTicketWriter.RenderText(doc, 32).EndsWith("\n"));
        }

        static void Golden()
        {
            var dir = Environment.GetEnvironmentVariable("PC_GOLDEN_DIR");
            bool update = Environment.GetEnvironmentVariable("PC_UPDATE_GOLDEN") == "1";
            if (string.IsNullOrEmpty(dir)) { Console.WriteLine("SKIP golden files (PC_GOLDEN_DIR nao definido; use run-selftest.ps1)"); return; }
            Directory.CreateDirectory(dir);
            var fixtures = new Dictionary<string, PrintableOrder> { { "basico", Basic() }, { "longo-emoji-hostil", LongAndHostile() }, { "muitos-itens", ManyItems() } };
            foreach (var kv in fixtures)
            {
                foreach (var mm in new[] { 58, 80 })
                {
                    var name = "ticket-" + kv.Key + "-" + mm + "mm.txt";
                    var path = Path.Combine(dir, name);
                    var actual = TextTicketWriter.RenderText(TicketBuilder.Build(kv.Value, mm), TicketText.ColumnsFor(mm));
                    if (update) { File.WriteAllText(path, actual, new UTF8Encoding(false)); Check("golden atualizado: " + name, true); continue; }
                    if (!File.Exists(path)) { Check("golden existe: " + name + " (gere com PC_UPDATE_GOLDEN=1 e revise)", false); continue; }
                    var expected = File.ReadAllText(path, Encoding.UTF8).Replace("\r\n", "\n");
                    Check("golden confere: " + name + (expected == actual ? "" : " | " + FirstDiff(expected, actual)), expected == actual);
                }
            }
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
                vp.Print(TicketBuilder.Build(Basic(), 58));
                vp.Print(TicketBuilder.Build(ManyItems(), 80));
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
