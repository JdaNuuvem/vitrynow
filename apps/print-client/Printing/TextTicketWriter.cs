using System;
using System.Collections.Generic;
using System.Text;

namespace MeuCardapio.PrintClient.Printing
{
    // Desenha o TicketDocument como texto em colunas fixas (32 = bobina de 58 mm, 48 = 80 mm).
    // Serve a três usos: arquivo da impressora virtual, "golden files" do tíquete e, mais tarde, a base do
    // modo ESC/POS (ARC-11). Estilo (negrito, escala) não aparece no texto; é conferido no modelo.
    public static class TextTicketWriter
    {
        public static List<string> Render(TicketDocument doc, int columns)
        {
            var output = new List<string>();
            foreach (var line in doc.Lines)
            {
                if (line.Divider) { output.Add(new string('-', columns)); continue; }
                if (line.IsBlank) { output.Add(""); continue; }

                if (line.RightText.Length > 0)
                {
                    int rightW = TicketText.CellWidth(line.RightText);
                    int leftMax = Math.Max(4, columns - rightW - 1);
                    var parts = TicketText.Wrap(line.Text, leftMax, TicketText.CellWidthF);
                    for (int i = 0; i < parts.Count; i++)
                    {
                        if (i == parts.Count - 1)
                        {
                            // preço na última linha do item (alinha com a coluna da direita)
                            int gap = Math.Max(1, columns - TicketText.CellWidth(parts[i]) - rightW);
                            output.Add(parts[i] + new string(' ', gap) + line.RightText);
                        }
                        else output.Add(parts[i]);
                    }
                    continue;
                }

                foreach (var part in TicketText.Wrap(line.Text, columns, TicketText.CellWidthF))
                    output.Add(Align(part, line.Align, columns));
            }
            return output;
        }

        // Texto final do arquivo: linhas sem espaço sobrando à direita, terminadas em \n.
        public static string RenderText(TicketDocument doc, int columns)
        {
            var sb = new StringBuilder();
            foreach (var l in Render(doc, columns)) sb.Append(l.TrimEnd()).Append('\n');
            return sb.ToString();
        }

        static string Align(string text, TicketAlign align, int columns)
        {
            int w = TicketText.CellWidth(text);
            if (w >= columns) return text;
            if (align == TicketAlign.Center) return new string(' ', (columns - w) / 2) + text;
            if (align == TicketAlign.Right) return new string(' ', columns - w) + text;
            return text;
        }
    }
}
