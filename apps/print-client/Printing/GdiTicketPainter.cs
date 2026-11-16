using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;

namespace MeuCardapio.PrintClient.Printing
{
    // Mede e desenha o TicketDocument com GDI+. As MESMAS rotinas servem à impressora Windows
    // (GdiPrintTarget) e ao PNG da impressora virtual: o que a imagem mostra é o que sai no papel.
    // Unidade de layout: centésimos de polegada (a mesma de PrintDocument); fonte em pontos.
    public static class GdiTicketPainter
    {
        public const float Margin = 4f;
        static readonly string[] Preferred = { "Arial Narrow", "Arial", "Segoe UI", "Tahoma" };
        static FontFamily _family;

        static FontFamily Family()
        {
            if (_family != null) return _family;
            var installed = new HashSet<string>(FontFamily.Families.Select(f => f.Name), StringComparer.OrdinalIgnoreCase);
            foreach (var name in Preferred)
                if (installed.Contains(name)) return _family = new FontFamily(name);
            return _family = FontFamily.GenericSansSerif;
        }

        // Graphics só para medir, em centésimos de polegada.
        public static Graphics NewMeasureGraphics(out Bitmap backing)
        {
            backing = new Bitmap(1, 1);
            var g = Graphics.FromImage(backing);
            g.PageUnit = GraphicsUnit.Inch;
            g.PageScale = 0.01f;
            return g;
        }

        // Percorre as linhas a partir de `from` até acabar o documento ou a altura `maxHeight`. Com draw=true
        // desenha em `g` a partir de y=0. Devolve o índice da próxima linha lógica (== Count se terminou) e,
        // em `used`, a altura ocupada. Uma linha lógica não é partida entre páginas.
        public static int Layout(Graphics g, IList<TicketLine> lines, int from, float width, float maxHeight, float basePt, bool draw, out float used)
        {
            float inner = width - 2 * Margin;
            float y = Margin;
            int i = from;
            using (var sf = new StringFormat(StringFormat.GenericTypographic))
            {
                sf.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;
                for (; i < lines.Count; i++)
                {
                    var line = lines[i];
                    var style = (line.Bold ? FontStyle.Bold : FontStyle.Regular) | (line.Italic ? FontStyle.Italic : FontStyle.Regular);
                    using (var font = new Font(Family(), Math.Max(6f, basePt * line.Scale), style, GraphicsUnit.Point))
                    {
                        float lh = font.GetHeight(g);
                        if (line.Divider || line.IsBlank)
                        {
                            float h = line.Divider ? lh * 0.8f : lh * 0.6f;
                            if (y + h > maxHeight && y > Margin) break;
                            if (draw && line.Divider)
                                using (var pen = new Pen(Color.Black, 0.8f) { DashStyle = DashStyle.Dash })
                                    g.DrawLine(pen, Margin, y + h / 2f, Margin + inner, y + h / 2f);
                            y += h;
                            continue;
                        }

                        Func<string, float> measure = s => g.MeasureString(s, font, PointF.Empty, sf).Width;
                        float rightW = line.RightText.Length > 0 ? measure(line.RightText) : 0f;
                        float avail = line.RightText.Length > 0 ? Math.Max(inner * 0.3f, inner - rightW - measure("  ")) : inner;
                        var parts = TicketText.Wrap(line.Text, avail, measure);
                        float total = parts.Count * lh;
                        if (y + total > maxHeight && y > Margin) break;

                        for (int p = 0; p < parts.Count; p++)
                        {
                            float x = Margin;
                            float w = measure(parts[p]);
                            if (line.Align == TicketAlign.Center) x += (inner - w) / 2f;
                            else if (line.Align == TicketAlign.Right) x += inner - w;
                            if (draw)
                            {
                                g.DrawString(parts[p], font, Brushes.Black, x, y, sf);
                                if (p == parts.Count - 1 && line.RightText.Length > 0)
                                    g.DrawString(line.RightText, font, Brushes.Black, Margin + inner - rightW, y, sf);
                            }
                            y += lh;
                        }
                    }
                }
            }
            used = y + Margin;
            return i;
        }
    }
}
