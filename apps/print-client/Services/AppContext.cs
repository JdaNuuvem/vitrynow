using System;
using MeuCardapio.PrintClient.Printing;

namespace MeuCardapio.PrintClient.Services
{
    // Container estático dos serviços compartilhados.
    public static class App
    {
        public static bool AutoStart { get; private set; }
        public static AudioPlayer Audio { get; private set; }
        public static DeviceClient Device { get; private set; }
        // Impressora Windows (GDI+). Em modo impressora virtual (VirtualPrinterFolder nas settings) o destino real
        // é VirtualPrintTarget e Printer só guarda a escolha da lista da tela.
        public static GdiPrintTarget Printer { get; private set; }
        public static IPrintTarget Target { get; private set; }
        public static PrintCoordinator Coordinator { get; private set; }

        public static void Init(string[] args)
        {
            AutoStart = false;
            foreach (var a in args ?? Array.Empty<string>())
                if (a.Trim().ToLowerInvariant() == "/autostart") AutoStart = true;

            Audio = new AudioPlayer();
            Audio.Init();

            Printer = new GdiPrintTarget
            {
                FontPoints = AppSettings.Current.FontSize,
                PaperMm = AppSettings.Current.PaperWidthMm,
            };
            if (!string.IsNullOrEmpty(AppSettings.Current.SelectedPrinter))
                SelectPrinterByName(AppSettings.Current.SelectedPrinter);

            Device = new DeviceClient { PollIntervalMs = 15000 };
            Target = string.IsNullOrWhiteSpace(AppSettings.Current.VirtualPrinterFolder)
                ? (IPrintTarget)Printer
                : new VirtualPrintTarget(AppSettings.Current.VirtualPrinterFolder, true) { FontPoints = AppSettings.Current.FontSize };
            Coordinator = new PrintCoordinator(Device, Target, () => AppSettings.Current.PaperWidthMm);
        }

        public static void SelectPrinterByName(string name)
        {
            var list = System.Drawing.Printing.PrinterSettings.InstalledPrinters;
            for (int i = 0; i < list.Count; i++)
            {
                if (string.Equals(list[i], name, StringComparison.OrdinalIgnoreCase))
                {
                    Printer.SelectPrinter(i);
                    return;
                }
            }
        }

        public static void StartListeners()
        {
            try { Device.Start(); } catch (Exception ex) { Console.WriteLine(ex.Message); }
        }

        public static void Shutdown()
        {
            try { Updater.DiscardPending(); } catch { }
            try { Device?.Dispose(); } catch { }
            try { Audio?.Dispose(); } catch { }
        }
    }
}
