using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Text;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace MeuCardapio.PrintClient.Printing
{
    public enum LineAlign { Left, Center, Right }

    // Uma linha desenhável do tíquete (resultado do parse do HTML)
    public class TicketLine
    {
        public string Text = "";
        public bool Bold;
        public bool Italic;
        public bool Underline;
        public float SizeFactor = 1f;          // "title" = 1.5, "min" = 0.8
        public LineAlign Align = LineAlign.Left;
        public int SpaceBefore;                // em px
        public bool IsDivider;                  // linha pontilhada (class="divider")
    }

    // Renderiza o subconjunto HTML do tíquete (mesma gramática suportada pelo original):
    // <b><i><u><p><br><div class="divider"><span/div style="bold|italic|underline|center|right|bottom|title|min|line-height:..">
    public class TicketRenderer
    {
        static readonly Regex StyleTokens = new Regex("(bold|italic|underline|center|right|bottom|title|min|place-content\\s*:\\s*\\w+)", RegexOptions.Compiled);

        // Comando embutido do original (string 0x70001c44 no #US): "LARGURA" + valor em mm,
        // ex.: <div>LARGURA 80</div>. O original faz embeddedCommands.TryGetValue("LARGURA")
        // + Single.TryParse e converte mm->pt (w * 100 / 25.4) como pageWidth.
        static readonly Regex LarguraToken = new Regex(@"LARGURA\s*[:=]?\s*(\d+(?:[.,]\d+)?)", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public List<TicketLine> Build(string html)
        {
            var lines = new List<TicketLine>();
                if (string.IsNullOrWhiteSpace(html)) return lines;

                // comando embutido LARGURA <mm> é metadado da bobina, não texto imprimível
                html = LarguraToken.Replace(html, string.Empty);

                var doc = new HtmlAgilityPack.HtmlDocument();
                doc.LoadHtml(html);
                var root = doc.DocumentNode;

                foreach (var node in root.ChildNodes)
                    ProcessNode(node, lines, false, false, false, 1f, LineAlign.Left);

                // colapsa linhas em branco consecutivas (tags aninhadas somam espaços)
                {
                    var cleaned = new List<TicketLine>();
                    foreach (var l in lines)
                    {
                        bool blank = !l.IsDivider && l.Text != "\n" && string.IsNullOrEmpty(l.Text);
                        if (blank && cleaned.Count > 0)
                        {
                            var prev = cleaned[cleaned.Count - 1];
                            if (!prev.IsDivider && prev.Text != "\n" && string.IsNullOrEmpty(prev.Text)) continue;
                        }
                        cleaned.Add(l);
                    }
                    lines.Clear();
                    lines.AddRange(cleaned);
                }

            // junta runs inline divididos por tags na mesma linha (<b>Data:</b>  -  → "Data: -");
            // pula uma linha vazia só quando o estilo bate (divs flex separam <p>s com linha em branco)
            for (int i = 0; i + 1 < lines.Count; i++)
            {
                var a = lines[i]; var b = lines[i + 1];
                int j = i + 1;
                if (!b.IsDivider && string.IsNullOrEmpty(b.Text) && b.SpaceBefore == 0 && i + 2 < lines.Count)
                    j = i + 2;
                var c = lines[j];
                if (a.IsDivider || c.IsDivider) continue;
                if (string.IsNullOrEmpty(a.Text) || string.IsNullOrEmpty(c.Text)) continue;
                if (a.SpaceBefore != 0 || c.SpaceBefore != 0) continue;
                bool sameSize = Math.Abs(a.SizeFactor - c.SizeFactor) < 0.0001f;
                bool sameStyle = sameSize && a.Align == c.Align
                    && a.Bold == c.Bold && a.Italic == c.Italic && a.Underline == c.Underline;
                bool prefix = !sameStyle && sameSize && a.Align == c.Align && a.Text.EndsWith(":");
                if (sameStyle || prefix)
                {
                    a.Text = a.Text + " " + c.Text;
                    lines.RemoveRange(i + 1, j - i);
                }
            }

            // palavra-chave de quebra de página encontrada nas strings do binário
            for (int i = 0; i < lines.Count; i++)
            {
                var parts = lines[i].Text.Split(new[] { "--QUEBRA--" }, StringSplitOptions.None);
                if (parts.Length > 1)
                {
                    var insert = new List<TicketLine>();
                    for (int p = 0; p < parts.Length; p++)
                    {
                        if (p > 0) insert.Add(new TicketLine { Text = "\n" });
                        var clone = lines[i];
                        clone = new TicketLine { Text = parts[p], Bold = clone.Bold, Italic = clone.Italic,
                            Underline = clone.Underline, SizeFactor = clone.SizeFactor, Align = clone.Align };
                        insert.Add(clone);
                    }
                    lines.RemoveRange(i, 1);
                    lines.InsertRange(i, insert);
                    i += insert.Count - 1;
                }
            }
            return lines;
        }

        void ProcessNode(HtmlAgilityPack.HtmlNode node, List<TicketLine> outLines, bool bold, bool italic, bool underline, float size, LineAlign align)
        {
            if (node.NodeType == HtmlAgilityPack.HtmlNodeType.Text)
            {
                // HAP não decifica entidades nomeadas (&middot;, &aacute; ...) por padrão
                string t = HtmlAgilityPack.HtmlEntity.DeEntitize(node.InnerText).Trim();
                if (t.Length > 0)
                    outLines.Add(new TicketLine { Text = t, Bold = bold, Italic = italic, Underline = underline, SizeFactor = size, Align = align });
                return;
            }

            if (node.NodeType != HtmlAgilityPack.HtmlNodeType.Element) return;

            switch (node.Name.ToLowerInvariant())
            {
                case "br":
                    outLines.Add(new TicketLine { Text = "", Align = align });
                    break;
                case "hr":
                    outLines.Add(new TicketLine { IsDivider = true });
                    break;
                case "style": case "script": case "noscript":
                    return;
                case "b": case "strong":
                    foreach (var c in node.ChildNodes) ProcessNode(c, outLines, true, italic, underline, size, align);
                    break;
                case "i": case "em":
                    foreach (var c in node.ChildNodes) ProcessNode(c, outLines, bold, true, underline, size, align);
                    break;
                case "u":
                    foreach (var c in node.ChildNodes) ProcessNode(c, outLines, bold, italic, true, size, align);
                    break;
                case "p":
                {
                    bool b = bold, it = italic, u = underline;
                    float sz = size;
                    LineAlign al = align;
                    int spaceBefore = 0;
                    ParseStyleAttrs(node, ref b, ref it, ref u, ref sz, ref al, ref spaceBefore);
                    foreach (var c in node.ChildNodes) ProcessNode(c, outLines, b, it, u, sz, al);
                    outLines.Add(new TicketLine { Text = "", Align = al, SpaceBefore = spaceBefore });
                    break;
                }
                case "div":
                case "span":
                case "section":
                case "header":
                case "footer":
                {
                    string cls = node.Attributes["class"]?.Value ?? "";
                    bool isDivider = cls.IndexOf("divider", System.StringComparison.OrdinalIgnoreCase) >= 0;
                    if (!isDivider)
                        foreach (var t in cls.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                            if (t.Equals("line", System.StringComparison.OrdinalIgnoreCase) ||
                                t.Equals("break", System.StringComparison.OrdinalIgnoreCase))
                            { isDivider = true; break; }
                    if (isDivider)
                    {
                        outLines.Add(new TicketLine { IsDivider = true });
                        break;
                    }

                    bool b = bold, it = italic, u = underline;
                    float sz = size;
                    LineAlign al = align;
                    int spaceBefore = 0;
                    ParseStyleAttrs(node, ref b, ref it, ref u, ref sz, ref al, ref spaceBefore);

                    foreach (var c in node.ChildNodes)
                        ProcessNode(c, outLines, b, it, u, sz, al);
                    if (!string.IsNullOrEmpty(cls) && cls.IndexOf("flex", System.StringComparison.OrdinalIgnoreCase) < 0)
                        outLines.Add(new TicketLine { Text = "", Align = align, SpaceBefore = spaceBefore });
                    break;
                }
                default:
                    foreach (var c in node.ChildNodes) ProcessNode(c, outLines, bold, italic, underline, size, align);
                    break;
            }
        }

        // Aplica os atributos de estilo do nó: classe (palavras exatas: title|min|center|...) e style (tokens CSS)
        void ParseStyleAttrs(HtmlAgilityPack.HtmlNode node, ref bool b, ref bool it, ref bool u, ref float sz, ref LineAlign al, ref int spaceBefore)
        {
            string cls = node.Attributes["class"]?.Value ?? "";
            string style = node.Attributes["style"]?.Value ?? "";

            foreach (var tok in cls.Split(new[] { ' ', '-', '.', '_' }, StringSplitOptions.RemoveEmptyEntries))
            {
                switch (tok.ToLowerInvariant())
                {
                    case "bold": b = true; break;
                    case "italic": it = true; break;
                    case "underline": u = true; break;
                    case "center": al = LineAlign.Center; break;
                    case "right": al = LineAlign.Right; break;
                    case "left": al = LineAlign.Left; break;
                    case "bottom": spaceBefore += 4; break;
                    case "title": sz *= 1.5f; b = true; break;
                    case "min": sz *= 0.8f; break;
                }
            }

            var alig = Regex.Match(style, "text-align\\s*:\\s*(center|right|left)");
            if (alig.Success)
                al = alig.Groups[1].Value == "center" ? LineAlign.Center : alig.Groups[1].Value == "right" ? LineAlign.Right : LineAlign.Left;

            var mt = Regex.Match(style, "margin-top\\s*:\\s*([\\d.]+)\\s*px");
            if (mt.Success) spaceBefore += (int)(float.Parse(mt.Groups[1].Value, CultureInfo.InvariantCulture));

            foreach (Match m in StyleTokens.Matches(style))
            {
                switch (m.Value.Split(':')[0].Trim())
                {
                    case "bold": b = true; break;
                    case "italic": it = true; break;
                    case "underline": u = true; break;
                    case "center": al = LineAlign.Center; break;
                    case "right": al = LineAlign.Right; break;
                    case "bottom": spaceBefore += 4; break;
                    case "title": sz *= 1.5f; b = true; break;
                    case "min": sz *= 0.8f; break;
                }
            }
        }

        // Converte px→pt como no método ConvertPxToPt do original
        public static float PxToPt(float px) => px * 72f / 96f;

        // Extrai a largura da bobina em mm do comando embutido LARGURA (null se ausente)
        public static float? ExtractLarguraMm(string html)
        {
            if (string.IsNullOrEmpty(html)) return null;
            var m = LarguraToken.Match(html);
            if (!m.Success) return null;
            float v;
            if (float.TryParse(m.Groups[1].Value.Replace(",", "."), NumberStyles.Float, CultureInfo.InvariantCulture, out v) && v > 0f)
                return v;
            return null;
        }
    }
}
