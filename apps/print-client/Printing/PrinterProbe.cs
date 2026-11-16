using System;
using System.Management;

namespace MeuCardapio.PrintClient.Printing
{
    // Pergunta ao Windows (WMI Win32_Printer) se a impressora escolhida está em condição de imprimir.
    // Sem isso, impressora offline/sem papel só enfileira no spooler e o app marcaria o pedido como
    // impresso. Quando o WMI não responde, devolve "sem problema conhecido" (não bloqueia a cozinha).
    public static class PrinterProbe
    {
        // null = pode imprimir (ou desconhecido); senão, o motivo em português para o lojista.
        public static string Check(string printerName)
        {
            if (string.IsNullOrWhiteSpace(printerName)) return "Nenhuma impressora selecionada.";
            try
            {
                var query = "SELECT WorkOffline, PrinterStatus, DetectedErrorState FROM Win32_Printer WHERE Name = '"
                    + printerName.Replace("\\", "\\\\").Replace("'", "\\'") + "'";
                using (var searcher = new ManagementObjectSearcher(query))
                using (var results = searcher.Get())
                {
                    foreach (ManagementObject p in results)
                    {
                        bool offline = p["WorkOffline"] is bool && (bool)p["WorkOffline"];
                        int status = p["PrinterStatus"] == null ? 0 : Convert.ToInt32(p["PrinterStatus"]);
                        int error = p["DetectedErrorState"] == null ? 0 : Convert.ToInt32(p["DetectedErrorState"]);
                        return Describe(offline, status, error);
                    }
                }
            }
            catch { /* WMI indisponível: segue e deixa o spooler decidir */ }
            return null;
        }

        // PrinterStatus: 3 idle, 4 printing, 5 warmup, 6 stopped, 7 offline.
        // DetectedErrorState: 3 pouco papel, 4 sem papel, 7 porta aberta, 8 papel enroscado, 9 offline, 10 pede serviço, 11 saída cheia.
        public static string Describe(bool workOffline, int printerStatus, int errorState)
        {
            if (workOffline || printerStatus == 7 || errorState == 9) return "A impressora está offline (desligada, sem cabo ou pausada no Windows).";
            if (errorState == 4) return "A impressora está sem papel.";
            if (errorState == 7) return "A tampa da impressora está aberta.";
            if (errorState == 8) return "Papel enroscado na impressora.";
            if (errorState == 10) return "A impressora pede manutenção.";
            if (printerStatus == 6) return "A impressora está parada (fila pausada ou com erro).";
            return null;
        }
    }
}
