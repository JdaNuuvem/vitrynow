using System;
using System.Windows.Forms;
using MeuCardapio.PrintClient.Services;
using MeuCardapio.PrintClient.UI;

namespace MeuCardapio.PrintClient
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
                if (args[i] == "--selftest")
                    Environment.Exit(SelfTest.Run());

            // Sem isso, uma exceção não prevista em qualquer handler de evento (trocar
            // impressora, trocar som, etc.) matava o processo em silêncio: o ícone some da
            // bandeja e ninguém percebe até os pedidos pararem de imprimir. Agora loga antes
            // de qualquer coisa — pelo menos fica um rastro pra investigar depois.
            Application.ThreadException += (s, e) => Logger.Error("Exceção não tratada (UI thread)", e.Exception);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
                Logger.Error("Exceção não tratada (background)", e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString() ?? "desconhecida"));

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            App.Init(args);

            if (!AppSettings.Current.IsConfigured)
            {
                using (var setup = new SetupForm())
                {
                    if (setup.ShowDialog() != DialogResult.OK)
                        return;
                }
            }

            Application.Run(new MainForm());
            App.Shutdown();
        }
    }
}
