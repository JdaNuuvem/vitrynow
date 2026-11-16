using System;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using MeuCardapio.PrintClient.Models;

namespace MeuCardapio.PrintClient.Services
{
    // Substitui a dupla WS 43218/43219 + Cloud Functions do original por UMA conexão com o
    // NOSSO backend: WS só como "aviso para checar agora", REST como fonte de verdade (pending/
    // printable/printed). Se o WS cair, o polling periódico garante que nada se perde.
    public class DeviceClient : IDisposable
    {
        public int PollIntervalMs { get; set; } = 15000;

        public event Action OrderPending;
        public event Action<PrintableOrder> TicketReady;
        public event Action<string> StatusChanged;

        readonly HttpClient _http = new HttpClient();
        CancellationTokenSource _cts;
        Task _pollTask;
        Task _wsTask;

        public void Start()
        {
            _cts = new CancellationTokenSource();
            _http.BaseAddress = new Uri(AppSettings.Current.ApiBaseUrl);
            _http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", AppSettings.Current.DeviceToken);

            _pollTask = Task.Run(() => PollLoopAsync(_cts.Token));
            _wsTask = Task.Run(() => WsLoopAsync(_cts.Token));
        }

        async Task PollLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try { await CheckPendingAsync(token); }
                catch (Exception ex) { StatusChanged?.Invoke("Erro no polling: " + ex.Message); }

                try { await Task.Delay(PollIntervalMs, token); } catch (TaskCanceledException) { }
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
                        var wsUri = new Uri(ToWsUrl(AppSettings.Current.ApiBaseUrl) + "/ws/device");
                        await ws.ConnectAsync(wsUri, token);
                        StatusChanged?.Invoke("Conectado em tempo real");

                        var buffer = new byte[4096];
                        while (ws.State == WebSocketState.Open && !token.IsCancellationRequested)
                        {
                            var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (result.MessageType == WebSocketMessageType.Close) break;
                            // Qualquer mensagem é só um "cheque agora" — o REST é a fonte de verdade.
                            await CheckPendingAsync(token);
                        }
                    }
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                {
                    StatusChanged?.Invoke("Tempo real indisponível, usando polling (" + ex.Message + ")");
                }

                try { await Task.Delay(5000, token); } catch (TaskCanceledException) { }
            }
        }

        async Task CheckPendingAsync(CancellationToken token)
        {
            if (!AppSettings.Current.ReceivePrints) return;

            var json = await _http.GetStringAsync("/api/device/orders/pending");
            var pending = JsonConvert.DeserializeObject<PendingOrdersResponse>(json);
            if (pending?.Orders == null || pending.Orders.Count == 0) return;

            OrderPending?.Invoke();

            foreach (var reference in pending.Orders)
            {
                token.ThrowIfCancellationRequested();
                var orderJson = await _http.GetStringAsync("/api/device/orders/" + reference.Id + "/printable");
                var printable = JsonConvert.DeserializeObject<PrintableOrderResponse>(orderJson)?.Order;
                if (printable != null) TicketReady?.Invoke(printable);
            }
        }

        public async Task MarkPrintedAsync(string orderId)
        {
            try
            {
                await _http.PostAsync("/api/device/orders/" + orderId + "/printed",
                    new StringContent("{}", Encoding.UTF8, "application/json"));
            }
            catch (Exception ex) { StatusChanged?.Invoke("Erro ao marcar impresso: " + ex.Message); }
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
