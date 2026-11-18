using System;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Printing;

namespace MeuCardapio.PrintClient.Printing
{
    // Impressora Windows (spooler) pelo System.Drawing.Printing. A altura do papel é a do tíquete
    // (bobina contínua); se o driver limitar a página, continua na página seguinte.
    public sealed class GdiPrintTarget : IPrintTarget
    {
        public int PaperMm { get; set; } = 58;
        public int FontPoints { get; set; } = 10;

        readonly PrinterSettings _settings = new PrinterSettings();

        public string SelectedPrinter { get { return _settings.PrinterName; } }

        public void SelectPrinter(int index)
        {
            var list = PrinterSettings.InstalledPrinters;
            if (index >= 0 && index < list.Count) _settings.PrinterName = list[index];
        }

        public void Print(TicketDocument document)
        {
            if (!_settings.IsValid) throw new PrinterUnavailableException("Impressora não encontrada neste computador. Escolha outra na janela do aplicativo.", "PRINTER_NOT_FOUND");
            string probeCode;
            var problem = PrinterProbe.Check(_settings.PrinterName, out probeCode);
            if (problem != null) throw new PrinterUnavailableException(problem, probeCode);

            int mm = document.PaperMm > 0 ? document.PaperMm : PaperMm;
            float widthUnits = mm / 25.4f * 100f;
            float heightUnits;
            Bitmap backing;
            using (var g = GdiTicketPainter.NewMeasureGraphics(out backing))
            {
                GdiTicketPainter.Layout(g, document.Lines, 0, widthUnits, float.MaxValue, FontPoints, false, out heightUnits);
            }
            backing.Dispose();

            var doc = new PrintDocument { PrinterSettings = _settings, DocumentName = "Pedido" };
            doc.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            doc.DefaultPageSettings.PaperSize = new PaperSize("bobina", (int)Math.Round(widthUnits), (int)Math.Ceiling(Math.Max(heightUnits, 200f)));
            int next = 0;
            doc.PrintPage += (s, e) =>
            {
                float used;
                next = GdiTicketPainter.Layout(e.Graphics, document.Lines, next, e.PageBounds.Width, e.PageBounds.Height, FontPoints, true, out used);
                e.HasMorePages = next < document.Lines.Count;
            };
            try { doc.Print(); }
            catch (InvalidPrinterException ex) { throw new PrinterUnavailableException("A impressora recusou o trabalho: " + ex.Message, ex, "DRIVER_ERROR"); }
            catch (Win32Exception ex) { throw new PrinterUnavailableException("Falha ao enviar para a impressora: " + ex.Message, ex, "DRIVER_ERROR"); }
            finally { doc.Dispose(); }
        }
    }
}
