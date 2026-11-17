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
using Newtonsoft.Json;

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

        // ---- Fila de PrintJob (ADR-0004 §2/§5): claim com lease, ack idempotente, 409 em lease vencida, attempts ----
        public sealed class FakeJob
        {
            public string Id; public string Kind = "ORDER_KITCHEN"; public string TicketJson;
            public string State = "PENDING";            // PENDING | CLAIMED | PRINTED | FAILED
            public string LastCode; public string ClaimedBy; public DateTime LeaseUntilUtc; public DateTime AvailableAtUtc = DateTime.MinValue; public int Attempts; public int MaxAttempts = 3; public string LastError;
        }
        public readonly List<FakeJob> Jobs = new List<FakeJob>();
        public readonly List<string> JobAcks = new List<string>();   // "id|status|erro|auth"
        public readonly List<string> JobAckBodies = new List<string>(); // corpo CRU de cada ack (para provar o que sai do computador da loja)
        public int LeaseMs = 120000;                                  // ADR-0004 §8: lease padrao 120 s
        public int FailBackoffMs = 300;                               // recuo do servidor depois de FAILED (no ADR: 15 s, 60 s, 5 min); curto para o teste
        public bool EmptyAs204;                                       // fila vazia: 204 em vez de {"job":null}
        // Modo de impressao da loja decidido pelo servidor (ADR-0004 §8 itens 12-13): null = API antiga (sem "mode"); "LEGACY" = claim
        // devolve {job:null, mode:"LEGACY"} e o endpoint legado funciona; "QUEUE" = claim normal com mode e o legado responde 409 MODE_QUEUE.
        public volatile string PrintMode;
        public int LegacyCalls { get { lock (Lock) return _legacyCalls; } }
        int _legacyCalls;
        public int ClaimStatus = 200;                                 // 401/403/500 para simular falha do claim
        public int JobAckStatus = 200; public int JobAckFailFirst;    // primeiros N acks respondem JobAckStatus sem aplicar
        int _claimCalls, _jobAckCalls;
        public int ClaimCalls { get { lock (Lock) return _claimCalls; } }
        public int JobAckCalls { get { lock (Lock) return _jobAckCalls; } }

        public FakeJob AddJob(string id, PrintableOrder ticket, string kind = "ORDER_KITCHEN")
        {
            var j = new FakeJob { Id = id, Kind = kind, TicketJson = ticket == null ? null : JsonConvert.SerializeObject(ticket) };
            lock (Lock) Jobs.Add(j);
            return j;
        }
        public string JobState(string id) { lock (Lock) { var j = Jobs.FirstOrDefault(x => x.Id == id); ExpireLeases(); return j == null ? null : j.State; } }
        public int JobAttempts(string id) { lock (Lock) { var j = Jobs.FirstOrDefault(x => x.Id == id); return j == null ? -1 : j.Attempts; } }
        public string JobLastCode(string id) { lock (Lock) { var j = Jobs.FirstOrDefault(x => x.Id == id); return j == null ? null : j.LastCode; } }
        public string AllAckBodies() { lock (Lock) return string.Join("\n", JobAckBodies); }
        public string JobLastError(string id) { lock (Lock) { var j = Jobs.FirstOrDefault(x => x.Id == id); return j == null ? null : j.LastError; } }
        public int AcksOf(string id, string status) { lock (Lock) return JobAcks.Count(a => a.StartsWith(id + "|" + status + "|", StringComparison.Ordinal)); }
        static string OrderIdOf(FakeJob j)
        {
            if (j.TicketJson == null) return null;
            try { return (string)Newtonsoft.Json.Linq.JObject.Parse(j.TicketJson)["orderId"]; } catch { return null; }
        }
        void ExpireLeases() { var now = DateTime.UtcNow; foreach (var j in Jobs) if (j.State == "CLAIMED" && j.LeaseUntilUtc < now) j.State = "PENDING"; }
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
            if (path == "/api/device/print-jobs/claim")
            {
                string auth = c.Request.Headers["Authorization"] ?? "";
                string body = null; int status = 200;
                lock (Lock)
                {
                    _claimCalls++;
                    if (ClaimStatus != 200) status = ClaimStatus;
                    else
                    {
                        ExpireLeases();
                        var now = DateTime.UtcNow;
                        // ADR-0004 §8: o mesmo dono com lease valida recebe o MESMO job, sem incrementar attempt; o claim so devolve
                        // PENDING com availableAt <= agora (um job que falha sempre nao trava a fila) e nunca devolve PRINTED.
                        var j = Jobs.FirstOrDefault(x => x.State == "CLAIMED" && x.ClaimedBy == auth && x.LeaseUntilUtc >= now)
                                ?? Jobs.FirstOrDefault(x => x.State == "PENDING" && x.AvailableAtUtc <= now);
                        if (PrintMode == "LEGACY") j = null;   // em LEGACY o servidor nunca entrega job
                        if (j == null) { if (EmptyAs204 && PrintMode == null) status = 204; else body = "{\"job\":null" + (PrintMode != null ? ",\"mode\":\"" + PrintMode + "\"" : "") + "}"; }
                        else
                        {
                            if (j.State != "CLAIMED") { j.State = "CLAIMED"; j.ClaimedBy = auth; j.LeaseUntilUtc = now.AddMilliseconds(LeaseMs); j.Attempts++; }
                            body = "{\"job\":{\"id\":\"" + j.Id + "\",\"kind\":\"" + j.Kind + "\",\"attempt\":" + j.Attempts + ",\"leaseSeconds\":" + Math.Max(1, (int)Math.Ceiling(LeaseMs / 1000.0))
                                + (j.TicketJson != null ? ",\"ticket\":" + j.TicketJson : "") + "}" + (PrintMode != null ? ",\"mode\":\"" + PrintMode + "\"" : "") + "}";
                        }
                    }
                }
                if (status == 204) { c.Response.StatusCode = 204; c.Response.Close(); return; }
                Reply(c, status, body ?? "{}");
                return;
            }
            if (path.StartsWith("/api/device/print-jobs/") && path.EndsWith("/ack"))
            {
                var id = path.Substring("/api/device/print-jobs/".Length).Replace("/ack", "");
                string auth = c.Request.Headers["Authorization"] ?? "";
                string raw; using (var rd = new StreamReader(c.Request.InputStream, Encoding.UTF8)) raw = rd.ReadToEnd();
                var parsed = Newtonsoft.Json.Linq.JObject.Parse(string.IsNullOrWhiteSpace(raw) ? "{}" : raw);
                string st = (string)parsed["status"], err = (string)parsed["error"], codeIn = (string)parsed["code"];
                int reply;
                lock (Lock)
                {
                    int n = ++_jobAckCalls;
                    JobAcks.Add(id + "|" + st + "|" + err + "|" + auth);
                    JobAckBodies.Add(raw);
                    ExpireLeases();
                    var j = Jobs.FirstOrDefault(x => x.Id == id);
                    if (JobAckFailFirst > 0 && n <= JobAckFailFirst) reply = JobAckStatus;
                    else if (JobAckStatus != 200 && JobAckFailFirst == 0) reply = JobAckStatus;
                    else if (j == null) reply = 404;
                    else if (j.State == "PRINTED" && st == "PRINTED" && j.ClaimedBy == auth) reply = 200;          // idempotente
                    else if (j.State == "CLAIMED" && j.ClaimedBy == auth)                                         // lease valida e dono
                    {
                        if (st == "PRINTED") { j.State = "PRINTED"; var oid = OrderIdOf(j); if (oid != null) Pending.RemoveAll(x => x[0] == oid); }   // R2: o ack do job grava printedAt
                        else { j.LastError = err; j.LastCode = codeIn; j.State = j.Attempts >= j.MaxAttempts ? "FAILED" : "PENDING"; j.AvailableAtUtc = DateTime.UtcNow.AddMilliseconds(FailBackoffMs); }
                        reply = 200;
                    }
                    else reply = 409;                                                                             // lease vencida ou nao e o dono
                }
                Reply(c, reply, "{}");
                return;
            }
            if (path.StartsWith("/api/device/orders/") && PrintMode == "QUEUE")
            {
                lock (Lock) _legacyCalls++;
                Reply(c, 409, "{\"error\":\"A loja usa a fila de impressao.\",\"code\":\"MODE_QUEUE\"}");
                return;
            }
            if (path.StartsWith("/api/device/orders/")) lock (Lock) _legacyCalls++;
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
                    // §8 item 13a: o ack legado fecha o job do pedido na mesma transacao do printedAt.
                    lock (Lock) { Pending.RemoveAll(x => x[0] == id); foreach (var jb in Jobs) if (jb.State != "PRINTED" && OrderIdOf(jb) == id) jb.State = "PRINTED"; }
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
