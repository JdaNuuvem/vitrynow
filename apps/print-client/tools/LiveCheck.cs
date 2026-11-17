// Conferencia cruzada PC-03 x API-12 (so DEV): roda o DeviceClient REAL (modo PrintJob) contra uma API local, com a
// impressora virtual. Compilado junto das fontes do print-client por live-check.ps1 e executado em memoria.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    public static class LiveCheck
    {
        // Conferencia cruzada do ALERTA CENTRAL (PC-24): o DeviceClient REAL manda os 5 codigos da lista a uma API LOCAL e devolve o que enviou.
        // ownOrderId = pedido da loja do token; foreignOrderId = de outra loja; unknownOrderId = formato valido que nao existe.
        public static string Alerts(string baseUrl, string token, string ownOrderId, string foreignOrderId, string unknownOrderId)
        {
            var sb = new StringBuilder();
            var settings = new AppSettings { ApiBaseUrl = baseUrl, DeviceToken = token };
            var ledger = new PrintLedger(Path.Combine(Path.GetTempPath(), "live-alerts-" + Guid.NewGuid().ToString("N") + ".json"), () => DateTime.UtcNow);
            var device = new DeviceClient(ledger, settings) { PollIntervalMs = 60000 };
            device.Start();   // so para o app ter a URL base, como em producao
            var plan = new[]
            {
                new[] { DeviceAlertCode.NothingToChargeConflict, ownOrderId },
                new[] { DeviceAlertCode.NothingToChargeInvalid, foreignOrderId },
                new[] { DeviceAlertCode.EmptyZeroTicket, unknownOrderId },
                new[] { DeviceAlertCode.ModeUnconfirmed, null },
                new[] { DeviceAlertCode.ModeRecovered, null },
            };
            foreach (var item in plan)
            {
                bool ok = device.ReportAlert(item[0], item[1]);
                sb.AppendLine("ENVIO " + item[0] + " -> " + (ok ? "enviado" : "descartado"));
                Thread.Sleep(400);
            }
            sb.AppendLine("ENVIO QUEUE_WITHOUT_PRINTER -> " + (device.ReportAlert("QUEUE_WITHOUT_PRINTER", ownOrderId) ? "ENVIADO (ERRO)" : "descartado (lista fechada)"));
            Thread.Sleep(800);
            try { device.Dispose(); } catch { }
            return sb.ToString();
        }

        // fault: "" (impressora boa) | "offline" | "nopaper" | "driver"
        // startLegacy: o cliente PADRAO (UsePrintJobs desligado) comeca no legado; a virada para a fila vem do servidor (PC-18/PC-22).
        public static string Run(string baseUrl, string token, string outDir, string ledgerPath, int seconds, string fault, bool startLegacy = false)
        {
            var sb = new StringBuilder();
            var messages = new List<string>();
            var problems = new List<string>();
            int alerts = 0;
            Directory.CreateDirectory(outDir);
            var printer = new VirtualPrintTarget(outDir);
            if (fault == "offline") printer.Fault = VirtualFault.Offline;
            else if (fault == "nopaper") printer.Fault = VirtualFault.OutOfPaper;

            var ledger = new PrintLedger(ledgerPath, () => DateTime.UtcNow);
            var settings = new AppSettings { ApiBaseUrl = baseUrl, DeviceToken = token, UsePrintJobs = !startLegacy };
            var device = new DeviceClient(ledger, settings) { PollIntervalMs = 1500, WsRetryMs = 1000, RevokedProbeMs = 600000 };
            var coordinator = new PrintCoordinator(device, printer, () => 58, TimeZoneInfo.Local);
            coordinator.Message += m => { lock (messages) messages.Add(m); };
            device.StatusChanged += m => { lock (messages) messages.Add(m); };
            device.PrintProblemsChanged += l => { lock (problems) problems.Add(string.Join(",", l)); };
            device.OrderPending += () => Interlocked.Increment(ref alerts);
            device.TicketReady += o => { Task.Run(() => coordinator.Handle(o)); };
            device.Start();
            Thread.Sleep(seconds * 1000);
            try { device.Dispose(); } catch { }

            sb.AppendLine("MODO_FINAL=" + device.CurrentMode);
            sb.AppendLine("ALERTAS=" + alerts);
            lock (messages) foreach (var m in messages.Distinct()) sb.AppendLine("MSG " + m);
            lock (problems) foreach (var p in problems) sb.AppendLine("PROBLEMAS " + p);
            foreach (var f in Directory.GetFiles(outDir, "*.txt").OrderBy(x => x)) sb.AppendLine("ARQUIVO " + Path.GetFileName(f));
            return sb.ToString();
        }
    }
}
