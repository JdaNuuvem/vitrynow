using System;
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
    // Uma única conexão WS com a NOSSA API: o WS é só "aviso para checar agora"; o REST é a fonte
    // de verdade (pending/printable/printed). Se o WS cair, o polling periódico garante que nada
    // se perde.
    //
    // PC-02 (B06, B28): polling e WS passam pelo MESMO portão (um ciclo por vez), o dedupe por
    // orderId e o ack persistido ficam no PrintLedger, e toda chamada de rede tem timeout.
    public class DeviceClient : IDisposable
    {
        public static readonly TimeSpan HttpTimeout = TimeSpan.FromSeconds(15);
        public static readonly TimeSpan WsConnectTimeout = TimeSpan.FromSeconds(10);
        static readonly TimeSpan WsKeepAlive = TimeSpan.FromSeconds(20);

        public int PollIntervalMs { get; set; } = 15000;

        public event Action OrderPending;
        public event Action<PrintableOrder> TicketReady;
        public event Action<string> StatusChanged;

        // AllowAutoRedirect=false: a API nunca redireciona, e o Bearer não pode seguir para outro host.
        readonly HttpClient _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = HttpTimeout };
        readonly SemaphoreSlim _cycleGate = new SemaphoreSlim(1, 1);
        readonly PrintLedger _ledger;
        CancellationTokenSource _cts;
        Task _pollTask;
        Task _wsTask;

        public DeviceClient() : this(new PrintLedger(AppSettings.LedgerPath)) { }

        public DeviceClient(PrintLedger ledger) { _ledger = ledger; }

        public void Start()
        {
            var urlProblem = ApiUrlPolicy.Validate(AppSettings.Current.ApiBaseUrl);
            if (urlProblem != null)
            {
                StatusChanged?.Invoke("Configuração recusada: " + urlProblem);
                return; // nem conecta: a chave não vai por canal inseguro
            }
            _cts = new CancellationTokenSource();
            _http.BaseAddress = new Uri(AppSettings.Current.ApiBaseUrl);
            _http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", AppSettings.Current.DeviceToken);
            _ledger.Prune();

            _pollTask = Task.Run(() => PollLoopAsync(_cts.Token));
            _wsTask = Task.Run(() => WsLoopAsync(_cts.Token));
        }

        async Task PollLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                await RunCycleAsync(token, "polling");
                try { await Task.Delay(PollIntervalMs, token); } catch (OperationCanceledException) { }
            }
        }

        async Task WsLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using (var ws = new ClientWebSocket())
                    {
                        ws.Options.SetRequestHeader("Authorization", "Bearer " + AppSettings.Current.DeviceToken);
                        ws.Options.KeepAliveInterval = WsKeepAlive;
                        var wsUri = new Uri(ToWsUrl(AppSettings.Current.ApiBaseUrl) + "/ws/device");
                        using (var connectCts = CancellationTokenSource.CreateLinkedTokenSource(token))
                        {
                            connectCts.CancelAfter(WsConnectTimeout);
                            await ws.ConnectAsync(wsUri, connectCts.Token);
                        }
                        StatusChanged?.Invoke("Conectado em tempo real");

                        var buffer = new byte[4096];
                        while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
                        {
                            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close) break;
                            // Qualquer mensagem é só um "cheque agora"; o REST é a fonte de verdade.
                            await RunCycleAsync(token, "tempo real");
                        }
                    }
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                {
                    StatusChanged?.Invoke("Tempo real indisponível, usando polling (" + ex.Message + ")");
                }

                try { await Task.Delay(5000, token); } catch (OperationCanceledException) { }
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
            catch (Exception ex) { StatusChanged?.Invoke("Erro (" + origin + "): " + Describe(ex)); }
        }

        async Task CheckPendingAsync(CancellationToken token)
        {
            if (!AppSettings.Current.ReceivePrints) return;

            // 1) acks que ficaram pendentes (rede caiu depois de imprimir): repete, nunca reimprime.
            foreach (var id in _ledger.PendingAcks()) await TryAckAsync(id, token);

            // 2) pedidos pendentes na API.
            var json = await GetStringAsync("/api/device/orders/pending", token);
            var pending = JsonConvert.DeserializeObject<PendingOrdersResponse>(json);
            if (pending?.Orders == null || pending.Orders.Count == 0) return;

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
                    var orderJson = await GetStringAsync("/api/device/orders/" + reference.Id + "/printable", token);
                    printable = JsonConvert.DeserializeObject<PrintableOrderResponse>(orderJson)?.Order;
                }
                catch { _ledger.Release(reference.Id); throw; }

                if (printable == null) { _ledger.Release(reference.Id); continue; }
                // A partir daqui o pedido está "em impressão" até ConfirmPrintedAsync/ReportPrintFailed.
                TicketReady?.Invoke(printable);
            }
        }

        // O app imprimiu com sucesso: grava no disco primeiro, depois avisa a API (com retry).
        public async Task ConfirmPrintedAsync(string orderId)
        {
            _ledger.MarkPrinted(orderId);
            await TryAckAsync(orderId, CancellationToken.None);
        }

        // A impressão falhou: o pedido só volta depois do recuo e sem novo alerta sonoro.
        public void ReportPrintFailed(string orderId) => _ledger.MarkPrintFailed(orderId);

        async Task TryAckAsync(string orderId, CancellationToken token)
        {
            try
            {
                using (var content = new StringContent("{}", Encoding.UTF8, "application/json"))
                using (var response = await _http.PostAsync("/api/device/orders/" + Uri.EscapeDataString(orderId) + "/printed", content, token))
                {
                    // 2xx: confirmado. 404: o pedido não existe mais na API; não há o que repetir.
                    if (response.IsSuccessStatusCode || response.StatusCode == HttpStatusCode.NotFound)
                        _ledger.MarkAcked(orderId);
                    else
                        StatusChanged?.Invoke("API recusou o aviso de impressão (" + (int)response.StatusCode + "); tentarei de novo");
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (Exception ex) { StatusChanged?.Invoke("Erro ao avisar impressão, tentarei de novo: " + Describe(ex)); }
        }

        async Task<string> GetStringAsync(string path, CancellationToken token)
        {
            using (var response = await _http.GetAsync(path, token))
            {
                if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
                    throw new InvalidOperationException("a API respondeu com redirecionamento (" + (int)response.StatusCode + "); confira a URL");
                if (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden)
                    throw new InvalidOperationException("chave de impressora recusada pela API (" + (int)response.StatusCode + ")");
                response.EnsureSuccessStatusCode();
                return await response.Content.ReadAsStringAsync();
            }
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
