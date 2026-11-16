using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;

namespace MeuCardapio.PrintClient.Printing
{
    public enum VirtualFault { None, Offline, OutOfPaper, DropMidJob }

    // Impressora VIRTUAL (QA-06/PC-12): em vez de papel, grava cada tíquete numa pasta como .txt (colunas, o
    // mesmo texto dos golden files) e, opcionalmente, .png (o mesmo desenho do GDI+ da impressora real).
    // Permite simular falhas: offline, sem papel e queda no meio do trabalho (deixa um "-parcial.txt" como
    // o papel cortado deixaria). Serve ao harness de testes e, com a opção de configuração, para conferir o
    // tíquete na tela sem gastar bobina.
    public sealed class VirtualPrintTarget : IPrintTarget
    {
        readonly string _dir;
        readonly bool _png;
        readonly object _lock = new object();
        int _seq;

        public VirtualFault Fault { get; set; }
        public int DropAfterLines { get; set; } = 6;
        public readonly List<string> Printed = new List<string>();   // arquivos .txt completos
        public readonly List<string> Partials = new List<string>();  // arquivos .txt parciais (queda no meio)
        public int FontPoints { get; set; } = 10;
        // Impressora lenta (teste de concorrencia): demora DelayMs dentro de Print.
        public int DelayMs { get; set; }

        public VirtualPrintTarget(string directory, bool writePng = false)
        {
            _dir = directory; _png = writePng;
            Directory.CreateDirectory(directory);
        }

        public void Print(TicketDocument document)
        {
            lock (_lock)
            {
                if (DelayMs > 0) System.Threading.Thread.Sleep(DelayMs);
                if (Fault == VirtualFault.Offline) throw new PrinterUnavailableException("A impressora está offline (simulado).");
                if (Fault == VirtualFault.OutOfPaper) throw new PrinterUnavailableException("A impressora está sem papel (simulado).");

                int cols = TicketText.ColumnsFor(document.PaperMm);
                var lines = TextTicketWriter.Render(document, cols);
                int n = ++_seq;
                var baseName = Path.Combine(_dir, n.ToString("0000", CultureInfo.InvariantCulture));

                if (Fault == VirtualFault.DropMidJob)
                {
                    var partial = baseName + "-parcial.txt";
                    var head = lines.GetRange(0, Math.Min(DropAfterLines, lines.Count));
                    File.WriteAllText(partial, string.Join("\n", head) + "\n", new UTF8Encoding(false));
                    Partials.Add(partial);
                    throw new PrinterUnavailableException("A conexão com a impressora caiu no meio do tíquete (simulado).");
                }

                var path = baseName + ".txt";
                File.WriteAllText(path, TextTicketWriter.RenderText(document, cols), new UTF8Encoding(false));
                if (_png) WritePng(document, baseName + ".png");
                Printed.Add(path);
            }
        }

        // Mesmo desenho da impressora real, a 203 dpi (bobinas térmicas comuns).
        void WritePng(TicketDocument document, string file)
        {
            const float dpi = 203f;
            float widthUnits = document.PaperMm / 25.4f * 100f;
            float heightUnits;
            Bitmap backing;
            using (var m = GdiTicketPainter.NewMeasureGraphics(out backing))
                GdiTicketPainter.Layout(m, document.Lines, 0, widthUnits, float.MaxValue, FontPoints, false, out heightUnits);
            backing.Dispose();

            int wpx = (int)Math.Round(document.PaperMm / 25.4f * dpi);
            int hpx = (int)Math.Ceiling(heightUnits / 100f * dpi) + 8;
            using (var bmp = new Bitmap(wpx, hpx))
            {
                bmp.SetResolution(dpi, dpi);
                using (var g = Graphics.FromImage(bmp))
                {
                    g.Clear(Color.White);
                    g.PageUnit = GraphicsUnit.Inch;
                    g.PageScale = 0.01f;
                    float used;
                    GdiTicketPainter.Layout(g, document.Lines, 0, widthUnits, float.MaxValue, FontPoints, true, out used);
                }
                bmp.Save(file, ImageFormat.Png);
            }
        }
    }
}
