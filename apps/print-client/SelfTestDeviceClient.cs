using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
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
            public string WsMode = "status";                           // "status" (responde WsStatus) | "accept" | "close4401"
            readonly List<WebSocket> _sockets = new List<WebSocket>();
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
                if (path == "/ws/device")
                {
                    if (WsMode == "status" || !c.Request.IsWebSocketRequest) { Reply(c, WsStatus, "{}"); return; }
                    var mode = WsMode;
                    Task.Run(async () =>
                    {
                        try
                        {
                            var wc = await c.AcceptWebSocketAsync(null);
                            var ws = wc.WebSocket;
                            lock (Lock) _sockets.Add(ws);
                            if (mode == "close4401") { await ws.CloseAsync((WebSocketCloseStatus)4401, "revogada", CancellationToken.None); return; }
                            var buf = new byte[256];
                            while (ws.State == WebSocketState.Open)
                            {
                                var r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), CancellationToken.None);
                                if (r.MessageType == WebSocketMessageType.Close) break;
                            }
                        }
                        catch { }
                    });
                    return;
                }
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

            public int OpenSockets { get { lock (Lock) return _sockets.Count(x => x.State == WebSocketState.Open); } }

            // Aviso "acorde e peca job" pelo WS (como print.available da API).
            public void SendWs(string text)
            {
                WebSocket[] open; lock (Lock) open = _sockets.Where(x => x.State == WebSocketState.Open).ToArray();
                foreach (var w in open)
                    try { w.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text, true, CancellationToken.None).Wait(2000); } catch { }
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
            RevokedWindowAndRecovery();
            WsRealtime();
            WsRevoked4401();
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

        // ---- PC-05 (V1): 401/403 por tempo suficiente => pausa e avisa; pouco tempo NAO pausa ----
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
                        dc.AuthFailureWindow = TimeSpan.FromMilliseconds(700);
                        dc.RevokedProbeMs = 600000; // sem sonda neste teste
                        dc.KeyRevoked += () => Interlocked.Increment(ref revoked);
                        dc.StatusChanged += s => { lock (status) status.Add(s); };
                        dc.Start();
                        bool got = WaitFor(() => dc.IsRevoked, 8000);
                        Thread.Sleep(300);
                        int atRevoke = api.Total;
                        Thread.Sleep(900);
                        Check("chave recusada (" + code + ") por mais que a janela: pausa e dispara KeyRevoked 1 vez", got && Volatile.Read(ref revoked) == 1);
                        Check("chave recusada (" + code + "): pausado nao chama a API (sem sonda no periodo)", api.Total == atRevoke);
                        lock (status) Check("chave recusada (" + code + "): mensagem explica, pede chave nova e diz que volta sozinho", status.Any(s => s.Contains("PAUSADA") && s.Contains("Configurar chave") && s.Contains("testa de novo")));
                    }
                }
            }

            // recusas por MENOS que a janela (proxy/portal cativo passageiro) nao pausam a cozinha
            using (var api = new FakeApi())
            {
                api.PendingStatus = 401; api.WsStatus = 401;
                PrintLedger led;
                using (var dc = Client(api, out led, 80))
                {
                    dc.AuthFailureWindow = TimeSpan.FromSeconds(30);
                    dc.Start();
                    bool many = WaitFor(() => api.Total >= 12, 8000); // bem mais que 3 recusas seguidas
                    Check("401 passageiro: muitas recusas seguidas dentro da janela NAO pausam", many && !dc.IsRevoked);
                }
            }
        }

        // ---- pausa reversivel: a sonda retoma sozinha quando a chave volta a valer ----
        static void RevokedWindowAndRecovery()
        {
            using (var api = new FakeApi())
            {
                api.PendingStatus = 401; api.WsStatus = 401;
                PrintLedger led; int revoked = 0, restored = 0, ready = 0; var status = new List<string>();
                using (var dc = Client(api, out led, 80))
                {
                    dc.AuthFailureWindow = TimeSpan.FromMilliseconds(400);
                    dc.RevokedProbeMs = 300;
                    dc.KeyRevoked += () => Interlocked.Increment(ref revoked);
                    dc.KeyRestored += () => Interlocked.Increment(ref restored);
                    dc.StatusChanged += s => { lock (status) status.Add(s); };
                    dc.TicketReady += o => { Interlocked.Increment(ref ready); dc.RecordPrinted(o.OrderId); dc.AckPrintedAsync(o.OrderId).Wait(); };
                    dc.Start();
                    bool paused = WaitFor(() => dc.IsRevoked, 8000);
                    Check("retomada: pausa por recusas alem da janela", paused && Volatile.Read(ref revoked) == 1);
                    int probes0 = api.PendingCalls;
                    Thread.Sleep(900);
                    Check("retomada: pausado so sonda (poucas chamadas), nao faz polling normal", api.PendingCalls - probes0 <= 5);
                    api.Pending.Add(new[] { "R", "321" });
                    api.PendingStatus = 200; api.WsStatus = 404; // o proxy/chave voltou ao normal
                    bool back = WaitFor(() => !dc.IsRevoked && Volatile.Read(ref restored) == 1, 5000);
                    Check("retomada: sonda com 200 retoma sozinha e dispara KeyRestored", back);
                    bool printed = WaitFor(() => Volatile.Read(ref ready) == 1 && led.IsPrinted("R"), 5000);
                    Check("retomada: volta a imprimir o pedido pendente (1 vez)", printed);
                    lock (status) Check("retomada: avisa que a impressao foi retomada", status.Any(s => s.Contains("voltou a ser aceita")));
                }
            }
        }

        // ---- WS com upgrade REAL: o aviso do servidor acorda o ciclo (polling longo) ----
        static void WsRealtime()
        {
            using (var api = new FakeApi())
            {
                api.WsMode = "accept";
                PrintLedger led; int ready = 0;
                using (var dc = Client(api, out led, 600000))
                {
                    dc.TicketReady += o => { Interlocked.Increment(ref ready); dc.RecordPrinted(o.OrderId); dc.AckPrintedAsync(o.OrderId).Wait(); };
                    dc.Start();
                    bool connected = WaitFor(() => api.OpenSockets == 1, 8000);
                    Thread.Sleep(300); // 1o ciclo do polling (vazio) ja passou
                    api.Pending.Add(new[] { "W", "88" });
                    api.SendWs("{\"type\":\"print.available\"}");
                    bool got = WaitFor(() => Volatile.Read(ref ready) == 1, 5000);
                    Check("ws real: conecta com upgrade e Bearer", connected && api.Requests.Any(r => r.Contains("/ws/device") && r.EndsWith("auth=Bearer mcd_teste_segredo")));
                    Check("ws real: aviso do servidor acorda o ciclo sem esperar o polling", got && api.PendingCalls >= 2);
                }
            }
        }

        // ---- servidor fecha o WS com 4401 (chave revogada, NG-06): pausa na hora ----
        static void WsRevoked4401()
        {
            using (var api = new FakeApi())
            {
                api.WsMode = "close4401";
                PrintLedger led; int revoked = 0;
                using (var dc = Client(api, out led, 600000))
                {
                    dc.AuthFailureWindow = TimeSpan.FromMinutes(10); // a janela NAO vale para o 4401
                    dc.RevokedProbeMs = 600000;
                    dc.KeyRevoked += () => Interlocked.Increment(ref revoked);
                    dc.Start();
                    bool got = WaitFor(() => dc.IsRevoked, 8000);
                    Check("ws 4401: fechamento por revogacao pausa na hora, sem esperar a janela", got && Volatile.Read(ref revoked) == 1);
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
