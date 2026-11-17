using System;
using System.Management;
using System.Threading.Tasks;

namespace MeuCardapio.PrintClient.Printing
{
    // Pergunta ao Windows (WMI Win32_Printer) se a impressora escolhida está em condição de imprimir.
    // Sem isso, impressora offline/sem papel só enfileira no spooler e o app marcaria o pedido como
    // impresso. Quando o WMI não responde (ou demora), devolve "sem problema conhecido": não bloqueia a cozinha.
    // PC-15 (parecer Nightingale): consulta com timeout (enumeração 3 s e teto total de 5 s) e liberando cada objeto;
    // quem chama roda fora da thread da interface (PrintCoordinator é chamado em segundo plano).
    public static class PrinterProbe
    {
        public const int EnumerationTimeoutMs = 3000;
        public const int TotalTimeoutMs = 5000;

        // null = pode imprimir (ou desconhecido); senão, o motivo em português para o lojista.
        public static string Check(string printerName) { string code; return Check(printerName, out code); }

        // Com o código de lista fechada (PRINTER_OFFLINE, NO_PAPER, PRINTER_NOT_FOUND, OTHER) para o ack do job.
        public static string Check(string printerName, out string code)
        {
            code = "OTHER";
            if (string.IsNullOrWhiteSpace(printerName)) { code = "PRINTER_NOT_FOUND"; return "Nenhuma impressora selecionada."; }
            var coded = WithTimeout(() => CheckCore(printerName), TotalTimeoutMs);
            if (coded == null) return null;
            int sep = coded.IndexOf('|');
            if (sep < 0) return coded;
            code = coded.Substring(0, sep);
            return coded.Substring(sep + 1);
        }

        // Roda `probe` em outra thread e desiste depois de `timeoutMs` (devolve null = desconhecido, não bloqueia).
        // A consulta presa continua em segundo plano até o WMI soltar, sem segurar a impressão.
        // VOO ÚNICO (parecer Nightingale N2): se uma consulta anterior ainda está presa, não cria outra tarefa
        // (senão uma impressora travada acumularia consultas penduradas); devolve "desconhecido" na hora.
        static readonly object Gate = new object();
        static Task<string> _inFlight;

        public static string WithTimeout(Func<string> probe, int timeoutMs)
        {
            try
            {
                Task<string> task;
                lock (Gate)
                {
                    if (_inFlight != null && !_inFlight.IsCompleted) return null;
                    task = _inFlight = Task.Run(probe);
                }
                return task.Wait(timeoutMs) ? task.Result : null;
            }
            catch { return null; }
        }

        static string CheckCore(string printerName)
        {
            try
            {
                var query = "SELECT WorkOffline, PrinterStatus, DetectedErrorState FROM Win32_Printer WHERE Name = '"
                    + printerName.Replace("\\", "\\\\").Replace("'", "\\'") + "'";
                var options = new EnumerationOptions { Timeout = TimeSpan.FromMilliseconds(EnumerationTimeoutMs), ReturnImmediately = false };
                using (var searcher = new ManagementObjectSearcher(new ManagementScope(@"\\.\root\cimv2"), new ObjectQuery(query), options))
                using (var results = searcher.Get())
                {
                    foreach (ManagementObject p in results)
                    {
                        using (p)
                        {
                            bool offline = p["WorkOffline"] is bool && (bool)p["WorkOffline"];
                            int status = p["PrinterStatus"] == null ? 0 : Convert.ToInt32(p["PrinterStatus"]);
                            int error = p["DetectedErrorState"] == null ? 0 : Convert.ToInt32(p["DetectedErrorState"]);
                            var text = Describe(offline, status, error);
                            return text == null ? null : CodeOf(offline, status, error) + "|" + text;
                        }
                    }
                }
            }
            catch { /* WMI indisponível: segue e deixa o spooler decidir */ }
            return null;
        }

        // Código de lista fechada do problema (o texto de Describe NÃO vai ao servidor).
        public static string CodeOf(bool workOffline, int printerStatus, int errorState)
        {
            if (workOffline || printerStatus == 7 || errorState == 9) return "PRINTER_OFFLINE";
            if (errorState == 4) return "NO_PAPER";
            return "OTHER"; // tampa aberta, papel enroscado, manutenção, fila parada
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
