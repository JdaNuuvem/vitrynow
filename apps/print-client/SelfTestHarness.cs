using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;
using MeuCardapio.PrintClient.Services;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient
{
    // HARNESS SEM IMPRESSORA (QA-06/PC-12, CL-04): o pipeline INTEIRO do print-client (DeviceClient real ->
    // PrintCoordinator -> impressora virtual) contra uma API falsa em loopback, com falhas simuladas:
    // offline, sem papel, queda no meio do tiquete, polling+WS ao mesmo tempo, app fechado entre imprimir
    // e avisar a API, API fora do ar. O que NAO cobre (fica no roteiro manual, docs\roteiro-impressora-real.md):
    // spooler/driver reais, papel, guilhotina, acentos na fonte da impressora, SmartScreen/instalador.
    static class SelfTestHarness
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }
        static bool WaitFor(Func<bool> c, int ms) { return SelfTestUtil.WaitFor(c, ms); }

        sealed class Rig : IDisposable
        {
            public readonly FakeApi Api;
            public readonly VirtualPrintTarget Printer;
            public PrintLedger Ledger;
            public DeviceClient Device;
            public PrintCoordinator Coordinator;
            public readonly List<string> Messages = new List<string>();
            public readonly List<string> Problems = new List<string>();
            readonly bool _ownsApi;
            readonly string _ledgerPath;
            public DateTime Now = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);

            public Rig(FakeApi api, VirtualPrintTarget printer, string ledgerPath, bool ownsApi, int pollMs, int paperMm = 58)
            {
                Api = api; Printer = printer; _ledgerPath = ledgerPath; _ownsApi = ownsApi;
                Ledger = new PrintLedger(ledgerPath, () => Now);
                var settings = new AppSettings { ApiBaseUrl = "http://127.0.0.1:" + api.Port, DeviceToken = "mcd_harness_segredo" };
                Device = new DeviceClient(Ledger, settings) { PollIntervalMs = pollMs, WsRetryMs = 120, RevokedProbeMs = 600000 };
                Coordinator = new PrintCoordinator(Device, printer, () => paperMm);
                Coordinator.Message += m => { lock (Messages) Messages.Add(m); };
                Device.PrintProblemsChanged += l => { lock (Problems) Problems.Add(string.Join(",", l)); };
                Device.TicketReady += o => Coordinator.Handle(o);
                Device.StatusChanged += m => { lock (Messages) Messages.Add(m); };
            }

            public void Start() { Device.Start(); }
            public bool HasMessage(string part) { lock (Messages) return Messages.Any(m => m.Contains(part)); }
            public string Problem(int i) { lock (Problems) return i >= 0 && i < Problems.Count ? Problems[i] : null; }
            public int ProblemCount { get { lock (Problems) return Problems.Count; } }

            public void Dispose()
            {
                try { Device.Dispose(); } catch { }
                if (_ownsApi) Api.Dispose();
            }
        }

        static PrintableOrder Order(string id, string code, bool many = false)
        {
            var o = many ? SelfTestPrint.ManyItems() : SelfTestPrint.Basic();
            o.OrderId = id; o.Code = code;
            return o;
        }

        static FakeApi NewApi(params PrintableOrder[] orders)
        {
            var api = new FakeApi();
            var byId = orders.ToDictionary(o => o.OrderId);
            api.PrintableBody = o => JsonConvert.SerializeObject(new PrintableOrderResponse { Order = byId[o[0]] });
            foreach (var o in orders) api.Pending.Add(new[] { o.OrderId, o.Code });
            return api;
        }

        static string Expected(PrintableOrder o, int mm = 58) { return TextTicketWriter.RenderText(TicketBuilder.Build(o, mm), TicketText.ColumnsFor(mm)); }

        // Conteudo do i-esimo arquivo da lista, ou null (teste nao estoura se o tiquete nao saiu).
        static string Read(List<string> files, int i = 0) { lock (files) return i < files.Count ? File.ReadAllText(files[i]) : null; }

        // Linhas do texto (sem a ultima quebra); texto nulo vira lista vazia.
        static string[] Lines(string text)
        {
            if (text == null) return new string[0];
            return text.TrimEnd((char)10).Split((char)10);
        }

        static string Tmp() { var d = Path.Combine(Path.GetTempPath(), "meucardapio_harness_" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
        static void Clean(string d) { try { Directory.Delete(d, true); } catch { } }

        public static void Run()
        {
            Happy();
            PrinterOffline();
            PrinterNoPaper();
            DropMidJob();
            PollingPlusWebSocket();
            AppClosedBetweenPrintAndAck();
            ApiDown();
            CanceledWhileFailing();
            PaperWidth80();
        }

        // 1) caminho feliz: imprime 1 vez, o conteudo e o esperado, a API recebe o aviso
        static void Happy()
        {
            var dir = Tmp();
            try
            {
                var order = Order("A", "1001");
                using (var rig = new Rig(NewApi(order), new VirtualPrintTarget(Path.Combine(dir, "out")), null, true, 80))
                {
                    rig.Start();
                    bool done = WaitFor(() => rig.Printer.Printed.Count == 1 && rig.Api.Pending.Count == 0 && rig.Ledger.PendingAcks().Count == 0, 8000);
                    Thread.Sleep(400);
                    Check("harness ok: 1 pedido => 1 tiquete e a API recebeu o aviso (fila vazia)", done && rig.Printer.Printed.Count == 1);
                    Check("harness ok: o tiquete impresso e exatamente o esperado (58 mm)", done && Read(rig.Printer.Printed) == Expected(order));
                    Check("harness ok: sem indicador de problema e sem erro", rig.ProblemCount == 0 && !rig.HasMessage("Erro"));
                }
            }
            finally { Clean(dir); }
        }

        // 2) impressora offline: nao imprime, avisa, volta sozinha depois do recuo e imprime UMA vez
        static void PrinterOffline()
        {
            var dir = Tmp();
            try
            {
                var order = Order("B", "2002");
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.Offline };
                using (var rig = new Rig(NewApi(order), printer, null, true, 60))
                {
                    rig.Start();
                    bool flagged = WaitFor(() => rig.Problem(0) == "#2002", 8000);
                    Thread.Sleep(500);
                    Check("harness offline: avisa 'sem imprimir' com o numero do pedido, 1 vez so", flagged && rig.ProblemCount == 1 && printer.Printed.Count == 0);
                    Check("harness offline: mensagem fala em offline", rig.HasMessage("offline"));
                    Check("harness offline: recuo impede nova tentativa imediata (pedido continua na API)", rig.Api.Pending.Count == 1);
                    printer.Fault = VirtualFault.None;
                    rig.Now = rig.Now.AddSeconds(20); // passou o recuo de 15 s
                    bool printed = WaitFor(() => printer.Printed.Count == 1 && rig.Api.Pending.Count == 0, 8000);
                    Thread.Sleep(400);
                    Check("harness offline: impressora voltou => imprime e fecha, 1 tiquete so", printed && printer.Printed.Count == 1);
                    Check("harness offline: o indicador some quando imprime", WaitFor(() => rig.Problem(rig.ProblemCount - 1) == "", 3000));
                    Check("harness offline: conteudo completo", Read(printer.Printed) == Expected(order));
                }
            }
            finally { Clean(dir); }
        }

        // 3) sem papel
        static void PrinterNoPaper()
        {
            var dir = Tmp();
            try
            {
                var order = Order("C", "3003");
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.OutOfPaper };
                using (var rig = new Rig(NewApi(order), printer, null, true, 60))
                {
                    rig.Start();
                    bool flagged = WaitFor(() => rig.Problem(0) == "#3003", 8000);
                    Check("harness sem papel: avisa e a mensagem fala em papel", flagged && rig.HasMessage("sem papel") && printer.Printed.Count == 0);
                    printer.Fault = VirtualFault.None; rig.Now = rig.Now.AddSeconds(20);
                    Check("harness sem papel: papel reposto => imprime", WaitFor(() => printer.Printed.Count == 1, 8000));
                }
            }
            finally { Clean(dir); }
        }

        // 4) a conexao com a impressora cai no meio do tiquete: sobra um pedaco (como no papel), o pedido NAO e dado como impresso
        static void DropMidJob()
        {
            var dir = Tmp();
            try
            {
                var order = Order("D", "4004", many: true);
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.DropMidJob, DropAfterLines = 5 };
                using (var rig = new Rig(NewApi(order), printer, null, true, 60))
                {
                    rig.Start();
                    bool flagged = WaitFor(() => rig.Problem(0) == "#4004" && printer.Partials.Count == 1, 8000);
                    Check("harness queda no meio: deixa 1 pedaco parcial e NAO conta como impresso", flagged && printer.Printed.Count == 0 && !rig.Ledger.IsPrinted("D"));
                    Check("harness queda no meio: o pedaco tem so o comeco do tiquete", Lines(Read(printer.Partials)).Length == 5);
                    printer.Fault = VirtualFault.None; rig.Now = rig.Now.AddSeconds(20);
                    bool printed = WaitFor(() => printer.Printed.Count == 1 && rig.Api.Pending.Count == 0, 8000);
                    Thread.Sleep(300);
                    Check("harness queda no meio: reimprime o tiquete COMPLETO uma vez (o pedaco parcial fica no papel: avisar a cozinha)", printed && printer.Printed.Count == 1 && printer.Partials.Count == 1
                        && Read(printer.Printed) == Expected(order));
                }
            }
            finally { Clean(dir); }
        }

        // 5) polling rapido + avisos do WebSocket em rajada com o pedido ainda listado na API e impressora lenta
        static void PollingPlusWebSocket()
        {
            var dir = Tmp();
            try
            {
                var order = Order("E", "5005");
                var api = NewApi(order);
                api.WsMode = "accept"; api.RemoveOnAck = false; // a API continua listando o pedido: o cliente nao pode reimprimir
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { DelayMs = 150 };
                using (var rig = new Rig(api, printer, null, true, 40))
                {
                    rig.Start();
                    WaitFor(() => api.OpenSockets == 1, 8000);
                    for (int i = 0; i < 25; i++) { api.SendWs("{\"type\":\"print.available\"}"); Thread.Sleep(20); }
                    Thread.Sleep(600);
                    Check("harness polling+WS: conectou por WebSocket de verdade", api.Requests.Any(r => r.Contains("/ws/device")));
                    Check("harness polling+WS: 25 avisos + polling a cada 40 ms com o pedido ainda listado => 1 so tiquete", printer.Printed.Count == 1);
                    Check("harness polling+WS: ack feito e sem duplicidade no ledger", rig.Ledger.IsPrinted("E") && rig.Ledger.PendingAcks().Count == 0);
                }
            }
            finally { Clean(dir); }
        }

        // 6) o app fecha depois de imprimir e antes de a API receber o aviso: na reabertura NAO reimprime e o aviso sai
        static void AppClosedBetweenPrintAndAck()
        {
            var dir = Tmp();
            try
            {
                var order = Order("F", "6006");
                var api = NewApi(order);
                api.AckStatus = 500; // a API nao aceita o aviso (rede caiu / erro)
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                var ledgerPath = Path.Combine(dir, "printed.json");
                using (var rig1 = new Rig(api, printer, ledgerPath, false, 60))
                {
                    rig1.Start();
                    bool printed = WaitFor(() => printer.Printed.Count == 1 && rig1.Ledger.PendingAcks().Contains("F"), 8000);
                    Check("harness reinicio: imprimiu e o aviso a API falhou (ficou pendente em disco)", printed && api.Pending.Count == 1);
                }
                Thread.Sleep(200);
                api.AckStatus = 200; // o app "reabre" com a API de volta
                using (var rig2 = new Rig(api, printer, ledgerPath, false, 60))
                {
                    rig2.Start();
                    bool acked = WaitFor(() => api.Pending.Count == 0 && rig2.Ledger.PendingAcks().Count == 0, 8000);
                    Thread.Sleep(400);
                    Check("harness reinicio: reabriu, enviou o aviso pendente e NAO reimprimiu", acked && printer.Printed.Count == 1);
                }
                api.Dispose();
            }
            finally { Clean(dir); }
        }

        // 7) API fora do ar por um tempo (503) e volta: imprime uma vez, sem travar
        static void ApiDown()
        {
            var dir = Tmp();
            try
            {
                var order = Order("G", "7007");
                var api = NewApi(order);
                api.PendingStatus = 503; api.PendingFailFirst = 6;
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                using (var rig = new Rig(api, printer, null, true, 50))
                {
                    rig.Start();
                    bool printed = WaitFor(() => printer.Printed.Count == 1 && api.Pending.Count == 0, 10000);
                    Thread.Sleep(300);
                    Check("harness API fora do ar: 6 respostas 503 seguidas, depois imprime 1 vez", printed && printer.Printed.Count == 1 && api.PendingCalls > 6);
                    Check("harness API fora do ar: nao confunde com chave revogada", !rig.Device.IsRevoked);
                }
            }
            finally { Clean(dir); }
        }

        // 8) pedido cancelado na API enquanto a impressora estava com problema: o indicador some e nada e impresso depois
        static void CanceledWhileFailing()
        {
            var dir = Tmp();
            try
            {
                var order = Order("H", "8008");
                var api = NewApi(order);
                var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.Offline };
                using (var rig = new Rig(api, printer, null, true, 60))
                {
                    rig.Start();
                    WaitFor(() => rig.Problem(0) == "#8008", 8000);
                    lock (api.Lock) api.Pending.Clear();                 // a loja cancelou o pedido
                    bool cleared = WaitFor(() => rig.Problem(rig.ProblemCount - 1) == "", 8000);
                    printer.Fault = VirtualFault.None; rig.Now = rig.Now.AddMinutes(10);
                    Thread.Sleep(500);
                    Check("harness cancelado: indicador some e nada e impresso depois", cleared && printer.Printed.Count == 0);
                }
            }
            finally { Clean(dir); }
        }

        // 9) bobina de 80 mm: mais colunas
        static void PaperWidth80()
        {
            var dir = Tmp();
            try
            {
                var order = Order("I", "9009");
                using (var rig = new Rig(NewApi(order), new VirtualPrintTarget(Path.Combine(dir, "out")), null, true, 60, 80))
                {
                    rig.Start();
                    bool done = WaitFor(() => rig.Printer.Printed.Count == 1, 8000);
                    Check("harness 80 mm: tiquete montado em 48 colunas", done && Read(rig.Printer.Printed) == Expected(order, 80)
                        && Lines(Read(rig.Printer.Printed)).Any(l => l.Length > 32));
                }
            }
            finally { Clean(dir); }
        }
    }
}
