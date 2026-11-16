using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using MeuCardapio.PrintClient.Models;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // PC-05/PC-06 + parte do QA-06: o DeviceClient REAL contra uma API falsa em loopback (HttpListener):
    // dedupe, ack repetido, indicador "sem imprimir" sem repetição, watchdog e chave revogada (401/403).
    // Sem impressora e sem WinForms.
    static class SelfTestDeviceClient
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        sealed class FakeApi : IDisposable
        {
            public readonly int Port;
            readonly HttpListener _l = new HttpListener();
            readonly Thread _t;
            public readonly object Lock = new object();
            public readonly List<string> Requests = new List<string>();
            public List<string[]> Pending = new List<string[]>();      // {id, code}
            public int PendingStatus = 200;                            // status de /pending
            public int PendingFailFirst;                               // primeiras N respostas de /pending viram PendingStatus
            public int AckStatus = 200;
            public int AckFailFirst;                                   // primeiros N acks respondem AckStatus; depois 200
            public int WsStatus = 404;                                 // /ws/device (sem upgrade real)
            public bool RemoveOnAck = true;
            int _pendingCalls, _ackCalls;
            public int Count(string needle) { lock (Lock) return Requests.Count(r => r.Contains(needle)); }
            public int AckCalls { get { lock (Lock) return _ackCalls; } }
            public int PendingCalls { get { lock (Lock) return _pendingCalls; } }
            public int Total { get { lock (Lock) return Requests.Count; } }

            public FakeApi()
            {
                var rnd = new Random(); int p = 0; bool ok = false;
                for (int i = 0; i < 30 && !ok; i++)
                {
                    p = 20000 + rnd.Next(30000);
                    try { _l.Prefixes.Clear(); _l.Prefixes.Add("http://127.0.0.1:" + p + "/"); _l.Start(); ok = true; } catch { }
                }
                if (!ok) throw new InvalidOperationException("sem porta livre");
                Port = p;
                _t = new Thread(Loop) { IsBackground = true };
                _t.Start();
            }

            void Loop()
            {
                while (true)
                {
                    HttpListenerContext c;
                    try { c = _l.GetContext(); } catch { return; }
                    try { Handle(c); } catch { try { c.Response.Abort(); } catch { } }
                }
            }

            void Reply(HttpListenerContext c, int status, string body)
            {
                var b = Encoding.UTF8.GetBytes(body ?? "");
                c.Response.StatusCode = status;
                c.Response.ContentType = "application/json";
                c.Response.ContentLength64 = b.Length;
                c.Response.OutputStream.Write(b, 0, b.Length);
                c.Response.Close();
            }

            void Handle(HttpListenerContext c)
            {
                var path = c.Request.Url.AbsolutePath;
                lock (Lock) Requests.Add(c.Request.HttpMethod + " " + path + " auth=" + (c.Request.Headers["Authorization"] ?? ""));
                if (path == "/ws/device") { Reply(c, WsStatus, "{}"); return; }
                if (path == "/api/device/orders/pending")
                {
                    int n; lock (Lock) n = ++_pendingCalls;
                    if (PendingStatus != 200 && n <= (PendingFailFirst == 0 ? int.MaxValue : PendingFailFirst)) { Reply(c, PendingStatus, "{}"); return; }
                    string[][] snap; lock (Lock) snap = Pending.ToArray();
                    Reply(c, 200, "{\"orders\":[" + string.Join(",", snap.Select(o => "{\"id\":\"" + o[0] + "\",\"code\":\"" + o[1] + "\"}")) + "]}");
                    return;
                }
                if (path.StartsWith("/api/device/orders/") && path.EndsWith("/printable"))
                {
                    var id = path.Substring("/api/device/orders/".Length).Replace("/printable", "");
                    string[] o; lock (Lock) o = Pending.FirstOrDefault(x => x[0] == id);
                    if (o == null) { Reply(c, 404, "{}"); return; }
                    Reply(c, 200, "{\"order\":{\"orderId\":\"" + o[0] + "\",\"code\":\"" + o[1] + "\",\"type\":\"DELIVERY\",\"storeName\":\"Loja\",\"customerName\":\"Ana\",\"totalCents\":1000,\"items\":[]}}");
                    return;
                }
                if (path.StartsWith("/api/device/orders/") && path.EndsWith("/printed"))
                {
                    int n; lock (Lock) n = ++_ackCalls;
                    int status = (AckFailFirst > 0 && n > AckFailFirst) ? 200 : AckStatus;
                    if (status == 200 && RemoveOnAck)
                    {
                        var id = path.Substring("/api/device/orders/".Length).Replace("/printed", "");
                        lock (Lock) Pending.RemoveAll(x => x[0] == id);
                    }
                    Reply(c, status, "{}");
                    return;
                }
                Reply(c, 404, "{}");
            }

            public void Dispose() { try { _l.Stop(); _l.Close(); } catch { } }
        }

        static bool WaitFor(Func<bool> cond, int ms)
        {
            var end = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < end) { if (cond()) return true; Thread.Sleep(25); }
            return cond();
        }

        public static void Run()
        {
            LedgerExtras();
            Dedupe();
            PrintProblems();
            Revoked();
            AuthRecovers();
            Redirect();
        }

        // ---- Ledger: watchdog (PC-06 b), lista "sem imprimir" (PC-06 d) ----
        static void LedgerExtras()
        {
            var now = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);
            var l = new PrintLedger(null, () => now);
            l.TryBeginPrint("S");
            now = now.AddMinutes(1);
            Check("watchdog: 1 min em impressao ainda nao expira", l.ExpireStuck().Count == 0 && !l.TryBeginPrint("S"));
            now = now.AddMinutes(1).AddSeconds(1);
            var stuck = l.ExpireStuck();
            Check("watchdog: >2 min em impressao expira e vira falha", stuck.Count == 1 && stuck[0] == "S" && l.FailedOrders().Count == 1);
            Check("watchdog: expirado respeita o recuo (nao reimprime na hora)", !l.TryBeginPrint("S"));
            now = now.AddSeconds(16);
            Check("watchdog: depois do recuo o pedido volta a poder imprimir", l.TryBeginPrint("S"));
            Check("watchdog: expirar 2x seguidas nao duplica falha em quem ja saiu", l.ExpireStuck().Count == 0);

            var f = new PrintLedger(null, () => now);
            f.TryBeginPrint("X"); f.MarkPrintFailed("X", "1042");
            f.TryBeginPrint("Y"); f.MarkPrintFailed("Y");
            var failed = f.FailedOrders();
            Check("sem imprimir: lista usa #codigo quando conhecido", failed.Contains("#1042") && failed.Contains("Y") && failed.Count == 2);
            now = now.AddMinutes(1);
            f.TryBeginPrint("X"); f.MarkPrinted("X");
            Check("sem imprimir: pedido impresso sai da lista", f.FailedOrders().Count == 1 && !f.FailedOrders().Contains("#1042"));
            Check("sem imprimir: reconcilia o que a API nao lista mais (cancelado/impresso em outro PC)", f.ReconcileFailures(new string[0]) == 1 && f.FailedOrders().Count == 0);
            f.TryBeginPrint("Z"); f.MarkPrintFailed("Z", "9");
            Check("sem imprimir: reconciliar mantem o que ainda esta pendente na API", f.ReconcileFailures(new[] { "Z" }) == 0 && f.FailedOrders().Count == 1);

            var dir = Path.Combine(Path.GetTempPath(), "meucardapio_selftest_pc06_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                var path = Path.Combine(dir, "printed.json");
                var p1 = new PrintLedger(path, () => now); p1.TryBeginPrint("K"); p1.MarkPrintFailed("K", "55");
                var p2 = new PrintLedger(path, () => now);
                Check("sem imprimir: sobrevive ao reinicio do app (com o codigo)", p2.FailedOrders().Count == 1 && p2.FailedOrders()[0] == "#55");
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }

        static DeviceClient Client(FakeApi api, out PrintLedger ledger, int pollMs = 120)
        {
            ledger = new PrintLedger(null);
            var s = new AppSettings { ApiBaseUrl = "http://127.0.0.1:" + api.Port, DeviceToken = "mcd_teste_segredo" };
            return new DeviceClient(ledger, s) { PollIntervalMs = pollMs, WsRetryMs = 150 };
        }

        // ---- polling real: dedupe, ack repetido, Bearer ----
        static void Dedupe()
        {
            using (var api = new FakeApi())
            {
                api.Pending.Add(new[] { "A", "1001" });
                api.AckStatus = 500; api.AckFailFirst = 2; // 2 primeiros acks falham (500), o 3o passa
                PrintLedger led; int ready = 0;
                using (var dc = Client(api, out led))
                {
                    dc.TicketReady += o => { Interlocked.Increment(ref ready); dc.RecordPrinted(o.OrderId); dc.AckPrintedAsync(o.OrderId).Wait(); };
                    dc.Start();
                    bool acked = WaitFor(() => led.PendingAcks().Count == 0 && api.AckCalls >= 3, 8000);
                    Thread.Sleep(500); // mais alguns ciclos com o pedido ja resolvido
                    Check("cliente real: pedido impresso exatamente 1 vez, mesmo com varios ciclos", Volatile.Read(ref ready) == 1);
                    Check("cliente real: ack que falhou (500) e repetido ate passar, sem reimprimir", acked && api.AckCalls == 3 && Volatile.Read(ref ready) == 1);
                    Check("cliente real: ack fecha o pedido no ledger", led.IsPrinted("A") && led.PendingAcks().Count == 0);
                    Check("cliente real: Bearer da chave enviado", api.Requests.Any(r => r.Contains("/api/device/orders/pending") && r.EndsWith("auth=Bearer mcd_teste_segredo")));
                }
            }
        }

        // ---- indicador "sem imprimir": uma vez por mudanca, nunca repete ----
        static void PrintProblems()
        {
            using (var api = new FakeApi())
            {
                api.Pending.Add(new[] { "B", "77" });
                PrintLedger led;
                var events = new List<string>(); var elock = new object();
                using (var dc = Client(api, out led))
                {
                    int ready = 0;
                    dc.TicketReady += o => { Interlocked.Increment(ref ready); dc.ReportPrintFailed(o.OrderId, o.Code); }; // impressora offline
                    dc.PrintProblemsChanged += list => { lock (elock) events.Add(string.Join(",", list)); };
                    dc.Start();
                    bool got = WaitFor(() => { lock (elock) return events.Count >= 1; }, 5000);
                    Thread.Sleep(900); // ~7 ciclos de polling com o pedido ainda pendente e em recuo
                    int n; lock (elock) n = events.Count;
                    Check("sem imprimir: aviso com o pedido que falhou", got && events[0] == "#77");
                    Check("sem imprimir: nao repete o aviso a cada ciclo (1 evento so)", n == 1);
                    Check("sem imprimir: recuo impede nova tentativa a cada 15 s (1 so tentativa no periodo)", Volatile.Read(ref ready) == 1);
                    lock (api.Lock) api.Pending.Clear(); // pedido cancelado na API
                    bool cleared = WaitFor(() => { lock (elock) return events.Count >= 2; }, 5000);
                    lock (elock) Check("sem imprimir: some quando a API nao lista mais o pedido", cleared && events[1] == "");
                }
            }
        }

        // ---- PC-05: 401/403 repetidos => para e avisa ----
        static void Revoked()
        {
            foreach (var code in new[] { 401, 403 })
            {
                using (var api = new FakeApi())
                {
                    api.PendingStatus = code; api.WsStatus = code;
                    PrintLedger led; int revoked = 0; var status = new List<string>();
                    using (var dc = Client(api, out led, 80))
                    {
                        dc.KeyRevoked += () => Interlocked.Increment(ref revoked);
                        dc.StatusChanged += s => { lock (status) status.Add(s); };
                        dc.Start();
                        bool got = WaitFor(() => dc.IsRevoked, 8000);
                        Thread.Sleep(300);
                        int atRevoke = api.Total;
                        Thread.Sleep(900);
                        Check("chave revogada (" + code + "): detecta e dispara KeyRevoked 1 vez", got && Volatile.Read(ref revoked) == 1);
                        Check("chave revogada (" + code + "): para de chamar a API (sem novos pedidos depois)", api.Total == atRevoke);
                        lock (status) Check("chave revogada (" + code + "): mensagem explica e pede nova chave", status.Any(s => s.Contains("revogada") && s.Contains("Configurar chave")));
                    }
                }
            }
        }

        // ---- 401 isolado (ex.: deploy) nao derruba nada: so recusas SEGUIDAS contam ----
        static void AuthRecovers()
        {
            using (var api = new FakeApi())
            {
                api.PendingStatus = 401; api.PendingFailFirst = 2; // 2 recusas, depois normal
                PrintLedger led; int revoked = 0;
                using (var dc = Client(api, out led, 80))
                {
                    dc.KeyRevoked += () => Interlocked.Increment(ref revoked);
                    dc.Start();
                    bool recovered = WaitFor(() => api.PendingCalls >= 6, 6000);
                    Check("401 isolado: 2 recusas e depois resposta boa NAO revoga a chave", recovered && !dc.IsRevoked && Volatile.Read(ref revoked) == 0);
                }
            }
        }

        // ---- redirecionamento nunca e seguido (o Bearer nao pode ir para outro host) ----
        static void Redirect()
        {
            using (var api = new FakeApi())
            {
                api.PendingStatus = 302;
                PrintLedger led; var status = new List<string>();
                using (var dc = Client(api, out led, 80))
                {
                    dc.StatusChanged += s => { lock (status) status.Add(s); };
                    dc.Start();
                    bool seen = WaitFor(() => { lock (status) return status.Any(s => s.Contains("redirecionamento")); }, 5000);
                    Check("redirecionamento 302: nao segue, avisa para conferir a URL e nao revoga a chave", seen && !dc.IsRevoked);
                }
            }
        }
    }
}
