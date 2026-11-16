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
        public static ThermalPrinter Printer { get; private set; }

        public static void Init(string[] args)
        {
            AutoStart = false;
            foreach (var a in args ?? Array.Empty<string>())
                if (a.Trim().ToLowerInvariant() == "/autostart") AutoStart = true;

            Audio = new AudioPlayer();
            Audio.Init();

            Printer = new ThermalPrinter
            {
                FontPoints = AppSettings.Current.FontSize,
                PageSizeMm = AppSettings.Current.PaperWidthMm,
            };
            if (!string.IsNullOrEmpty(AppSettings.Current.SelectedPrinter))
                SelectPrinterByName(AppSettings.Current.SelectedPrinter);

            Device = new DeviceClient { PollIntervalMs = 15000 };
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
            try { Device?.Dispose(); } catch { }
            try { Audio?.Dispose(); } catch { }
        }
    }
}
