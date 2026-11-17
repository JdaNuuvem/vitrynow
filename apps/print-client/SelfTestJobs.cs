using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Printing;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // PC-03: o cliente no modo PrintJob (claim/ack, ADR-0004) contra uma API falsa que implementa a semantica do ADR:
    // lease, ack idempotente, 409 em lease vencida, attempts. Pipeline inteiro (DeviceClient real -> PrintCoordinator ->
    // impressora virtual). Contrato assumido: docs\contrato-printjob-cliente.md.
    static class SelfTestJobs
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }
        static bool WaitFor(Func<bool> c, int ms) { return SelfTestUtil.WaitFor(c, ms); }

        sealed class Rig : IDisposable
        {
            public readonly FakeApi Api;
            public readonly VirtualPrintTarget Printer;
            public readonly PrintLedger Ledger;
            public readonly DeviceClient Device;
            public readonly PrintCoordinator Coordinator;
            public readonly List<string> Messages = new List<string>();
            public readonly List<string> Problems = new List<string>();
            public DateTime Now = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);
            int _alerts; public int Alerts { get { return Volatile.Read(ref _alerts); } }

            public Rig(FakeApi api, VirtualPrintTarget printer, string ledgerPath, string token, int pollMs = 60, int paperMm = 58, bool usePrintJobs = true)
            {
                Api = api; Printer = printer;
                Ledger = new PrintLedger(ledgerPath, () => Now);
                var settings = new AppSettings { ApiBaseUrl = "http://127.0.0.1:" + api.Port, DeviceToken = token, UsePrintJobs = usePrintJobs };
                Device = new DeviceClient(Ledger, settings) { PollIntervalMs = pollMs, WsRetryMs = 150, RevokedProbeMs = 600000 };
                Coordinator = new PrintCoordinator(Device, printer, () => paperMm, SelfTestPrint.Tz);
                Coordinator.Message += m => { lock (Messages) Messages.Add(m); };
                Device.StatusChanged += m => { lock (Messages) Messages.Add(m); };
                Device.PrintProblemsChanged += l => { lock (Problems) Problems.Add(string.Join(",", l)); };
                Device.OrderPending += () => Interlocked.Increment(ref _alerts);
                Device.TicketReady += OnTicket;
            }
            public void OnTicket(PrintableOrder o) { System.Threading.Tasks.Task.Run(() => Coordinator.Handle(o)); }
            public void Start() { Device.Start(); }
            public bool HasMessage(string part) { lock (Messages) return Messages.Any(m => m.Contains(part)); }
            public int MessageCount(string part) { lock (Messages) return Messages.Count(m => m.Contains(part)); }
            public string LastProblem() { lock (Problems) return Problems.Count == 0 ? null : Problems[Problems.Count - 1]; }
            public int ProblemCount { get { lock (Problems) return Problems.Count; } }
            public void Dispose() { try { Device.Dispose(); } catch { } }
        }

        static string Tmp() { var d = Path.Combine(Path.GetTempPath(), "meucardapio_jobs_" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(d); return d; }
        static void Clean(string d) { try { Directory.Delete(d, true); } catch { } }
        static PrintableOrder Order(string id, string code) { var o = SelfTestPrint.Basic(); o.OrderId = id; o.Code = code; return o; }
        static string Read(List<string> files, int i = 0) { lock (files) return i < files.Count ? File.ReadAllText(files[i]) : null; }
        static string Expected(PrintableOrder o, int mm = 58) { return TextTicketWriter.RenderText(TicketBuilder.Build(o, mm, SelfTestPrint.Tz), TicketText.ColumnsFor(mm)); }
        const string Tok = "Bearer mcd_impressora1_segredo";

        public static void Run()
        {
            Happy();
            EmptyQueue();
            PrinterOffline();
            KindsAndNotices();
            CancelNoticeKind();
            UnknownKindAndMissingTicket();
            LeaseExpiredBeforeAck();
            ReofferedAfterPrinted();
            AckRetriedAndRestart();
            TwoPrinters();
            AuthRevoked();
            NoHotLoop();
            FailedPrinterDoesNotHoldJob();
            ContractTable();
            FailureReportsOnlyCodes();
            ReclaimedBySameOwner();
            BadJobDoesNotBlockQueue();
            TestJobWithTicket();
            LegacyUnchanged();
            ModeFollowsServer();
        }

        // 1) caminho feliz: claim -> imprime 1x -> ack PRINTED
        static void Happy()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var order = Order("A", "1001");
                    api.AddJob("j1", order);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("j1") == "PRINTED" && printer.Printed.Count == 1, 20000);
                        Thread.Sleep(300);
                        Check("job: claim -> imprime 1 vez -> ack PRINTED (servidor marca PRINTED)", done && printer.Printed.Count == 1);
                        Check("job: o tiquete impresso e exatamente o esperado", Read(printer.Printed) == Expected(order));
                        Check("job: Bearer da impressora enviado no claim e no ack", api.Has(r => r.Contains("/print-jobs/claim") && r.EndsWith("auth=" + Tok)) && api.Has(r => r.Contains("/print-jobs/j1/ack") && r.EndsWith("auth=" + Tok)));
                        Check("job: nao usa o endpoint antigo /orders/pending", !api.Has(r => r.Contains("/api/device/orders/pending")));
                        Check("job: ledger por JOB (job:j1), sem ack pendente", rig.Ledger.IsPrinted("job:j1") && rig.Ledger.PendingAcks().Count == 0);
                        Check("job: sem indicador de problema nem erro", rig.ProblemCount == 0 && !rig.HasMessage("Erro"));
                        Check("job: pedido novo (ORDER_KITCHEN) alerta 1 vez", rig.Alerts == 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 2) fila vazia: {"job":null} e 204 nao imprimem, nao dao erro e nao pausam
        static void EmptyQueue()
        {
            foreach (var as204 in new[] { false, true })
            {
                var dir = Tmp();
                try
                {
                    using (var api = new FakeApi { EmptyAs204 = as204 })
                    {
                        var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                        using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                        {
                            rig.Start();
                            bool polled = WaitFor(() => api.ClaimCalls >= 4, 8000);
                            Check("fila vazia (" + (as204 ? "204" : "{job:null}") + "): continua pedindo, nao imprime, sem erro e sem pausar", polled && printer.Printed.Count == 0 && !rig.HasMessage("Erro") && !rig.Device.IsRevoked);
                        }
                    }
                }
                finally { Clean(dir); }
            }
        }

        // 3) impressora offline: ack FAILED com o motivo, indicador, recuo local; depois imprime 1 vez
        static void PrinterOffline()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var order = Order("B", "2002");
                    api.AddJob("j2", order);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.Offline };
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool failed = WaitFor(() => api.AcksOf("j2", "FAILED") >= 1 && rig.LastProblem() == "#2002", 20000);
                        Thread.Sleep(400);
                        Check("job offline: ack FAILED com o motivo (offline) e indicador '#2002'", failed && (api.JobLastError("j2") ?? "").Contains("offline"));
                        Check("job offline: servidor conta a tentativa e devolve o job a PENDING", api.JobAttempts("j2") >= 1 && api.JobState("j2") != "PRINTED");
                        int claimsBefore = api.ClaimCalls; Thread.Sleep(700);
                        Check("job offline: durante o recuo o cliente NAO reclama (nao segura o job pela lease: o servidor o mantem PENDING para outra impressora)",
                            api.ClaimCalls - claimsBefore <= 1 && api.JobState("j2") == "PENDING" && api.AcksOf("j2", "FAILED") == 1 && printer.Printed.Count == 0);
                        printer.Fault = VirtualFault.None;
                        rig.Now = rig.Now.AddSeconds(20); // passou o recuo de 15 s
                        bool printed = WaitFor(() => printer.Printed.Count == 1 && api.JobState("j2") == "PRINTED", 20000);
                        Thread.Sleep(300);
                        Check("job offline: impressora voltou => o job volta, imprime 1 vez e fecha com PRINTED", printed && printer.Printed.Count == 1);
                        Check("job offline: o indicador some", WaitFor(() => rig.LastProblem() == "", 5000));
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 4) reimpressao (2a via), aviso de cancelamento e tiquete de teste (sem ticket do servidor)
        static void KindsAndNotices()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var re = SelfTestPrint.Reprint(); re.OrderId = "R"; re.Code = "3003";
                    var cancel = SelfTestPrint.CancelFixture(); cancel.OrderId = "C"; cancel.Code = "3004";
                    api.AddJob("j3", re, "ORDER_REPRINT");
                    api.AddJob("j4", cancel, "ORDER_REPRINT");
                    api.AddJob("j5", null, "TEST");
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("j3") == "PRINTED" && api.JobState("j4") == "PRINTED" && api.JobState("j5") == "PRINTED", 30000);
                        Thread.Sleep(300);
                        Check("job: reimpressao, cancelamento e teste imprimem e fecham (3 tiquetes, cada um 1 vez)", done && printer.Printed.Count == 3);
                        var all = new[] { Read(printer.Printed, 0), Read(printer.Printed, 1), Read(printer.Printed, 2) };
                        Check("job ORDER_REPRINT: sai '2ª VIA (1)' e '1ª impressão'", all[0] != null && all[0].Contains("2ª VIA (1)") && all[0].Contains("1ª impressão"));
                        Check("job com cancelNotice: sai o aviso 'CANCELADO' sem itens nem valores", all[1] != null && all[1].Contains("CANCELADO") && !all[1].Contains("Calabresa") && !all[1].Contains("R$"));
                        Check("job TEST sem ticket do servidor: sai o tiquete de teste proprio (acentos, regua, sem dados de pedido)", all[2] != null && all[2].Contains("TESTE DE IMPRESSÃO") && all[2].Contains("ação") && !all[2].Contains("PEDIDO") && !all[2].Contains("R$ 0,00"));
                        Check("job: original e 2a via do mesmo pedido sao jobs diferentes (chave por job, nao por pedido)", rig.Ledger.IsPrinted("job:j3") && rig.Ledger.IsPrinted("job:j4"));
                        Check("job: alerta sonoro so para ORDER_KITCHEN (reimpressao, cancelamento e teste NAO alertam)", rig.Alerts == 0);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 4b) ORDER_CANCEL_NOTICE: a API-12 emite o aviso de cancelamento como job proprio (achado da conferencia cruzada
        // com a API real: o cliente recusava esse tipo e a cozinha nunca saberia que o pedido foi cancelado).
        static void CancelNoticeKind()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var withFlag = SelfTestPrint.CancelFixture(); withFlag.OrderId = "X"; withFlag.Code = "3101";
                    var noFlag = SelfTestPrint.Basic(); noFlag.OrderId = "Y"; noFlag.Code = "3102"; // servidor esqueceu a bandeira: o TIPO do job manda
                    api.AddJob("n1", withFlag, "ORDER_CANCEL_NOTICE");
                    api.AddJob("n2", noFlag, "ORDER_CANCEL_NOTICE");
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("n1") == "PRINTED" && api.JobState("n2") == "PRINTED", 30000);
                        Thread.Sleep(300);
                        Check("ORDER_CANCEL_NOTICE: aceito, imprime e fecha com PRINTED (nao e recusado como tipo desconhecido)", done && printer.Printed.Count == 2);
                        var t1 = Read(printer.Printed, 0); var t2 = Read(printer.Printed, 1);
                        Check("ORDER_CANCEL_NOTICE com cancelNotice: sai o aviso 'CANCELADO', sem itens nem valores", t1 != null && t1.Contains("CANCELADO") && !t1.Contains("Calabresa") && !t1.Contains("R$"));
                        Check("ORDER_CANCEL_NOTICE SEM a bandeira no tiquete: ainda sai so o aviso (nunca um pedido completo)", t2 != null && t2.Contains("CANCELADO") && !t2.Contains("Calabresa") && !t2.Contains("R$"));
                        Check("ORDER_CANCEL_NOTICE: nao ha ack FAILED e o ledger fecha o job", !api.AllAckBodies().Contains("FAILED") && rig.Ledger.IsPrinted("job:n1") && rig.Ledger.IsPrinted("job:n2"));
                        Check("ORDER_CANCEL_NOTICE: sem alerta sonoro de 'novo pedido'", rig.Alerts == 0);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 5) tipo desconhecido (TAB_BILL e do PC-08) e job sem ticket: ack FAILED, nada impresso
        static void UnknownKindAndMissingTicket()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.AddJob("j6", Order("U", "4004"), "TAB_BILL");
                    api.AddJob("j7", null, "ORDER_KITCHEN");
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.AcksOf("j6", "FAILED") >= 1 && api.AcksOf("j7", "FAILED") >= 1, 20000);
                        Check("job de tipo desconhecido: ack FAILED 'nao suportado' (codigo OTHER) e NADA impresso", done && (api.JobLastError("j6") ?? "").Contains("não suportado") && api.JobLastCode("j6") == "OTHER" && printer.Printed.Count == 0);
                        Check("job sem ticket: ack FAILED 'tiquete ausente' e nada impresso", (api.JobLastError("j7") ?? "").Contains("ausente") && printer.Printed.Count == 0);
                        Check("job recusado nao fica em 'sem imprimir' no painel local (erro do servidor, nao da impressora)", rig.ProblemCount == 0);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 6) a impressao demora mais que a lease: o cliente NAO reclama o mesmo job de novo enquanto imprime; o ack volta 409;
        //    o servidor re-oferece, o cliente reconhece que ja imprimiu e so reenvia PRINTED (nunca reimprime)
        static void LeaseExpiredBeforeAck()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi { LeaseMs = 1000 })
                {
                    api.AddJob("j8", Order("L", "5005"));
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { DelayMs = 2600 };
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool first = WaitFor(() => api.AcksOf("j8", "PRINTED") >= 1, 25000);
                        Check("lease vencida: durante a impressao o cliente nao reclama o mesmo job de novo (1 so claim ate o fim da impressao)", first && api.ClaimCalls >= 1);
                        Check("lease vencida: o 1o ack vem DEPOIS da lease e o servidor responde 409; o cliente avisa", rig.HasMessage("lease vencida"));
                        Check("lease vencida: avisa que a impressao passou da lease", rig.HasMessage("demorou mais que a lease"));
                        bool closed = WaitFor(() => api.JobState("j8") == "PRINTED", 25000);
                        Thread.Sleep(500);
                        Check("lease vencida: o servidor re-oferece, o cliente reenvia PRINTED e o job fecha", closed);
                        Check("lease vencida: impresso UMA vez so (nunca reimprime), ledger sabe", printer.Printed.Count == 1 && rig.Ledger.IsPrinted("job:j8"));
                        Check("lease vencida: sem laco de ack (poucos acks)", api.AcksOf("j8", "PRINTED") <= 3);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 7) servidor re-oferece um job que ja imprimimos (ack perdido, lease vencida): NAO reimprime, so reenvia PRINTED
        static void ReofferedAfterPrinted()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi { LeaseMs = 700 })
                {
                    var order = Order("O", "6006");
                    var job = api.AddJob("j9", order);
                    api.JobAckStatus = 500; api.JobAckFailFirst = 1;   // o 1o ack falha (rede/erro)
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool printed = WaitFor(() => printer.Printed.Count == 1, 20000);
                        // espera a lease vencer no servidor e o job ser oferecido de novo
                        bool closed = WaitFor(() => api.JobState("j9") == "PRINTED", 25000);
                        Thread.Sleep(500);
                        Check("job re-oferecido depois de impresso: NAO reimprime (1 tiquete so)", printed && printer.Printed.Count == 1);
                        Check("job re-oferecido: reenvia PRINTED e o servidor fecha o job", closed && api.AcksOf("j9", "PRINTED") >= 2);
                        Check("job re-oferecido: sem ack pendente no ledger no fim", WaitFor(() => rig.Ledger.PendingAcks().Count == 0, 5000));
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 8) ack com falha de rede fica pendente em disco; reiniciar o app nao reimprime e o ack sai
        static void AckRetriedAndRestart()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var order = Order("K", "7007");
                    api.AddJob("j10", order);
                    api.JobAckStatus = 500; api.JobAckFailFirst = 3;   // os 3 primeiros acks falham
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    var ledgerPath = Path.Combine(dir, "printed.json");
                    using (var rig1 = new Rig(api, printer, ledgerPath, "mcd_impressora1_segredo"))
                    {
                        rig1.Start();
                        bool printed = WaitFor(() => printer.Printed.Count == 1 && api.JobAckCalls >= 1, 20000);
                        Check("ack de job com falha: imprimiu e o ack ficou PENDENTE em disco (chave job:)", printed && rig1.Ledger.PendingAcks().Contains("job:j10"));
                    }
                    Thread.Sleep(200);
                    using (var rig2 = new Rig(api, printer, ledgerPath, "mcd_impressora1_segredo"))
                    {
                        Check("reinicio: o ack pendente do job sobreviveu em disco", rig2.Ledger.PendingAcks().Contains("job:j10") || api.JobState("j10") == "PRINTED");
                        rig2.Start();
                        bool closed = WaitFor(() => api.JobState("j10") == "PRINTED" && rig2.Ledger.PendingAcks().Count == 0, 25000);
                        Thread.Sleep(400);
                        Check("reinicio: reabriu, repetiu o ack ate passar e NAO reimprimiu", closed && printer.Printed.Count == 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 9) duas impressoras (tokens diferentes) na mesma loja: cada job sai exatamente uma vez no total
        static void TwoPrinters()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    for (int i = 1; i <= 8; i++) api.AddJob("m" + i, Order("M" + i, "80" + i));
                    var p1 = new VirtualPrintTarget(Path.Combine(dir, "out1")) { DelayMs = 60 };
                    var p2 = new VirtualPrintTarget(Path.Combine(dir, "out2")) { DelayMs = 60 };
                    using (var r1 = new Rig(api, p1, null, "mcd_impressora1_segredo", 40))
                    using (var r2 = new Rig(api, p2, null, "mcd_impressora2_segredo", 40))
                    {
                        r1.Start(); r2.Start();
                        bool all = WaitFor(() => Enumerable.Range(1, 8).All(i => api.JobState("m" + i) == "PRINTED"), 30000);
                        Thread.Sleep(500);
                        Check("duas impressoras: os 8 jobs foram impressos e fechados", all);
                        Check("duas impressoras: cada job saiu em UMA impressora so (8 tiquetes no total, sem duplicidade)", p1.Printed.Count + p2.Printed.Count == 8);
                        Check("duas impressoras: o servidor distribuiu o trabalho entre as duas", p1.Printed.Count >= 1 && p2.Printed.Count >= 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 10) chave recusada no claim segue a regra do PC-05 (pausa so depois da janela)
        static void AuthRevoked()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi { ClaimStatus = 401 })
                {
                    api.AddJob("x1", Order("X", "9009"));
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", 60))
                    {
                        rig.Device.AuthFailureWindow = TimeSpan.FromMilliseconds(500);
                        rig.Start();
                        bool paused = WaitFor(() => rig.Device.IsRevoked, 15000);
                        Check("claim com 401 seguido por mais que a janela: pausa (chave recusada), nada impresso", paused && printer.Printed.Count == 0);
                        int calls = api.ClaimCalls; Thread.Sleep(600);
                        Check("claim pausado: nao martela a API", api.ClaimCalls - calls <= 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 11) enquanto o job esta em recuo de falha, o cliente nao reclama nada (sem laco quente e sem segurar o job)
        static void NoHotLoop()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.AddJob("h1", Order("H", "1100"));
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = VirtualFault.Offline };
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", 40))
                    {
                        rig.Start();
                        WaitFor(() => api.AcksOf("h1", "FAILED") >= 1, 20000);
                        Thread.Sleep(150);
                        int before = api.ClaimCalls; Thread.Sleep(1500);
                        Check("recuo: em 1,5 s (37 ciclos de 40 ms) o cliente fez no maximo 1 claim (sem laco quente)", api.ClaimCalls - before <= 1);
                        Check("recuo: o job continua PENDING no servidor (outra impressora poderia pegar) e so houve 1 FAILED", api.JobState("h1") == "PENDING" && api.AcksOf("h1", "FAILED") == 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 11b) duas impressoras: a que falhou nao segura o job; a outra imprime
        static void FailedPrinterDoesNotHoldJob()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.AddJob("f1", Order("F", "1300"));
                    var bad = new VirtualPrintTarget(Path.Combine(dir, "bad")) { Fault = VirtualFault.Offline };
                    var good = new VirtualPrintTarget(Path.Combine(dir, "good"));
                    using (var rbad = new Rig(api, bad, null, "mcd_impressora1_segredo", 40))
                    {
                        rbad.Start();
                        WaitFor(() => api.AcksOf("f1", "FAILED") >= 1, 20000);
                        using (var rgood = new Rig(api, good, null, "mcd_impressora2_segredo", 40))
                        {
                            rgood.Start();
                            bool done = WaitFor(() => api.JobState("f1") == "PRINTED" && good.Printed.Count == 1, 20000);
                            Thread.Sleep(300);
                            Check("impressora com defeito nao segura o job: a outra impressora assume e imprime 1 vez", done && good.Printed.Count == 1 && bad.Printed.Count == 0);
                        }
                    }
                }
            }
            finally { Clean(dir); }
        }

        // O que sai do computador da loja no ack FAILED e SO o codigo da lista fechada + frase fixa nossa (ADR-0004 §8 item 8):
        // a mensagem da excecao (nome de impressora/servidor, caminho, usuario do Windows) fica no log local.
        sealed class ThrowingTarget : IPrintTarget
        {
            readonly Func<Exception> _make; public ThrowingTarget(Func<Exception> make) { _make = make; }
            public void Print(TicketDocument document) { throw _make(); }
        }

        static void FailureReportsOnlyCodes()
        {
            const string leak = @"Acesso negado a \\SERVIDOR\HP-Joao em C:\Users\joao.silva\AppData\spool";
            var cases = new[]
            {
                new { id = "e1", make = (Func<Exception>)(() => new InvalidOperationException(leak)), code = "OTHER", phrase = "falha na impressão", label = "excecao qualquer (texto de terceiros)" },
                new { id = "e2", make = (Func<Exception>)(() => new PrinterUnavailableException(leak, "DRIVER_ERROR")), code = "DRIVER_ERROR", phrase = "erro do driver da impressora", label = "erro de driver" },
                new { id = "e3", make = (Func<Exception>)(() => new PrinterUnavailableException(leak, "<script>alert(1)</script>")), code = "OTHER", phrase = "falha na impressão", label = "codigo fora da lista (normalizado)" },
                new { id = "e4", make = (Func<Exception>)(() => new PrinterUnavailableException(leak, "PRINTER_NOT_FOUND")), code = "PRINTER_NOT_FOUND", phrase = "impressora não encontrada", label = "impressora nao encontrada" },
            };
            foreach (var c in cases)
            {
                var dir = Tmp();
                try
                {
                    using (var api = new FakeApi())
                    {
                        api.AddJob(c.id, Order("E", "9" + c.id));
                        using (var rig = new Rig(api, new VirtualPrintTarget(Path.Combine(dir, "out")), null, "mcd_impressora1_segredo"))
                        {
                            // troca o destino de impressao por um que lanca a excecao do caso
                            var coord = new PrintCoordinator(rig.Device, new ThrowingTarget(c.make), () => 58, SelfTestPrint.Tz);
                            coord.Message += m => { lock (rig.Messages) rig.Messages.Add(m); };
                            rig.Device.TicketReady -= rig.OnTicket;
                            rig.Device.TicketReady += o => System.Threading.Tasks.Task.Run(() => coord.Handle(o));
                            rig.Start();
                            bool acked = WaitFor(() => api.AcksOf(c.id, "FAILED") >= 1, 20000);
                            var bodies = api.AllAckBodies();
                            Check("erro so codigo (" + c.label + "): o ack FAILED leva code=" + c.code + " e a frase fixa", acked && api.JobLastCode(c.id) == c.code && api.JobLastError(c.id) == c.phrase);
                            Check("erro so codigo (" + c.label + "): NADA do texto da excecao sai da maquina (sem servidor, usuario, caminho, impressora nem script)",
                                acked && !bodies.Contains("SERVIDOR") && !bodies.Contains("joao") && !bodies.Contains("HP-") && !bodies.Contains("C:\\") && !bodies.Contains("spool") && !bodies.Contains("script"));
                            Check("erro so codigo (" + c.label + "): o DETALHE segue disponivel no log local (mensagem da tela)", rig.HasMessage("SERVIDOR"));
                        }
                    }
                }
                finally { Clean(dir); }
            }

            // codigos das falhas SIMULADAS da impressora virtual (e do tipo desconhecido, que nao ecoa o tipo recebido)
            foreach (var f in new[] { new { fault = VirtualFault.Offline, code = "PRINTER_OFFLINE" }, new { fault = VirtualFault.OutOfPaper, code = "NO_PAPER" }, new { fault = VirtualFault.DropMidJob, code = "PRINTER_OFFLINE" } })
            {
                var dir = Tmp();
                try
                {
                    using (var api = new FakeApi())
                    {
                        api.AddJob("v1", Order("V", "9100"));
                        using (var rig = new Rig(api, new VirtualPrintTarget(Path.Combine(dir, "out")) { Fault = f.fault }, null, "mcd_impressora1_segredo"))
                        {
                            rig.Start();
                            bool acked = WaitFor(() => api.AcksOf("v1", "FAILED") >= 1, 20000);
                            Check("codigo da falha simulada " + f.fault + " => " + f.code, acked && api.JobLastCode("v1") == f.code);
                        }
                    }
                }
                finally { Clean(dir); }
            }
            var dirK = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.AddJob("k9", Order("K", "9200"), "EVIL<script>kind");
                    using (var rig = new Rig(api, new VirtualPrintTarget(Path.Combine(dirK, "out")), null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool acked = WaitFor(() => api.AcksOf("k9", "FAILED") >= 1, 20000);
                        var bodies = api.AllAckBodies();
                        Check("tipo de job desconhecido NAO e ecoado de volta ao servidor (frase fixa, codigo OTHER)", acked && !bodies.Contains("EVIL") && !bodies.Contains("script") && api.JobLastCode("k9") == "OTHER");
                    }
                }
            }
            finally { Clean(dirK); }

            // unidade: lista fechada
            Check("PrintFailure: a lista fechada tem 5 codigos e Normalize manda o resto para OTHER (inclusive nulo, vazio e minusculas validas)",
                PrintFailure.All.Length == 5 && PrintFailure.Normalize(null) == "OTHER" && PrintFailure.Normalize("") == "OTHER" && PrintFailure.Normalize("hack") == "OTHER"
                && PrintFailure.Normalize("no_paper") == "NO_PAPER" && PrintFailure.Normalize(" PRINTER_OFFLINE ") == "PRINTER_OFFLINE");
            Check("PrintFailure: toda frase e nossa, em portugues, sem caminho e sem barra invertida", PrintFailure.All.All(code => PrintFailure.Phrase(code).Length > 5 && !PrintFailure.Phrase(code).Contains("\\") && !PrintFailure.Phrase(code).Contains(":")));
            Check("PrinterProbe.CodeOf: offline => PRINTER_OFFLINE, sem papel => NO_PAPER, o resto => OTHER",
                PrinterProbe.CodeOf(true, 3, 2) == "PRINTER_OFFLINE" && PrinterProbe.CodeOf(false, 7, 2) == "PRINTER_OFFLINE" && PrinterProbe.CodeOf(false, 3, 4) == "NO_PAPER" && PrinterProbe.CodeOf(false, 3, 7) == "OTHER" && PrinterProbe.CodeOf(false, 6, 2) == "OTHER");
            string noPrinterCode; PrinterProbe.Check("", out noPrinterCode);
            Check("PrinterProbe: sem impressora selecionada => PRINTER_NOT_FOUND", noPrinterCode == "PRINTER_NOT_FOUND");
        }

        // ---- ADR-0004 §8 como TABELA DE CONTRATO sobre o servidor falso (o Turing pode reaproveitar estes casos na API-12) ----
        static string Post(FakeApi api, string path, string body, string auth, out int status)
        {
            using (var http = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(15) })
            using (var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, "http://127.0.0.1:" + api.Port + path))
            {
                req.Headers.TryAddWithoutValidation("Authorization", auth);
                req.Content = new System.Net.Http.StringContent(body, System.Text.Encoding.UTF8, "application/json");
                var resp = http.SendAsync(req).Result;
                status = (int)resp.StatusCode;
                return resp.Content.ReadAsStringAsync().Result;
            }
        }
        static Newtonsoft.Json.Linq.JToken Job(string json) { return Newtonsoft.Json.Linq.JObject.Parse(json)["job"]; }

        // Claim repetido ate o servidor oferecer um job (apos o availableAt do recuo): espera por evento, nao por tempo fixo.
        static string ClaimWhenAvailable(FakeApi api, string auth, int timeoutMs, out int status)
        {
            var end = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            string r = null; status = 0;
            while (DateTime.UtcNow < end)
            {
                r = Post(api, "/api/device/print-jobs/claim", "{}", auth, out status);
                if (status == 200 && Job(r).Type != Newtonsoft.Json.Linq.JTokenType.Null) return r;
                Thread.Sleep(100);
            }
            return r;
        }

        static void ContractTable()
        {
            // Imune a pausa de CPU (PC-20): a lease e GENEROSA (60 s) em tudo, menos no unico trecho que TESTA o vencimento (aquele so
            // fica mais correto com um engasgo), e o recuo do servidor e de 2 s com a espera por EVENTO (claim ate o job aparecer),
            // nao por Sleep fixo. Com lease de 700 ms um engasgo da maquina vencia a lease entre o claim e o ack e derrubava em cascata
            // 5 verificacoes (achado do Deming, 1 rodada em 3).
            using (var api = new FakeApi { LeaseMs = 60000, FailBackoffMs = 2000 })
            {
                const string A = "Bearer mcd_a_x", B = "Bearer mcd_b_y";
                api.AddJob("c1", Order("C1", "1"));
                int st; string r;
                r = Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                var first = Job(r);
                Check("contrato §8.2: claim devolve {job:{id,kind,attempt,leaseSeconds,ticket}} com attempt 1", st == 200 && (string)first["id"] == "c1" && (int)first["attempt"] == 1 && first["ticket"] != null && first["kind"] != null);
                Check("contrato §8.1: leaseSeconds e RELATIVO (inteiro, nao data) e o ticket traz o schema do tiquete", (int)first["leaseSeconds"] >= 1 && (string)first["ticket"]["code"] == "1");
                r = Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                Check("contrato §8.4: mesmo dono, lease valida => devolve o MESMO job sem incrementar attempt", st == 200 && (string)Job(r)["id"] == "c1" && (int)Job(r)["attempt"] == 1 && api.JobAttempts("c1") == 1);
                r = Post(api, "/api/device/print-jobs/claim", "{}", A, out st);
                Check("contrato: outro token nao recebe um job CLAIMED por alguem com lease valida (200 {job:null})", st == 200 && Job(r).Type == Newtonsoft.Json.Linq.JTokenType.Null);
                r = Post(api, "/api/device/print-jobs/c1/ack", "{\"status\":\"PRINTED\"}", A, out st);
                Check("contrato §8.5: ack de OUTRO dono => 409", st == 409 && api.JobState("c1") == "CLAIMED");
                r = Post(api, "/api/device/print-jobs/c1/ack", "{\"status\":\"FAILED\",\"error\":\"sem papel\"}", B, out st);
                Check("contrato §8.3: FAILED do dono => 200 e o job volta a PENDING (attempts < max)", st == 200 && api.JobState("c1") == "PENDING" && api.JobLastError("c1") == "sem papel");
                r = Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                Check("contrato §8.3: o claim NAO devolve o job antes do availableAt (recuo do servidor)", st == 200 && Job(r).Type == Newtonsoft.Json.Linq.JTokenType.Null);
                r = ClaimWhenAvailable(api, B, 20000, out st);
                Check("contrato §8.3: depois do availableAt o job volta, com attempt 2", st == 200 && (string)Job(r)["id"] == "c1" && (int)Job(r)["attempt"] == 2);
                r = Post(api, "/api/device/print-jobs/c1/ack", "{\"status\":\"PRINTED\"}", B, out st);
                Check("contrato: ack PRINTED do dono com lease valida => 200 e o job fica PRINTED", st == 200 && api.JobState("c1") == "PRINTED");
                r = Post(api, "/api/device/print-jobs/c1/ack", "{\"status\":\"PRINTED\"}", B, out st);
                Check("contrato §8.5: ack repetido do dono => 200 idempotente", st == 200 && api.JobState("c1") == "PRINTED");
                r = Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                Check("contrato §8.4: o claim NUNCA devolve job PRINTED", st == 200 && Job(r).Type == Newtonsoft.Json.Linq.JTokenType.Null);
                r = Post(api, "/api/device/print-jobs/nao-existe/ack", "{\"status\":\"PRINTED\"}", B, out st);
                Check("contrato §8.5: job inexistente => 404", st == 404);
                // lease vencida => 409 (so aqui a lease e curta: um engasgo so a deixa mais vencida)
                api.LeaseMs = 700;
                api.AddJob("c2", Order("C2", "2"));
                Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                Thread.Sleep(900); // passa a lease de 700 ms
                r = Post(api, "/api/device/print-jobs/c2/ack", "{\"status\":\"PRINTED\"}", B, out st);
                Check("contrato §8.5: ack com a lease vencida => 409 (o job volta a PENDING)", st == 409 && api.JobState("c2") == "PENDING");
                // o c2 (mais antigo) voltou a PENDING: reclama e fecha, senao o claim do c3 pegaria o c2
                api.LeaseMs = 60000;
                r = Post(api, "/api/device/print-jobs/claim", "{}", B, out st);
                Post(api, "/api/device/print-jobs/c2/ack", "{\"status\":\"PRINTED\"}", B, out st);
                Check("contrato: depois do 409 o job vencido e reoferecido e fecha com PRINTED", (string)Job(r)["id"] == "c2" && st == 200 && api.JobState("c2") == "PRINTED");
                // estourar attempts => FAILED definitivo
                api.AddJob("c3", Order("C3", "3"), "ORDER_KITCHEN");
                for (int i = 0; i < 3; i++)
                {
                    ClaimWhenAvailable(api, B, 20000, out st);
                    Post(api, "/api/device/print-jobs/c3/ack", "{\"status\":\"FAILED\",\"error\":\"x\"}", B, out st);
                }
                Check("contrato §8.3: ao estourar o maximo de tentativas (3) o job vira FAILED definitivo", api.JobState("c3") == "FAILED" && api.JobAttempts("c3") == 3);
            }
        }

        // §8.4 no cliente: o app caiu depois do claim (resposta perdida / reinicio); o novo claim devolve o MESMO job (attempt 1)
        // e o cliente imprime sem consumir tentativa.
        static void ReclaimedBySameOwner()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var order = Order("S", "1500");
                    api.AddJob("s1", order);
                    int st;
                    Post(api, "/api/device/print-jobs/claim", "{}", Tok, out st); // "processo anterior" reclamou e caiu antes de imprimir
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("s1") == "PRINTED" && printer.Printed.Count == 1, 20000);
                        Thread.Sleep(300);
                        Check("reinicio depois do claim: o claim devolve o MESMO job e o cliente imprime 1 vez", done && printer.Printed.Count == 1 && Read(printer.Printed) == Expected(order));
                        Check("reinicio depois do claim: nao gastou tentativa (attempt continua 1)", api.JobAttempts("s1") == 1);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // §8.3: um job que falha sempre NAO trava a fila: o servidor so o devolve depois do availableAt e o proximo job sai.
        static void BadJobDoesNotBlockQueue()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi { FailBackoffMs = 250 })
                {
                    api.AddJob("bad", null, "ORDER_KITCHEN");                 // sem ticket: o cliente responde FAILED a cada tentativa
                    var good = Order("Q", "1600");
                    api.AddJob("good", good);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", 40))
                    {
                        rig.Start();
                        bool goodDone = WaitFor(() => api.JobState("good") == "PRINTED", 20000);
                        bool badDead = WaitFor(() => api.JobState("bad") == "FAILED", 20000);
                        Thread.Sleep(300);
                        Check("job ruim nao trava a fila: o job seguinte e impresso", goodDone && printer.Printed.Count == 1 && Read(printer.Printed) == Expected(good));
                        Check("job ruim: depois de 3 tentativas o servidor o marca FAILED definitivo e o cliente parou de pedi-lo", badDead && api.JobAttempts("bad") == 3 && api.AcksOf("bad", "FAILED") == 3);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // §8.2: TEST leva ticket (mesmo schema, conteudo fixo e ficticio): imprime pelo caminho normal de tiquete
        static void TestJobWithTicket()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var t = new PrintableOrder { OrderId = "t", Code = "TESTE", Type = "BALCAO", StoreName = "Loja de Teste", TotalCents = 1000, Items = new List<PrintableOrderItem> { new PrintableOrderItem { ProductName = "Item de teste", Quantity = 1, UnitPriceCents = 1000 } }, PaymentMethod = "DINHEIRO", PaymentStatus = "A_COBRAR", CustomerName = "Fulana Segredo", CustomerPhone = "(11) 98888-7777", Address = "Rua Reservada 123", Notes = "OBS-DO-SERVIDOR", CreatedAt = "2026-11-16T12:00:00Z" };
                    api.AddJob("t1", t, "TEST");
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo"))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("t1") == "PRINTED" && printer.Printed.Count == 1, 20000);
                        var paper = Read(printer.Printed) ?? "";
                        Check("job TEST com ticket do servidor: sai o tiquete de teste PROPRIO e o job fecha", done && paper.Contains("TESTE DE IMPRESSÃO") && paper.Contains("Loja de Teste"));
                        Check("job TEST: ignora valor, pagamento, itens e contato (nome, telefone, endereco, observacao) do servidor (nunca 'COBRAR' nem 'Item de teste' no papel de teste)", !paper.Contains("COBRAR") && !paper.Contains("Item de teste") && !paper.Contains("TOTAL") && !paper.Contains("10,00")
                            && !paper.Contains("Fulana") && !paper.Contains("98888") && !paper.Contains("Reservada") && !paper.Contains("OBS-DO-SERVIDOR"));
                        Check("job TEST: nao alerta (so ORDER_KITCHEN alerta)", rig.Alerts == 0);
                    }
                }
            }
            finally { Clean(dir); }
        }

        // 12) UsePrintJobs desligado (padrao): o cliente continua no /pending e nunca chama o claim
        static void LegacyUnchanged()
        {
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    var order = Order("G", "1200");
                    api.Pending.Add(new[] { order.OrderId, order.Code });
                    api.PrintableBody = o => Newtonsoft.Json.JsonConvert.SerializeObject(new PrintableOrderResponse { Order = order });
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    var ledger = new PrintLedger(null);
                    var settings = new AppSettings { ApiBaseUrl = "http://127.0.0.1:" + api.Port, DeviceToken = "mcd_x_y" }; // UsePrintJobs padrao = false
                    using (var dc = new DeviceClient(ledger, settings) { PollIntervalMs = 60, WsRetryMs = 150 })
                    {
                        var coord = new PrintCoordinator(dc, printer, () => 58, SelfTestPrint.Tz);
                        dc.TicketReady += o => System.Threading.Tasks.Task.Run(() => coord.Handle(o));
                        dc.Start();
                        bool done = WaitFor(() => printer.Printed.Count == 1 && api.Pending.Count == 0, 20000);
                        Thread.Sleep(300);
                        Check("padrao (UsePrintJobs desligado): continua no /pending antigo e imprime", done && printer.Printed.Count == 1);
                        Check("padrao: nunca chama o claim de PrintJob", api.ClaimCalls == 0 && !new AppSettings().UsePrintJobs);
                    }
                }
            }
            finally { Clean(dir); }
        }
        // ===============================================================================================================
        // PC-18: o modo (LEGACY x QUEUE) vem do servidor, por loja (ADR-0004 §8 itens 12-13). Contrato executavel no FakeApi:
        //   LEGACY: claim devolve {job:null, mode:"LEGACY"}; endpoint legado funciona.
        //   QUEUE : claim normal com mode; endpoint legado responde 409 MODE_QUEUE.
        // O cliente comeca no modo de UsePrintJobs (interruptor de desenvolvimento) e segue o servidor.
        // ===============================================================================================================
        static int Paper(VirtualPrintTarget p, string code)
        {
            string[] files; lock (p.Printed) files = p.Printed.ToArray();
            return files.Count(f => { try { return File.ReadAllText(f).Contains("#" + code); } catch { return false; } });
        }
        static void LegacyOrder(FakeApi api, PrintableOrder o)
        {
            lock (api.Lock) api.Pending.Add(new[] { o.OrderId, o.Code });
            var known = new Dictionary<string, PrintableOrder>();
            var prev = api.PrintableBody;
            api.PrintableBody = x => x[0] == o.OrderId ? Newtonsoft.Json.JsonConvert.SerializeObject(new PrintableOrderResponse { Order = o }) : (prev != null ? prev(x) : "{}");
        }
        static int PendingCount(FakeApi api) { lock (api.Lock) return api.Pending.Count; }

        static void ModeFollowsServer()
        {
            // M1: servidor LEGACY, cliente no padrao: imprime pelo legado e NUNCA chama o claim.
            var dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY";
                    var o = Order("M1", "5101"); LegacyOrder(api, o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool done = WaitFor(() => Paper(printer, "5101") == 1 && PendingCount(api) == 0, 20000);
                        Thread.Sleep(300);
                        Check("modo: servidor LEGACY e cliente padrao: imprime pelo legado 1 vez", done && Paper(printer, "5101") == 1);
                        Check("modo: em LEGACY o cliente nunca pede job (claim nao e chamado)", api.ClaimCalls == 0 && rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                    }
                }
            }
            finally { Clean(dir); }

            // M2: cliente no legado, servidor passa a QUEUE (legado responde 409 MODE_QUEUE): o cliente troca sozinho e imprime o JOB.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE"; api.ConfigEnabled = false; api.PendingEmptyInQueue = false;   // cinto: API sem config e legado com 409
                    var o = Order("M2", "5102");
                    api.AddJob("m2", o);
                    lock (api.Lock) api.Pending.Add(new[] { o.OrderId, o.Code });   // o servidor ainda lista o pedido, mas o legado esta fechado
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    int changes = 0;
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.ModeChanged += m => Interlocked.Increment(ref changes);
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("m2") == "PRINTED" && Paper(printer, "5102") == 1, 20000);
                        Thread.Sleep(300);
                        Check("modo: cliente no legado, servidor QUEUE (409 MODE_QUEUE): troca sozinho e imprime o job 1 vez", done && Paper(printer, "5102") == 1);
                        Check("modo: ficou em QUEUE, avisou a troca 1 vez e nunca buscou o tiquete legado", rig.Device.CurrentMode == DeviceClient.ModeQueue && changes == 1 && api.Count("/printable") == 0);
                        Check("modo: 409 MODE_QUEUE nao conta como chave recusada nem como erro", !rig.Device.IsRevoked && !rig.HasMessage("Erro ("));
                    }
                }
            }
            finally { Clean(dir); }

            // M3: cliente na fila, servidor LEGACY: o claim responde mode LEGACY, o cliente volta ao legado no mesmo ciclo; o job NAO e impresso.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY";
                    var o = Order("M3", "5103"); LegacyOrder(api, o);
                    api.AddJob("m3", o);   // o servidor existe com job, mas em LEGACY nunca o entrega
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool done = WaitFor(() => Paper(printer, "5103") >= 1 && PendingCount(api) == 0, 20000);
                        Thread.Sleep(400);
                        Check("modo: cliente na fila, servidor LEGACY (claim com mode LEGACY): volta ao legado e imprime o pedido 1 vez", done && Paper(printer, "5103") == 1 && rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                        Check("modo: o job nunca foi entregue nem impresso em LEGACY (e o ack legado fechou o job do pedido)", api.JobAttempts("m3") == 0 && api.JobState("m3") == "PRINTED" && api.AcksOf("m3", "PRINTED") == 0);
                    }
                }
            }
            finally { Clean(dir); }

            // M4: virada no meio da impressao LEGACY -> QUEUE. O pedido em impressao nao pode ser reclamado como job; o aviso legado
            // chega depois da troca (409 MODE_QUEUE) e e encerrado; o job do mesmo pedido so recebe PRINTED (cinto), sem 2o tiquete.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY";
                    var o = Order("M4", "5104"); LegacyOrder(api, o);
                    api.AddJob("m4", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { DelayMs = 1500 };
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool started = WaitFor(() => api.Count("/printable") >= 1, 20000);
                        api.PrintMode = "QUEUE";                       // a loja virou no meio da impressao
                        Thread.Sleep(500);
                        int claimsWhilePrinting = api.ClaimCalls;
                        bool done = WaitFor(() => api.JobState("m4") == "PRINTED" && Paper(printer, "5104") >= 1, 30000);
                        Thread.Sleep(500);
                        Check("virada no meio da impressao: nao pede job enquanto o pedido legado esta em impressao", started && claimsWhilePrinting == 0);
                        Check("virada no meio da impressao: o pedido sai 1 vez so (o job do mesmo pedido nao reimprime)", done && Paper(printer, "5104") == 1);
                        int legacyAcks1 = api.Count("/printed"); Thread.Sleep(1000); int legacyAcks2 = api.Count("/printed");
                        Check("virada no meio da impressao: job fechado com PRINTED (cinto) e o aviso legado 409 encerra sem laco (avisos: " + legacyAcks1 + " e depois " + legacyAcks2 + ")", api.AcksOf("m4", "PRINTED") >= 1 && legacyAcks1 >= 1 && legacyAcks2 == legacyAcks1 && legacyAcks2 <= 2 && rig.Ledger.PendingAcks().Count == 0);
                    }
                }
            }
            finally { Clean(dir); }

            // M5: virada no meio da impressao de um JOB (QUEUE -> LEGACY). O legado so roda depois do job fechado e acked.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE";
                    var o = Order("M5", "5105"); LegacyOrder(api, o);   // o servidor tambem lista o pedido no legado (printedAt nulo ate o ack do job)
                    api.AddJob("m5", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { DelayMs = 1500 };
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool started = WaitFor(() => api.JobState("m5") == "CLAIMED", 20000);
                        api.PrintMode = "LEGACY";
                        Thread.Sleep(500);
                        int legacyWhilePrinting = api.LegacyCalls;
                        bool done = WaitFor(() => api.JobState("m5") == "PRINTED" && Paper(printer, "5105") >= 1, 30000);
                        Thread.Sleep(800);
                        Check("virada no meio de um job: o modo so vira LEGACY depois do job (nenhuma chamada legada durante a impressao)", started && legacyWhilePrinting == 0);
                        Check("virada no meio de um job: o pedido sai 1 vez (o legado nao o pega depois)", done && Paper(printer, "5105") == 1 && api.Count("/printable") == 0);
                        Check("virada no meio de um job: depois do job fechado o cliente segue o servidor (LEGACY)", rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                    }
                }
            }
            finally { Clean(dir); }

            // M6: cinto de seguranca. Pedido ja impresso AQUI no legado + job ORDER_KITCHEN do mesmo pedido: so PRINTED, sem papel.
            // Controle: ORDER_REPRINT do mesmo pedido IMPRIME (2a via e legitima).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE";
                    var ledgerPath = Path.Combine(dir, "printed.json");
                    var pre = new PrintLedger(ledgerPath);
                    pre.TryBeginPrint("M6"); pre.MarkPrinted("M6"); pre.MarkAcked("M6");   // impresso e confirmado pelo modo legado
                    var o = Order("M6", "5106");
                    api.AddJob("m6", o);
                    var re = SelfTestPrint.Reprint(); re.OrderId = "M6"; re.Code = "5107";
                    api.AddJob("m6r", re, "ORDER_REPRINT");
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, ledgerPath, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("m6") == "PRINTED" && api.JobState("m6r") == "PRINTED", 20000);
                        Thread.Sleep(300);
                        Check("cinto: job ORDER_KITCHEN de pedido que este PC ja imprimiu no legado NAO reimprime", done && Paper(printer, "5106") == 0);
                        Check("cinto: ... e o servidor recebe PRINTED desse job", api.AcksOf("m6", "PRINTED") >= 1);
                        Check("cinto: a 2a via (ORDER_REPRINT) do mesmo pedido continua imprimindo", Paper(printer, "5107") == 1);
                    }
                }
            }
            finally { Clean(dir); }

            // M7: "mode" desconhecido ou ausente nao muda nada; fila e legado antigos seguem como antes.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "TALVEZ";
                    var o = Order("M7", "5108");
                    api.AddJob("m7", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("m7") == "PRINTED" && Paper(printer, "5108") == 1, 20000);
                        Thread.Sleep(300);
                        Check("modo: valor desconhecido de mode e ignorado (continua na fila e imprime)", done && rig.Device.CurrentMode == DeviceClient.ModeQueue);
                    }
                }
            }
            finally { Clean(dir); }

            // M9: o job foi impresso mas o aviso PRINTED esta falhando (servidor 500); o servidor vira para LEGACY e ainda lista o
            // pedido (printedAt so e gravado quando o ack do job chega). O legado NAO pode reimprimir: o ledger sabe que o job imprimiu.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE";
                    var o = Order("M9", "5109"); LegacyOrder(api, o);
                    api.AddJob("m9", o);
                    api.JobAckStatus = 500; api.JobAckFailFirst = 5;   // os 5 primeiros avisos do job falham
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool printed = WaitFor(() => Paper(printer, "5109") == 1, 20000);
                        api.PrintMode = "LEGACY";                        // virou depois de imprimir, com o aviso ainda pendente
                        bool done = WaitFor(() => api.JobState("m9") == "PRINTED", 30000);
                        Thread.Sleep(800);
                        Check("aviso do job falhando + servidor vira LEGACY: o pedido sai 1 vez so (o legado pula o pedido que o job imprimiu)", printed && done && Paper(printer, "5109") == 1);
                        Check("aviso do job falhando + servidor vira LEGACY: o legado nunca buscou o tiquete desse pedido", api.Count("/printable") == 0);
                    }
                }
            }
            finally { Clean(dir); }

            // M10: aviso do job recusado de forma PERMANENTE (400): encerra, nao repete e nao trava nada (parecer Nightingale a).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE";
                    var o = Order("M10", "5110"); api.AddJob("m10", o);
                    api.JobAckStatus = 400;   // sempre
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: true))
                    {
                        rig.Start();
                        bool printed = WaitFor(() => Paper(printer, "5110") == 1 && api.AcksOf("m10", "PRINTED") >= 1, 20000);
                        Thread.Sleep(1500);
                        int acksSoon = api.AcksOf("m10", "PRINTED"); Thread.Sleep(1500); int acksLater = api.AcksOf("m10", "PRINTED");
                        Check("ack do job recusado de vez (400): sem laco quente (avisos: " + acksSoon + " e depois " + acksLater + " em 1,5 s; 25 ciclos) e nada fica pendente", printed && acksLater - acksSoon <= 40 && rig.Ledger.PendingAcks().Count == 0);
                        Check("ack do job recusado de vez (400): avisa na tela que nao vai repetir", rig.HasMessage("recusou de vez"));
                    }
                }
            }
            finally { Clean(dir); }

            // M11: aviso LEGADO preso para sempre (500, ate em QUEUE) e a loja vira QUEUE: o job do pedido ja impresso NAO reimprime e a fila nao congela.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY"; api.LegacyAck500 = true;
                    var o = Order("M11", "5111"); LegacyOrder(api, o); api.AddJob("m11", o);
                    var o2 = Order("M11b", "5112"); api.AddJob("m11b", o2);   // outro pedido, so como job: tem de sair (a fila nao congela)
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool legacyPrinted = WaitFor(() => Paper(printer, "5111") == 1, 20000);
                        api.PrintMode = "QUEUE";
                        bool jobs = WaitFor(() => api.JobState("m11") == "PRINTED" && api.JobState("m11b") == "PRINTED" && Paper(printer, "5112") == 1, 30000);
                        Thread.Sleep(500);
                        Check("aviso legado preso + loja vira QUEUE: o pedido ja impresso NAO reimprime e o outro job sai (fila nao congela)", legacyPrinted && jobs && Paper(printer, "5111") == 1);
                        Check("aviso legado preso: continua pendente (nao foi descartado) e nao bloqueou ninguem", rig.Ledger.PendingAcks().Contains("M11") && rig.Device.CurrentMode == DeviceClient.ModeQueue);
                    }
                }
            }
            finally { Clean(dir); }

            // M12: o 409 do legado so vale com code == MODE_QUEUE no JSON (R-1): a palavra no texto ou outro code NAO trocam o modo.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE"; api.ConfigEnabled = false; api.PendingEmptyInQueue = false;
                    api.Legacy409Body = "{\"error\":\"MODE_QUEUE na mensagem\",\"code\":\"OUTRO\"}";
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool tried = WaitFor(() => api.LegacyCalls >= 3, 10000);
                        Check("409 com a palavra MODE_QUEUE so no texto e code diferente: NAO troca para a fila", tried && rig.Device.CurrentMode == DeviceClient.ModeLegacy && api.ClaimCalls == 0);
                        api.Legacy409Body = "[1,2,3]";    // JSON que nao e objeto
                        int before = api.LegacyCalls; WaitFor(() => api.LegacyCalls >= before + 3, 10000);
                        Check("409 com corpo que nao e um objeto JSON: NAO troca para a fila", rig.Device.CurrentMode == DeviceClient.ModeLegacy && api.ClaimCalls == 0);
                        api.Legacy409Body = null;         // corpo padrao: code == MODE_QUEUE
                        bool switched = WaitFor(() => rig.Device.CurrentMode == DeviceClient.ModeQueue, 10000);
                        Check("409 com code == MODE_QUEUE: troca para a fila", switched);
                    }
                }
            }
            finally { Clean(dir); }

            // N1 (PC-22, achado da conferencia cruzada com a API-12b real): em QUEUE o /pending devolve 200 e lista VAZIA (nao 409). O cliente
            // PADRAO (comeca no legado) precisa descobrir a fila pela configuracao do dispositivo e imprimir o job UMA vez.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE";
                    var o = Order("N1", "5201"); api.AddJob("n1", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("n1") == "PRINTED" && Paper(printer, "5201") == 1, 20000);
                        Thread.Sleep(400);
                        Check("cliente PADRAO (legado) numa loja em QUEUE com /pending vazio: descobre a fila pela config e imprime o job 1 vez", done && Paper(printer, "5201") == 1 && rig.Device.CurrentMode == DeviceClient.ModeQueue);
                        Check("config: o legado nao buscou nenhum tiquete nem avisou /printed (a fila cuidou)", api.Count("/printable") == 0 && api.Count("/printed") == 0);
                    }
                }
            }
            finally { Clean(dir); }

            // N2: API ANTIGA (config 404): pergunta UMA vez e para; o legado segue funcionando sem a config.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = null; api.ConfigEnabled = false;
                    var o = Order("N2", "5202"); LegacyOrder(api, o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool done = WaitFor(() => Paper(printer, "5202") == 1, 20000);
                        int calls1 = api.ConfigCalls; Thread.Sleep(800); int calls2 = api.ConfigCalls;
                        Check("API antiga (config 404): o legado imprime normalmente", done && rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                        Check("API antiga (config 404): pergunta UMA vez so e nao insiste a cada ciclo (chamadas: " + calls1 + " e depois " + calls2 + ")", calls1 == 1 && calls2 == 1);
                    }
                }
            }
            finally { Clean(dir); }

            // N3: config com erro (500), lixo ou valor desconhecido: ignora, o legado segue e nao troca de modo.
            foreach (var bad in new[] { "500", "lixo", "vazio", "desconhecido" })
            {
                dir = Tmp();
                try
                {
                    using (var api = new FakeApi())
                    {
                        api.PrintMode = "LEGACY";
                        if (bad == "500") api.ConfigStatus = 500;
                        else if (bad == "lixo") api.ConfigBody = "<html>nao e json</html>";
                        else if (bad == "vazio") api.ConfigBody = "";
                        else api.ConfigBody = "{\"mode\":\"TALVEZ\"}";
                        var o = Order("N3" + bad, "5203"); LegacyOrder(api, o);
                        var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                        using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                        {
                            rig.Start();
                            bool done = WaitFor(() => Paper(printer, "5203") == 1, 20000);
                            Thread.Sleep(300);
                            Check("config com problema (" + bad + "): ignora, imprime pelo legado e continua LEGACY", done && rig.Device.CurrentMode == DeviceClient.ModeLegacy && !rig.Device.IsRevoked);
                        }
                    }
                }
                finally { Clean(dir); }
            }

            // N4: a config recusa a chave (401): segue a regra de chave recusada (nao imprime, nao fica em laco quente).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY"; api.ConfigStatus = 401;
                    var o = Order("N4", "5204"); LegacyOrder(api, o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.AuthFailureWindow = TimeSpan.FromMilliseconds(300);
                        rig.Start();
                        bool revoked = WaitFor(() => rig.Device.IsRevoked, 20000);
                        Check("config responde 401 repetido: entra na regra de chave recusada (pausa) e nada imprime", revoked && Paper(printer, "5204") == 0);
                    }
                }
            }
            finally { Clean(dir); }

            // N5 (parecer Nightingale a): um 404 da config NAO desliga a pergunta para sempre. Deploy/proxy/rollback devolvem 404 por um tempo;
            // depois a config volta com QUEUE e o cliente tem de descobrir a fila (senao a cozinha fica sem tiquete e sem sinal).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE"; api.ConfigEnabled = false; api.PendingCarriesMode = false;   // config 404 e /pending vazio SEM mode: o cliente nao tem como saber
                    var o = Order("N5", "5205"); api.AddJob("n5", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.ConfigSuppression = TimeSpan.FromMilliseconds(1500);
                        rig.Start();
                        bool asked = WaitFor(() => api.ConfigCalls >= 1, 10000);
                        Thread.Sleep(400);
                        int during = api.ConfigCalls;
                        Check("config 404: nao pergunta a cada ciclo durante o prazo de supressao (chamadas: " + during + ")", asked && during <= 2 && api.JobState("n5") == "PENDING");
                        api.ConfigEnabled = true;                            // o servico voltou
                        bool done = WaitFor(() => api.JobState("n5") == "PRINTED" && Paper(printer, "5205") == 1, 30000);
                        Check("config 404 e depois 200 QUEUE: depois do prazo o cliente volta a perguntar, passa para a fila e imprime o job 1 vez", done && rig.Device.CurrentMode == DeviceClient.ModeQueue);
                    }
                }
            }
            finally { Clean(dir); }

            // N6 (parecer Nightingale b): falha PERSISTENTE da config avisa na tela (sem trocar o modo) e limpa ao voltar.
            foreach (var kind in new[] { "500", "lixo" })
            {
                dir = Tmp();
                try
                {
                    using (var api = new FakeApi())
                    {
                        api.PrintMode = "LEGACY";
                        if (kind == "500") api.ConfigStatus = 500; else api.ConfigBody = "<html>quebrado</html>";
                        var o = Order("N6" + kind, "5206"); LegacyOrder(api, o);
                        var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                        using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                        {
                            rig.Device.ConfigFailuresBeforeWarning = 4;
                            rig.Start();
                            bool warned = WaitFor(() => rig.Device.ModeUnconfirmed, 20000);
                            Thread.Sleep(500);
                            Check("config com falha SEGUIDA (" + kind + "): avisa 'Não consigo confirmar o modo de impressão da loja' UMA vez so e continua no modo atual", warned && rig.MessageCount("Não consigo confirmar o modo") == 1 && rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                            Check("config com falha (" + kind + "): o legado segue imprimindo o pedido", WaitFor(() => Paper(printer, "5206") == 1, 20000));
                            api.ConfigStatus = 200; api.ConfigBody = null;   // voltou
                            bool cleared = WaitFor(() => !rig.Device.ModeUnconfirmed, 20000);
                            Check("config voltou a responder (" + kind + "): limpa o aviso ('confirmado novamente')", cleared && rig.HasMessage("confirmado novamente"));
                        }
                    }
                }
                finally { Clean(dir); }
            }
            // poucas falhas nao avisam (limite alto)
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY"; api.ConfigStatus = 500;
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.ConfigFailuresBeforeWarning = 1000;
                        rig.Start();
                        WaitFor(() => api.ConfigCalls >= 8, 20000);
                        Check("config com poucas falhas seguidas (abaixo do limite): NAO avisa", !rig.Device.ModeUnconfirmed && !rig.HasMessage("Não consigo confirmar"));
                    }
                }
            }
            finally { Clean(dir); }

            // N7 (API-12b): o `mode` no CORPO do /pending troca para a fila no proprio ciclo, SEM depender da rota de config (404 aqui).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "QUEUE"; api.ConfigEnabled = false; api.PendingCarriesMode = true;
                    var o = Order("N7", "5207"); api.AddJob("n7", o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool done = WaitFor(() => api.JobState("n7") == "PRINTED" && Paper(printer, "5207") == 1, 20000);
                        Check("mode no corpo do /pending (config 404): o cliente padrao passa para a fila e imprime o job 1 vez", done && rig.Device.CurrentMode == DeviceClient.ModeQueue);
                    }
                }
            }
            finally { Clean(dir); }

            // N8: /pending no formato ANTIGO (sem mode) e config 404: continua funcionando no legado como antes (cliente novo, API antiga).
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = null; api.ConfigEnabled = false; api.PendingCarriesMode = false;
                    var o = Order("N8", "5208"); LegacyOrder(api, o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Start();
                        bool done = WaitFor(() => Paper(printer, "5208") == 1, 20000);
                        Check("API antiga (/pending sem mode e config 404): o cliente novo imprime normalmente pelo legado", done && rig.Device.CurrentMode == DeviceClient.ModeLegacy);
                    }
                }
            }
            finally { Clean(dir); }

            // N9 (mutante Q10 do Deming): 404 REPETIDO da config (API antiga, ou deploy longo) NAO e falha: nunca gera o aviso de "modo nao confirmado".
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY"; api.ConfigEnabled = false;   // config 404 SEMPRE
                    var o = Order("N9", "5209"); LegacyOrder(api, o);
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out"));
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.ConfigSuppression = TimeSpan.FromMilliseconds(30);   // volta a perguntar a cada ~30 ms: muitos 404 seguidos
                        rig.Device.ConfigFailuresBeforeWarning = 3;
                        rig.Start();
                        bool many = WaitFor(() => api.ConfigCalls >= 12, 20000);
                        bool printed = WaitFor(() => Paper(printer, "5209") == 1, 20000);
                        Thread.Sleep(300);
                        Check("config 404 REPETIDO (" + api.ConfigCalls + " respostas 404 seguidas): NAO conta como falha e NAO avisa 'não consigo confirmar o modo'", many && printed && !rig.Device.ModeUnconfirmed && !rig.HasMessage("Não consigo confirmar"));
                    }
                }
            }
            finally { Clean(dir); }

            // M8: o servidor oscila o modo varias vezes com 6 pedidos (cada um aparece como pedido legado e como job): cada pedido sai 1 vez.
            dir = Tmp();
            try
            {
                using (var api = new FakeApi())
                {
                    api.PrintMode = "LEGACY";
                    for (int i = 1; i <= 6; i++)
                    {
                        var o = Order("F" + i, "52" + i.ToString("00"));
                        LegacyOrder(api, o);
                        api.AddJob("f" + i, o);
                    }
                    var printer = new VirtualPrintTarget(Path.Combine(dir, "out")) { DelayMs = 120 };
                    int switches = 0;
                    using (var rig = new Rig(api, printer, null, "mcd_impressora1_segredo", usePrintJobs: false))
                    {
                        rig.Device.ModeChanged += m => Interlocked.Increment(ref switches);
                        rig.Start();
                        var end = DateTime.UtcNow.AddSeconds(5);
                        bool queue = false;
                        while (DateTime.UtcNow < end) { queue = !queue; api.PrintMode = queue ? "QUEUE" : "LEGACY"; Thread.Sleep(170); }
                        api.PrintMode = "LEGACY";   // termina no legado: o que sobrou na lista legada sai por la
                        bool all = WaitFor(() => Enumerable.Range(1, 6).All(i => Paper(printer, "52" + i.ToString("00")) >= 1), 40000);
                        Thread.Sleep(1500);
                        var counts = Enumerable.Range(1, 6).Select(i => Paper(printer, "52" + i.ToString("00"))).ToArray();
                        Check("oscilacao do modo: o cliente trocou de modo varias vezes de verdade (" + Volatile.Read(ref switches) + " trocas)", Volatile.Read(ref switches) >= 4);
                        Check("oscilacao do modo: todos os 6 pedidos saem", all);
                        Check("oscilacao do modo: nenhum pedido sai 2 vezes (contagem por pedido: " + string.Join(",", counts) + ")", counts.All(c => c == 1));
                    }
                }
            }
            finally { Clean(dir); }
        }

    }
}
