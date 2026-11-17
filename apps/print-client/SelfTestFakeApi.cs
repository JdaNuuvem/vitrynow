using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace MeuCardapio.PrintClient
{
    internal static class SelfTestUtil
    {
        public static bool WaitFor(Func<bool> cond, int ms)
        {
            var end = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < end) { if (cond()) return true; Thread.Sleep(25); }
            return cond();
        }
    }

    // API falsa em loopback (HttpListener) para testar o DeviceClient real e o harness de impressao:
    // /pending, /printable, /printed, /ws/device (status fixo ou WebSocket de verdade).
    internal sealed class FakeApi : IDisposable
    {
        public readonly int Port;
        HttpListener _l;
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
        public Func<string[], string> PrintableBody;               // corpo de /printable (por pedido); padrao: pedido minimo
        public string WsMode = "status";                           // "status" (responde WsStatus) | "accept" | "close4401"
        readonly List<WebSocket> _sockets = new List<WebSocket>();
        int _pendingCalls, _ackCalls;
        // Consulta segura: o servidor falso grava em Requests em outra thread; enumerar sem travar lanca "colecao modificada".
        public bool Has(Func<string, bool> predicate) { lock (Lock) return Requests.Any(predicate); }
        public int Count(string needle) { lock (Lock) return Requests.Count(r => r.Contains(needle)); }
        public int AckCalls { get { lock (Lock) return _ackCalls; } }
        public int PendingCalls { get { lock (Lock) return _pendingCalls; } }
        public int Total { get { lock (Lock) return Requests.Count; } }

        public FakeApi()
        {
            var rnd = new Random(); int p = 0; bool ok = false; string last = "";
            // A maquina divide portas com outras suites rodando ao mesmo tempo. Um HttpListener que falhou no Start fica
            // inutilizavel: cada tentativa usa um NOVO (reusar o mesmo fazia uma colisao derrubar as 299 seguintes).
            for (int i = 0; i < 300 && !ok; i++)
            {
                if (i > 0 && i % 50 == 0) Thread.Sleep(100);
                p = 20000 + rnd.Next(30000);
                var candidate = new HttpListener();
                try { candidate.Prefixes.Add("http://127.0.0.1:" + p + "/"); candidate.Start(); _l = candidate; ok = true; }
                catch (Exception ex)
                {
                    try { candidate.Close(); } catch { }
                    last = ex.GetType().Name + (ex is System.ComponentModel.Win32Exception ? " (" + ((System.ComponentModel.Win32Exception)ex).NativeErrorCode + ")" : "") + ": " + ex.Message;
                }
            }
            if (!ok) throw new InvalidOperationException("sem porta livre; ultimo erro do HttpListener: " + last);
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
                if (PrintableBody != null) { Reply(c, 200, PrintableBody(o)); return; }
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
}
