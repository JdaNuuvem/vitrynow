using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using MeuCardapio.PrintClient.Models;

namespace MeuCardapio.PrintClient.Services
{
    // 401/403 da API: a chave de impressora foi revogada, trocada ou nunca valeu.
    public class DeviceAuthException : Exception
    {
        public int StatusCode { get; private set; }
        public DeviceAuthException(int status) : base("chave de impressora recusada pela API (" + status + ")") { StatusCode = status; }
    }

    // Uma única conexão WS com a NOSSA API: o WS é só "aviso para checar agora"; o REST é a fonte
    // de verdade (pending/printable/printed). Se o WS cair, o polling periódico garante que nada
    // se perde.
    //
    // PC-02 (B06, B28): polling e WS passam pelo MESMO portão (um ciclo por vez), o dedupe por
    // orderId e o ack persistido ficam no PrintLedger, e toda chamada de rede tem timeout.
    // PC-05 (R2 Nightingale, V1): 401/403 SEGUIDOS por pelo menos AuthFailureWindow pausam a impressão
    // ("chave revogada"), em vez de martelar a API. A pausa NÃO é definitiva: uma sonda lenta
    // (RevokedProbeMs) retoma sozinha quando a API voltar a aceitar a chave (proxy/WAF/portal cativo
    // que devolveu 401/403 por engano, ou chave nova gravada em "Configurar chave..."). Fechamento do WS
    // com 4401 (servidor revogou a chave, NG-06) pausa na hora.
    // PC-06 (Deming a/b/d): MarkPrinted síncrono, watchdog de impressão travada e lista de pedidos
    // "sem imprimir" publicada só quando muda (sem repetir alerta).
    public class DeviceClient : IDisposable
    {
        public static readonly TimeSpan HttpTimeout = TimeSpan.FromSeconds(15);
        public static readonly TimeSpan WsConnectTimeout = TimeSpan.FromSeconds(10);
        static readonly TimeSpan WsKeepAlive = TimeSpan.FromSeconds(20);

        public int PollIntervalMs { get; set; } = 15000;
        public int WsRetryMs { get; set; } = 5000;
        // Chave declarada revogada só com >= AuthFailureLimit recusas seguidas ABRANGENDO AuthFailureWindow
        // (um 401 de proxy/portal cativo que dura segundos não pausa a cozinha).
        public int AuthFailureLimit { get; set; } = 3;
        public TimeSpan AuthFailureWindow { get; set; } = TimeSpan.FromMinutes(2);
        // Com a impressão pausada, de quanto em quanto tempo testa se a chave voltou a valer.
        public int RevokedProbeMs { get; set; } = 5 * 60 * 1000;
        // Código de fechamento do WS quando o servidor revoga a sessão/chave (hub.ts, NG-06).
        public const int WsCloseRevoked = 4401;

        public event Action OrderPending;
        public event Action<PrintableOrder> TicketReady;
        public event Action<string> StatusChanged;
        // Lista de rótulos dos pedidos sem imprimir ("#1042"); disparado só quando a lista muda
        // (inclusive para vazia). A UI mostra um indicador fixo, sem repetir som ou popup.
        public event Action<IList<string>> PrintProblemsChanged;
        public event Action KeyRevoked;
        public event Action KeyRestored;

        public bool IsRevoked => _revoked;

        // AllowAutoRedirect=false: a API nunca redireciona, e o Bearer não pode seguir para outro host.
        readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = HttpTimeout };
        readonly SemaphoreSlim _cycleGate = new SemaphoreSlim(1, 1);
        readonly PrintLedger _ledger;
        readonly AppSettings _settings;
        readonly object _problemsLock = new object();
        string _lastProblemsKey = "";
        int _authFailures;
        DateTime _authFirstFailureUtc;
        volatile bool _revoked;
        CancellationTokenSource _cts;
        Task _pollTask;
        Task _wsTask;

        public DeviceClient() : this(new PrintLedger(AppSettings.LedgerPath)) { }

        public DeviceClient(PrintLedger ledger, AppSettings settings = null)
        {
            _ledger = ledger;
            _settings = settings ?? AppSettings.Current;
        }

