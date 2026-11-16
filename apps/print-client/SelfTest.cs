using System;
using MeuCardapio.PrintClient.Printing;

namespace MeuCardapio.PrintClient
{
    // Teste de fumaça do pipeline de renderização: .exe --selftest
    static class SelfTest
    {
        internal static int Failures;

        internal static void Check(string label, bool cond)
        {
            Console.WriteLine((cond ? "PASS " : "FAIL ") + label);
            if (!cond) Failures++;
        }

        const string Html = @"
<div class='container'>
  <div class='header' style='center'>
    <span class='title'>Restaurante Exemplo LTDA</span><br/>
    <span class='min'>Rua A, 123 - S&#227;o Paulo</span><br/>
    <span class='min'>Pedido #1042 &middot; 12/07 20:31</span>
  </div>
  <div class='divider'></div>
  <p>
    <b>Burger Cl&aacute;ssico</b> <span class='right'>R$ 25,90</span><br/>
    <i>Obs: sem cebola</i><br/>
    <u>Frete</u> <span class='right'>R$ 5,00</span>
  </p>
  <div class='divider'></div>
  <p style='bold'><b>TOTAL</b> <span class='right'>R$ 30,90</span></p>
  <p>Primeira parte --QUEBRA-- segunda parte</p>
  <p class='footer' style='center bottom'>Obrigado! Volte sempre.</p>
</div>";

        public static int Run()
        {
            Failures = 0;
            var lines = new TicketRenderer().Build(Html);

            Console.WriteLine("LINES: " + lines.Count);
            foreach (var l in lines)
            {
                if (l.IsDivider) { Console.WriteLine("--- <divider> ---"); continue; }
                Console.WriteLine("[" + (l.Bold ? "B" : " ") + (l.Italic ? "I" : " ") + (l.Underline ? "U" : " ")
                    + "|" + l.Align.ToString()[0] + "x" + l.SizeFactor.ToString(System.Globalization.CultureInfo.InvariantCulture)
                    + (l.SpaceBefore > 0 ? "+" + l.SpaceBefore : "") + "] '" + l.Text + "'");
            }

            int divs = 0;
            TicketLine total = null, thanks = null, addr = null, obs = null, leftPart = null, rightPart = null, title = null;
            foreach (var l in lines)
            {
                if (l.IsDivider) { divs++; continue; }
                string t = l.Text.Trim();
                if (t.Length == 0) continue;
                if (t == "TOTAL") total = l;
                else if (t.StartsWith("Obrigado")) thanks = l;
                else if (t.StartsWith("Rua A")) addr = l;
                else if (t.StartsWith("Obs:")) obs = l;
                else if (t == "Primeira parte") leftPart = l;
                else if (t == "segunda parte") rightPart = l;
                else if (t.StartsWith("Restaurante")) title = l;
            }

            Check("2 divisores", divs == 2);
            Check("titulo bold+center+size>1", title != null && title.Bold && title.Align == LineAlign.Center && title.SizeFactor > 1f);
            Check("endereco min (size<1)+center", addr != null && addr.SizeFactor < 1f && addr.Align == LineAlign.Center);
            Check("obs italic", obs != null && obs.Italic);
            Check("TOTAL bold", total != null && total.Bold);
            Check("quebra --QUEBRA-- vira 2 linhas", leftPart != null && rightPart != null);
            Check("rodape center", thanks != null && thanks.Align == LineAlign.Center);
            bool mid = false;
            foreach (var l in lines) if (!l.IsDivider && l.Text.Contains("#1042") && l.Text.Contains("·")) mid = true;
            Check("entidade &middot; decodificada", mid);
            Check("PxToPt(96) == 72", Math.Abs(TicketRenderer.PxToPt(96f) - 72f) < 0.001f);
            Check("LARGURA 80 -> 80mm", TicketRenderer.ExtractLarguraMm("<div>LARGURA 80</div>").HasValue
                && Math.Abs(TicketRenderer.ExtractLarguraMm("<div>LARGURA 80</div>").Value - 80f) < 0.001f);
            Check("LARGURA:80,5 -> 80.5mm (virgula pt-BR)", Math.Abs((TicketRenderer.ExtractLarguraMm("<p>LARGURA:80,5</p>") ?? 0f) - 80.5f) < 0.001f);
            Check("LARGURA ausente -> null", TicketRenderer.ExtractLarguraMm(Html) == null);
            bool larguraVazou = false;
            foreach (var l in new TicketRenderer().Build("<html><body><p>LARGURA 80</p><p>Item X</p></body></html>"))
                if (l.Text.IndexOf("LARGURA", StringComparison.OrdinalIgnoreCase) >= 0) larguraVazou = true;
            Check("token LARGURA nao aparece como texto imprimivel", !larguraVazou);
            Check("HTML vazio -> 0 linhas", new TicketRenderer().Build("").Count == 0);
            Check("HTML null -> 0 linhas", new TicketRenderer().Build(null).Count == 0);

            // Gramática do nosso próprio template (TicketTemplate), não o HTML do cardapio.ai.
            var order = new MeuCardapio.PrintClient.Models.PrintableOrder
            {
                OrderId = "1", Code = "0007", Type = "BALCAO", StoreName = "Loja Teste",
                CustomerName = "Fulano", TotalCents = 3000, CreatedAt = "2026-11-15T00:00:00Z",
            };
            order.Items.Add(new MeuCardapio.PrintClient.Models.PrintableOrderItem { ProductName = "Cheeseburguer", Quantity = 2, UnitPriceCents = 1500 });
            var ownLines = new TicketRenderer().Build(MeuCardapio.PrintClient.Services.TicketTemplate.Build(order));
            bool hasTotal = false, hasItem = false;
            foreach (var l in ownLines)
            {
                if (l.Text.Contains("TOTAL") && l.Text.Contains("R$ 30,00") && l.Bold) hasTotal = true;
                if (l.Text.Contains("Cheeseburguer") && l.Text.Contains("2x")) hasItem = true;
            }
            Check("template proprio: TOTAL formatado", hasTotal);
            Check("template proprio: item com quantidade", hasItem);

            SelfTestDevice.Run();
            SelfTestUpdater.Run();
            SelfTestDeviceClient.Run();

            Console.WriteLine(Failures == 0 ? "ALL OK" : "FAILURES=" + Failures);
            return Failures == 0 ? 0 : 1;
        }
    }
}
