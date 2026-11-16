using System;
using System.Drawing;
using System.Drawing.Printing;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient.Printing
{
    // Printer.PrintText do original: PrintDocument GDI+ sobre bobina térmica
    public class ThermalPrinter : IDisposable
    {
        const int Dpi = 96;
        static readonly FontFamily[] Preferred =
        {
            new FontFamily("Arial Narrow"), new FontFamily("Arial"), new FontFamily("Courier New")
        };

        public int PageSizeMm { get; set; } = 57;   // largura da bobina em mm
        public int FontPoints { get; set; } = 12;

        readonly PrinterSettings _settings = new PrinterSettings();

        public ThermalPrinter()
        {
            try
            {
                _settings.DefaultPageSettings.PaperSize = new PaperSize("termica",
                    (int)(PageSizeMm / 25.4f * Dpi), (int)(300 / 25.4f * Dpi));
            }
            catch { }
        }

        public void SelectPrinter(int index)
        {
            var list = PrinterSettings.InstalledPrinters;
            if (index >= 0 && index < list.Count) _settings.PrinterName = list[index];
        }

        public void PrintTicket(string html)
        {
            var renderer = new TicketRenderer();

            // Comando embutido LARGURA <mm> no HTML do tíquete: o original converte
            // mm->pt (w * 100 / 25.4) e redefine a largura da página (pageWidth).
            float? larguraMm = TicketRenderer.ExtractLarguraMm(html);
            if (larguraMm.HasValue && larguraMm.Value >= 30f && larguraMm.Value <= 200f)
            {
                PageSizeMm = (int)Math.Round(larguraMm.Value);
                _settings.DefaultPageSettings.PaperSize = new PaperSize("termica",
                    (int)(PageSizeMm / 25.4f * Dpi), (int)(300 / 25.4f * Dpi));
            }

            var lines = renderer.Build(html);
            PrintLines(lines);
        }

        void PrintLines(System.Collections.Generic.List<TicketLine> lines)
        {
            var doc = new PrintDocument();
            doc.PrinterSettings = _settings;
            doc.DocumentName = "Tiquete";

            var state = new PageState { Lines = lines };

            doc.PrintPage += (s, e) =>
            {
                float margin = 4f;
                float width = e.MarginBounds.Width;
                float bottom = e.MarginBounds.Bottom - margin;
                float y = e.MarginBounds.Top + margin;
                int i = state.Index;

                for (; i < state.Lines.Count; i++)
                {
                    var line = state.Lines[i];
                    float sizePt = Math.Max(6f, FontPoints * line.SizeFactor);

                    var style = FontStyle.Regular;
                    if (line.Bold) style |= FontStyle.Bold;
                    if (line.Italic) style |= FontStyle.Italic;
                    if (line.Underline) style |= FontStyle.Underline;
                    var font = new Font(Preferred[0], sizePt, style, GraphicsUnit.Point);
                    float h = font.Height + line.SpaceBefore;

                    if (line.IsDivider)
                    {
                        if (y + h > bottom) { e.HasMorePages = true; return; }
                        DrawDivider(e.Graphics, margin, y, width);
                        y += h;
                        continue;
                    }

                    if (line.Text == "\n")
                    {
                        if (y + h > bottom) { e.HasMorePages = true; return; }
                        y += h;
                        continue;
                    }

                    if (string.IsNullOrWhiteSpace(line.Text))
                    {
                        y += Math.Max(1f, line.SpaceBefore);
                        continue;
                    }

                    // word-wrap manual (DrawStringWrap)
                    var chunks = Wrap(e.Graphics, font, line.Text, width, line.Align);
                    foreach (var chunk in chunks)
                    {
                        if (y + h > bottom) { e.HasMorePages = true; return; }

                        string t = chunk.Text;
                        float x = margin;
                        var sf = new StringFormat { LineAlignment = StringAlignment.Near };
                        float w = e.Graphics.MeasureString(t, font, int.MaxValue, sf).Width;
                        if (chunk.Align == LineAlign.Center) x += (width - w) / 2f;
                        else if (chunk.Align == LineAlign.Right) x += width - w;
                        e.Graphics.DrawString(t, font, Brushes.Black, x, y, sf);
                        y += chunk.H;
                    }
                }
                state.Index = i;
            };

            doc.Print();
            doc.Dispose();
        }

        struct Chunk { public string Text; public LineAlign Align; public float H; }

        class PageState
        {
            public System.Collections.Generic.List<TicketLine> Lines;
            public int Index;
        }

        System.Collections.Generic.List<Chunk> Wrap(Graphics g, Font f, string text, float width, LineAlign align)
        {
            var result = new System.Collections.Generic.List<Chunk>();
            if (text == null || text.Length == 0)
            {
                result.Add(new Chunk { Text = "", Align = align, H = f.Height });
                return result;
            }
            string[] words = text.Split(' ');
            var sb = new System.Text.StringBuilder();
            foreach (var word in words)
            {
                string candidate = sb.Length == 0 ? word : sb + " " + word;
                if (g.MeasureString(candidate, f, int.MaxValue).Width <= width || sb.Length == 0)
                    sb = new System.Text.StringBuilder(candidate);
                else
                {
                    result.Add(new Chunk { Text = sb.ToString(), Align = align, H = f.Height });
                    sb = new System.Text.StringBuilder(word);
                }
            }
            if (sb.Length > 0) result.Add(new Chunk { Text = sb.ToString(), Align = align, H = f.Height });
            return result;
        }

        void DrawDivider(Graphics g, float x, float y, float width)
        {
            using (var pen = new Pen(Brushes.Black, 1f) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dash })
                g.DrawLine(pen, x, y + 4, x + width, y + 4);
        }

        public void Dispose() { /* PrinterSettings sem handle próprio */ }
    }
}