        public void Start()
        {
            var urlProblem = ApiUrlPolicy.Validate(_settings.ApiBaseUrl);
            if (urlProblem != null)
            {
                StatusChanged?.Invoke("Configuração recusada: " + urlProblem);
                return; // nem conecta: a chave não vai por canal inseguro
            }
            _cts = new CancellationTokenSource();
            _http.BaseAddress = new Uri(_settings.ApiBaseUrl);
            _ledger.Prune();

            _pollTask = Task.Run(() => PollLoopAsync(_cts.Token));
            _wsTask = Task.Run(() => WsLoopAsync(_cts.Token));
        }

        async Task PollLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                if (_revoked)
                {
                    // Pausado: nada de impressão nem ack; só uma sonda lenta para saber se a chave voltou.
                    try { await Task.Delay(RevokedProbeMs, token); } catch (OperationCanceledException) { }
                    if (!token.IsCancellationRequested) await ProbeAsync(token);
                    continue;
                }
                await RunCycleAsync(token, "polling");
                try { await Task.Delay(PollIntervalMs, token); } catch (OperationCanceledException) { }
            }
        }

        async Task WsLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                if (_revoked) { try { await Task.Delay(WsRetryMs, token); } catch (OperationCanceledException) { } continue; }
                try
                {
                    using (var ws = new ClientWebSocket())
                    {
                        ws.Options.SetRequestHeader("Authorization", "Bearer " + _settings.DeviceToken);
                        ws.Options.KeepAliveInterval = WsKeepAlive;
                        var wsUri = new Uri(ToWsUrl(_settings.ApiBaseUrl) + "/ws/device");
                        using (var connectCts = CancellationTokenSource.CreateLinkedTokenSource(token))
                        {
                            connectCts.CancelAfter(WsConnectTimeout);
                            await ws.ConnectAsync(wsUri, connectCts.Token);
                        }
                        Interlocked.Exchange(ref _authFailures, 0);
                        StatusChanged?.Invoke("Conectado em tempo real");

                        var buffer = new byte[4096];
                        while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
                        {
                            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                // O servidor revogou a chave (NG-06): pausa na hora, sem esperar a janela.
                                if ((int?)result.CloseStatus == WsCloseRevoked) NoteAuthFailure(401, true);
                                break;
                            }
                            // Qualquer mensagem é só um "cheque agora"; o REST é a fonte de verdade.
                            await RunCycleAsync(token, "tempo real");
                        }
                    }
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                {
                    int auth = AuthStatusOf(ex);
                    if (auth != 0) NoteAuthFailure(auth, false);
                    else StatusChanged?.Invoke("Tempo real indisponível, usando polling (" + ex.Message + ")");
                }

                try { await Task.Delay(WsRetryMs, token); } catch (OperationCanceledException) { }
            }
        }

        // Um ciclo por vez, venha do polling ou do WS. O segundo chamador espera o primeiro
        // terminar e então vê o estado já atualizado no ledger (sem imprimir de novo).
        async Task RunCycleAsync(CancellationToken token, string origin)
        {
            try
            {
                await _cycleGate.WaitAsync(token);
                try { await CheckPendingAsync(token); }
                finally { _cycleGate.Release(); }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { }
            catch (DeviceAuthException ex) { NoteAuthFailure(ex.StatusCode, false); }
            catch (Exception ex) { StatusChanged?.Invoke("Erro (" + origin + "): " + Describe(ex)); }
            finally { PublishProblems(); }
        }

        async Task CheckPendingAsync(CancellationToken token)
        {
            if (!_settings.ReceivePrints) return;

            // 0) watchdog: pedido preso "em impressão" (BeginInvoke perdido, form descartado) vira falha.
            foreach (var stuck in _ledger.ExpireStuck())
                StatusChanged?.Invoke("Impressão do pedido " + stuck + " não terminou em " + (int)PrintLedger.InFlightTimeout.TotalMinutes + " min; vou tentar de novo.");

            // 1) acks que ficaram pendentes (rede caiu depois de imprimir): repete, nunca reimprime.
            foreach (var id in _ledger.PendingAcks()) await TryAckAsync(id, token);

            // 1b) modo PrintJob (PC-03, ADR-0004): o servidor decide o que imprimir (claim com lease) e o cliente obedece.
            if (_settings.UsePrintJobs) { await ClaimJobsAsync(token); return; }

            // 2) pedidos pendentes na API.
            var json = await GetStringAsync("/api/device/orders/pending", token);
            var pending = JsonConvert.DeserializeObject<PendingOrdersResponse>(json);
            if (pending?.Orders == null) return;
            // A lista da API é a verdade: o que falhou aqui e já não está pendente deixa de contar.
            _ledger.ReconcileFailures(pending.Orders.Select(o => o.Id));
            if (pending.Orders.Count == 0) return;

            bool newAlert = false;
            foreach (var reference in pending.Orders)
                if (_ledger.ShouldAlert(reference.Id)) newAlert = true;
            if (newAlert) OrderPending?.Invoke();

            foreach (var reference in pending.Orders)
            {
                token.ThrowIfCancellationRequested();
                if (!_ledger.TryBeginPrint(reference.Id)) continue; // já impresso, em impressão ou em recuo

                PrintableOrder printable = null;
                try
                {
                    var orderJson = await GetStringAsync("/api/device/orders/" + Uri.EscapeDataString(reference.Id) + "/printable", token);
                    printable = JsonConvert.DeserializeObject<PrintableOrderResponse>(orderJson)?.Order;
                }
                catch { _ledger.Release(reference.Id); throw; }

                if (printable == null) { _ledger.Release(reference.Id); continue; }
                // A partir daqui o pedido está "em impressão" até RecordPrinted/ReportPrintFailed
                // (ou até o watchdog do ledger, se o ciclo da UI se perder).
                TicketReady?.Invoke(printable);
            }
        }

        // ---------------------------------------------------------------------------------------------------------------
        // Modo PrintJob (PC-03). Contrato assumido: docs\contrato-printjob-cliente.md (a confirmar pelo Turing, API-12).
        // ---------------------------------------------------------------------------------------------------------------
        public const int MaxJobsPerCycle = 20;
        public static readonly TimeSpan StaleFailureAge = TimeSpan.FromMinutes(30);
        public const string JobKeyPrefix = "job:";

        public static bool IsJobKey(string key) { return key != null && key.StartsWith(JobKeyPrefix, StringComparison.Ordinal); }

        // Um job por vez: só pede o próximo depois de resolver o atual (imprimiu, falhou ou venceu a lease), para a lease
        // não vencer enquanto o job espera na fila LOCAL. Se o servidor oferece um job que não podemos começar agora
        // (em recuo depois de falha), para o laço e tenta no próximo ciclo (sem laço quente).
        async Task ClaimJobsAsync(CancellationToken token)
        {
            _ledger.ForgetStaleFailures(StaleFailureAge);
            // Não reclama enquanto há job em impressão (lease correndo; reclamar o mesmo de novo prenderia o job) nem enquanto
            // há job em recuo de falha (a impressora acabou de falhar; reclamar seguraria o job pela lease inteira e bloquearia
            // as outras impressoras). O job volta à fila do servidor e outra impressora pode pegá-lo.
            // A checagem é a CADA iteração: logo depois de uma falha o laço pediria o próximo job antes de o FAILED chegar ao
            // servidor, que re-ofereceria o mesmo job e o cliente o seguraria pela lease inteira.
            for (int n = 0; n < MaxJobsPerCycle; n++)
            {
                token.ThrowIfCancellationRequested();
                if (_ledger.AnyJobInFlight() || _ledger.AnyJobInBackoff()) return;
                var job = await ClaimNextAsync(token);
                if (job == null) return; // fila vazia
                if (!await HandleJobAsync(job, token)) return;
            }
        }

        // false = parar o laço deste ciclo.
        async Task<bool> HandleJobAsync(PrintJobDto job, CancellationToken token)
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            var key = job.Key;
            int leaseSeconds = job.LeaseSeconds.HasValue && job.LeaseSeconds.Value > 0 ? job.LeaseSeconds.Value : PrintJobDto.DefaultLeaseSeconds;

            // Já impresso aqui (ack perdido ou lease vencida antes do ack): NÃO reimprime, só reenvia PRINTED.
            if (_ledger.IsPrinted(key))
            {
                await TryAckAsync(key, token);
                return true;
            }

            string kind = (job.Kind ?? "").Trim().ToUpperInvariant();
            bool known = kind == PrintJobDto.KindKitchen || kind == PrintJobDto.KindReprint || kind == PrintJobDto.KindTest;
            if (!known)
            {
                StatusChanged?.Invoke("Job de impressão de tipo não suportado (" + (kind.Length > 40 ? kind.Substring(0, 40) : kind) + "): recusado.");
                // O tipo recebido NÃO volta ao servidor (frase fixa nossa, código OTHER).
                await SendJobAckAsync(job.Id, "FAILED", PrintFailure.Other, "tipo de job não suportado", token);
                return true;
            }

            var ticket = job.Ticket;
            if (ticket == null && kind == PrintJobDto.KindTest) ticket = new PrintableOrder { IsTest = true, Code = "TESTE" };
            if (ticket == null)
            {
                await SendJobAckAsync(job.Id, "FAILED", PrintFailure.Other, "tíquete ausente no job", token);
                return true;
            }

            // Em recuo depois de falha (ou já em impressão): não imprime agora; o servidor re-oferece depois.
            if (!_ledger.TryBeginPrint(key)) return false;

            ticket.OrderId = key; // a chave do ledger/ack é o JOB (original e 2ª via do mesmo pedido são jobs diferentes)
            if (kind == PrintJobDto.KindKitchen && _ledger.ShouldAlert(key)) OrderPending?.Invoke();
            TicketReady?.Invoke(ticket);

            // Espera resolver (impresso, falhou ou watchdog). Se a lease vencer com o job ainda em impressão, para: o servidor
            // re-oferece e o ack deste vai receber 409; o que importa é não imprimir duas vezes (o ledger lembra).
            while (_ledger.IsInFlight(key))
            {
                if (clock.Elapsed.TotalSeconds >= leaseSeconds)
                {
                    StatusChanged?.Invoke("A impressão do job demorou mais que a lease (" + leaseSeconds + " s): o servidor pode oferecê-lo de novo.");
                    return false;
                }
                try { await Task.Delay(40, token); } catch (OperationCanceledException) { throw; }
            }
            return true;
        }

        async Task<PrintJobDto> ClaimNextAsync(CancellationToken token)
        {
            using (var content = new StringContent("{}", Encoding.UTF8, "application/json"))
            using (var request = NewRequest(HttpMethod.Post, "/api/device/print-jobs/claim", content))
            using (var response = await _http.SendAsync(request, token))
            {
                int code = (int)response.StatusCode;
                if (code >= 300 && code < 400) throw new InvalidOperationException("a API respondeu com redirecionamento (" + code + "); confira a URL");
                if (code == 401 || code == 403) throw new DeviceAuthException(code);
                if (code == 204) { Interlocked.Exchange(ref _authFailures, 0); return null; }
                response.EnsureSuccessStatusCode();
                Interlocked.Exchange(ref _authFailures, 0);
                var body = await response.Content.ReadAsStringAsync();
                var claim = JsonConvert.DeserializeObject<ClaimResponse>(body);
                var job = claim == null ? null : claim.Job;
                if (job == null) return null;
                if (string.IsNullOrWhiteSpace(job.Id)) throw new InvalidOperationException("job sem id na resposta do claim");
                return job;
            }
        }

        // Ack do job. PRINTED é repetido pelo ledger (TryAckAsync); FAILED é de melhor esforço.
        // Devolve true se o servidor tratou o assunto (200, 409 ou 404): não há o que repetir.
        // FAILED leva só o CÓDIGO da lista fechada (PrintFailure) e uma frase FIXA nossa; nunca texto de exceção, driver, impressora
        // ou do servidor (ADR-0004 §8 item 8). O detalhe fica no log local.
        async Task<bool> SendJobAckAsync(string jobId, string status, string failureCode, string fixedText, CancellationToken token)
        {
            try
            {
                var failCode = PrintFailure.Normalize(failureCode);
                var payload = status == "FAILED"
                    ? JsonConvert.SerializeObject(new { status = status, code = failCode, error = string.IsNullOrWhiteSpace(fixedText) ? PrintFailure.Phrase(failCode) : TrimError(fixedText) })
                    : JsonConvert.SerializeObject(new { status = status });
                using (var content = new StringContent(payload, Encoding.UTF8, "application/json"))
                using (var request = NewRequest(HttpMethod.Post, "/api/device/print-jobs/" + Uri.EscapeDataString(jobId) + "/ack", content))
                using (var response = await _http.SendAsync(request, token))
                {
                    int code = (int)response.StatusCode;
                    if (code == 401 || code == 403) { NoteAuthFailure(code, false); return false; }
                    if (response.IsSuccessStatusCode) { Interlocked.Exchange(ref _authFailures, 0); return true; }
                    if (code == 409)
                    {
                        StatusChanged?.Invoke(status == "PRINTED"
                            ? "O servidor recusou o aviso de impressão (lease vencida ou outro computador assumiu o job): o pedido pode sair de novo em outra impressora."
                            : "O servidor recusou o aviso de falha (lease vencida): ele já recolocou o job na fila.");
                        return true;
                    }
                    if (code == 404) return true;
                    StatusChanged?.Invoke("API recusou o aviso do job (" + code + ")");
                    return false;
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception ex) { StatusChanged?.Invoke("Erro ao avisar o job: " + Describe(ex)); return false; }
        }

        static string TrimError(string error)
        {
            var e = (error ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return e.Length > 200 ? e.Substring(0, 200) : e;
        }

        // O app imprimiu com sucesso. SÍNCRONO e no disco ANTES de qualquer outra coisa (PC-06 a):
        // se o processo cair logo depois, o pedido NÃO é reimpresso. O aviso à API vem em AckPrintedAsync.
        public void RecordPrinted(string orderId)
        {
            _ledger.MarkPrinted(orderId);
            PublishProblems();
        }

        // Avisa a API (repetido no próximo ciclo se falhar). Só depois de RecordPrinted.
        public Task AckPrintedAsync(string orderId) { return TryAckAsync(orderId, CancellationToken.None); }

        public async Task ConfirmPrintedAsync(string orderId)
        {
            RecordPrinted(orderId);
            await AckPrintedAsync(orderId);
        }

        // A impressão falhou: o pedido só volta depois do recuo e sem novo alerta sonoro; entra no
        // indicador "sem imprimir" da tela.
        public void ReportPrintFailed(string orderId, string code = null, string failureCode = null)
        {
            _ledger.MarkPrintFailed(orderId, code);
            PublishProblems();
            // Job: avisa o servidor com o motivo (melhor esforço; se não chegar, a lease vence e ele recoloca na fila).
            if (IsJobKey(orderId))
            {
                var jobId = orderId.Substring(JobKeyPrefix.Length);
                Task.Run(() => SendJobAckAsync(jobId, "FAILED", failureCode, null, CancellationToken.None));
            }
        }

        async Task TryAckAsync(string orderId, CancellationToken token)
        {
            if (IsJobKey(orderId))
            {
                // PRINTED do job: 200/409/404 encerram (409 = lease vencida, já avisado); o resto repete no próximo ciclo.
                if (await SendJobAckAsync(orderId.Substring(JobKeyPrefix.Length), "PRINTED", null, null, token)) _ledger.MarkAcked(orderId);
                return;
            }
            try
            {
                using (var content = new StringContent("{}", Encoding.UTF8, "application/json"))
                using (var request = NewRequest(HttpMethod.Post, "/api/device/orders/" + Uri.EscapeDataString(orderId) + "/printed", content))
                using (var response = await _http.SendAsync(request, token))
                {
                    var code = (int)response.StatusCode;
                    if (code == 401 || code == 403) { NoteAuthFailure(code, false); return; }
                    // 2xx: confirmado. 404: o pedido não existe mais na API; não há o que repetir.
                    if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound)
                    {
                        Interlocked.Exchange(ref _authFailures, 0);
                        _ledger.MarkAcked(orderId);
                    }
                    else
                        StatusChanged?.Invoke("API recusou o aviso de impressão (" + code + "); tentarei de novo");
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception ex) { StatusChanged?.Invoke("Erro ao avisar impressão, tentarei de novo: " + Describe(ex)); }
        }

        async Task<string> GetStringAsync(string path, CancellationToken token)
        {
            using (var request = NewRequest(HttpMethod.Get, path, null))
            using (var response = await _http.SendAsync(request, token))
            {
                int code = (int)response.StatusCode;
                if (code >= 300 && code < 400)
                    throw new InvalidOperationException("a API respondeu com redirecionamento (" + code + "); confira a URL");
                if (code == 401 || code == 403) throw new DeviceAuthException(code);
                response.EnsureSuccessStatusCode();
                var body = await response.Content.ReadAsStringAsync();
                Interlocked.Exchange(ref _authFailures, 0);
                return body;
            }
        }

        // O token é lido a cada requisição: uma chave nova gravada em "Configurar chave..." vale na hora.
        HttpRequestMessage NewRequest(HttpMethod method, string path, HttpContent content)
        {
            var req = new HttpRequestMessage(method, path) { Content = content };
            req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _settings.DeviceToken);
            return req;
        }

        // PC-05: conta recusas SEGUIDAS; qualquer resposta boa zera. Só declara revogada com o mínimo de
        // recusas E a janela de tempo (ou direct: o servidor disse que revogou). A pausa é reversível.
        void NoteAuthFailure(int status, bool direct)
        {
            lock (_problemsLock)
            {
                if (_revoked) return;
                var now = DateTime.UtcNow;
                if (_authFailures == 0) _authFirstFailureUtc = now;
                int n = ++_authFailures;
                if (!direct && (n < AuthFailureLimit || now - _authFirstFailureUtc < AuthFailureWindow))
                {
                    StatusChanged?.Invoke("Chave de impressora recusada pela API (" + status + "), tentativa " + n + "; vou insistir antes de pausar");
                    return;
                }
                _revoked = true;
            }
            StatusChanged?.Invoke("Chave de impressora revogada ou inválida (" + status + "). A impressão automática foi PAUSADA. Gere uma nova chave no painel e use \"Configurar chave...\" (vale na hora; se mudar a URL da API, reabra o app). O app testa de novo a cada " + Math.Max(1, RevokedProbeMs / 60000) + " min.");
            KeyRevoked?.Invoke();
        }

        // Sonda da pausa: uma chamada leve com a chave ATUAL. 200 retoma; qualquer outra coisa mantém a pausa.
        async Task ProbeAsync(CancellationToken token)
        {
            if (!_revoked) return;
            try
            {
                using (var request = NewRequest(HttpMethod.Get, "/api/device/orders/pending", null))
                using (var response = await _http.SendAsync(request, token))
                {
                    if (!response.IsSuccessStatusCode) return;
                }
            }
            catch { return; }
            lock (_problemsLock)
            {
                if (!_revoked) return;
                _revoked = false;
                _authFailures = 0;
            }
            StatusChanged?.Invoke("A chave de impressora voltou a ser aceita. Impressão retomada.");
            KeyRestored?.Invoke();
        }

        // Depois de "Configurar chave...": testa já, sem esperar a sonda lenta.
        public void RetryNow()
        {
            var t = _cts?.Token ?? CancellationToken.None;
            if (_revoked) Task.Run(() => ProbeAsync(t));
        }

        // 401/403 vindo do handshake do WebSocket (a exceção traz o WebException por dentro).
        public static int AuthStatusOf(Exception ex)
        {
            for (var e = ex; e != null; e = e.InnerException)
            {
                var we = e as WebException;
                var resp = we?.Response as HttpWebResponse;
                if (resp != null && (resp.StatusCode == HttpStatusCode.Unauthorized || resp.StatusCode == HttpStatusCode.Forbidden))
                    return (int)resp.StatusCode;
                var da = e as DeviceAuthException;
                if (da != null) return da.StatusCode;
            }
            return 0;
        }

        // Publica a lista de "sem imprimir" só quando ela muda.
        void PublishProblems()
        {
            IList<string> list;
            string key;
            lock (_problemsLock)
            {
                list = _ledger.FailedOrders();
                key = string.Join("|", list);
                if (key == _lastProblemsKey) return;
                _lastProblemsKey = key;
            }
            try { PrintProblemsChanged?.Invoke(list); } catch { }
        }

        // Timeout do HttpClient chega como TaskCanceledException: mostra algo legível.
        static string Describe(Exception ex)
        {
            if (ex is TaskCanceledException) return "tempo esgotado (" + (int)HttpTimeout.TotalSeconds + " s)";
            return ex.Message;
        }

        static string ToWsUrl(string httpUrl)
        {
            if (httpUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return "wss://" + httpUrl.Substring(8);
            if (httpUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return "ws://" + httpUrl.Substring(7);
            return "ws://" + httpUrl;
        }

        public void Dispose()
        {
            try { _cts?.Cancel(); } catch { }
            try { _http?.Dispose(); } catch { }
        }
    }
}
