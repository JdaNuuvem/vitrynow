using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Services
{
    // Registro local e persistente do que este computador já imprimiu (PC-02 / B06).
    //
    // Resolve os problemas do print-client original:
    //  1. dedupe por orderId: o polling e o WebSocket não imprimem o mesmo pedido duas vezes
    //     (TryBeginPrint é atômico; "em impressão" também bloqueia);
    //  2. ack persistido: depois de imprimir, o registro é gravado em disco ANTES de avisar a API.
    //     Se o aviso falhar (rede) ou o app fechar, o pedido continua "impresso, ack pendente":
    //     não reimprime e o ack é repetido no próximo ciclo;
    //  3. falha de impressão com recuo (backoff): o pedido volta, mas não a cada 15 s nem com
    //     alerta sonoro repetido (ShouldAlert devolve true uma vez por pedido);
    //  4. (PC-06) watchdog: pedido "em impressão" há mais de InFlightTimeout é tratado como falha
    //     (o BeginInvoke da UI pode ter se perdido) e vira "sem imprimir" visível, em vez de ficar
    //     preso até reiniciar o app; FailedOrders() alimenta o indicador persistente da tela.
    //
    // Sem dependência de WinForms nem de rede: testável no SelfTest.
    public class PrintLedger
    {
        public class Entry
        {
            [JsonProperty("printedAt")] public DateTime? PrintedAtUtc { get; set; }
            [JsonProperty("ackPending")] public bool AckPending { get; set; }
            [JsonProperty("failures")] public int Failures { get; set; }
            [JsonProperty("retryAfter")] public DateTime? RetryAfterUtc { get; set; }
            [JsonProperty("ackedAt")] public DateTime? AckedAtUtc { get; set; }
            [JsonProperty("code", NullValueHandling = NullValueHandling.Ignore)] public string Code { get; set; }
        }

        public static readonly TimeSpan RetentionAfterAck = TimeSpan.FromDays(7);
        public static readonly TimeSpan BackoffBase = TimeSpan.FromSeconds(15);
        public static readonly TimeSpan BackoffMax = TimeSpan.FromMinutes(5);
        // Tempo máximo "em impressão". O spooler do Windows aceita o trabalho em segundos; passou
        // de 2 min, o ciclo de impressão se perdeu.
        public static readonly TimeSpan InFlightTimeout = TimeSpan.FromMinutes(2);

        readonly object _lock = new object();
        readonly string _path;
        readonly Func<DateTime> _utcNow;
        readonly Dictionary<string, Entry> _entries = new Dictionary<string, Entry>();
        readonly Dictionary<string, DateTime> _inFlight = new Dictionary<string, DateTime>();
        readonly HashSet<string> _alerted = new HashSet<string>();

        // path == null: só em memória (testes).
        public PrintLedger(string path, Func<DateTime> utcNow = null)
        {
            _path = path;
            _utcNow = utcNow ?? (() => DateTime.UtcNow);
            Load();
        }

        // Verdadeiro se o chamador pode imprimir agora. Falso se já está em impressão, já foi
        // impresso (ack pendente ou confirmado) ou está no recuo depois de uma falha.
        public bool TryBeginPrint(string orderId)
        {
            if (string.IsNullOrEmpty(orderId)) return false;
            lock (_lock)
            {
                if (_inFlight.ContainsKey(orderId)) return false;
                Entry e;
                if (_entries.TryGetValue(orderId, out e))
                {
                    if (e.PrintedAtUtc.HasValue) return false;
                    if (e.RetryAfterUtc.HasValue && _utcNow() < e.RetryAfterUtc.Value) return false;
                }
                _inFlight[orderId] = _utcNow();
                return true;
            }
        }

        // A impressão deu certo. Grava em disco antes de qualquer chamada de rede.
        public void MarkPrinted(string orderId)
        {
            lock (_lock)
            {
                _inFlight.Remove(orderId);
                var e = GetOrAdd(orderId);
                e.PrintedAtUtc = _utcNow();
                e.AckPending = true;
                e.RetryAfterUtc = null;
                e.Failures = 0; // impresso: sai do indicador "sem imprimir"
                Save();
            }
        }

        // A impressão falhou: libera o pedido, mas só volta depois do recuo (15 s, 30 s, ... 5 min).
        // `code` (número do pedido) só serve para o aviso na tela.
        public void MarkPrintFailed(string orderId, string code = null)
        {
            lock (_lock)
            {
                _inFlight.Remove(orderId);
                RegisterFailure(orderId, code);
                Save();
            }
        }

        void RegisterFailure(string orderId, string code)
        {
            var e = GetOrAdd(orderId);
            e.Failures++;
            if (!string.IsNullOrEmpty(code)) e.Code = code;
            double seconds = BackoffBase.TotalSeconds * Math.Pow(2, Math.Min(e.Failures - 1, 10));
            var delay = TimeSpan.FromSeconds(Math.Min(seconds, BackoffMax.TotalSeconds));
            e.RetryAfterUtc = _utcNow() + delay;
        }

        // Watchdog (PC-06 b): pedidos em impressão há mais que InFlightTimeout viram falha (com recuo).
        // Devolve os ids expirados para o chamador avisar.
        public IList<string> ExpireStuck()
        {
            lock (_lock)
            {
                var limit = _utcNow() - InFlightTimeout;
                var stuck = _inFlight.Where(kv => kv.Value <= limit).Select(kv => kv.Key).ToList();
                foreach (var id in stuck) { _inFlight.Remove(id); RegisterFailure(id, null); }
                if (stuck.Count > 0) Save();
                return stuck;
            }
        }

        // Liberação sem resultado (ex.: falha ao baixar o tíquete): sem contar como falha de impressão.
        public void Release(string orderId)
        {
            lock (_lock) { _inFlight.Remove(orderId); }
        }

        public void MarkAcked(string orderId)
        {
            lock (_lock)
            {
                var e = GetOrAdd(orderId);
                e.AckPending = false;
                e.AckedAtUtc = _utcNow();
                Save();
            }
        }

        public bool IsPrinted(string orderId)
        {
            lock (_lock)
            {
                Entry e;
                return _entries.TryGetValue(orderId, out e) && e.PrintedAtUtc.HasValue;
            }
        }

        public IList<string> PendingAcks()
        {
            lock (_lock)
            {
                return _entries.Where(kv => kv.Value.AckPending).Select(kv => kv.Key).ToList();
            }
        }

        // Pedidos que falharam ao imprimir e ainda não saíram (PC-06 d). Rótulo = "#código" quando
        // conhecido. Ordenado, para comparar a lista entre ciclos.
        public IList<string> FailedOrders()
        {
            lock (_lock)
            {
                return _entries.Where(kv => kv.Value.Failures > 0 && !kv.Value.PrintedAtUtc.HasValue)
                               .Select(kv => string.IsNullOrEmpty(kv.Value.Code) ? kv.Key : "#" + kv.Value.Code)
                               .OrderBy(x => x, StringComparer.Ordinal).ToList();
            }
        }

        // O que a API ainda considera pendente é a verdade: um pedido que falhou aqui mas não está
        // mais na lista (cancelado, impresso por outro computador) deixa de contar como "sem imprimir".
        public int ReconcileFailures(IEnumerable<string> pendingIds)
        {
            var pending = new HashSet<string>(pendingIds ?? Enumerable.Empty<string>());
            lock (_lock)
            {
                var gone = _entries.Where(kv => kv.Value.Failures > 0 && !kv.Value.PrintedAtUtc.HasValue
                                                && !pending.Contains(kv.Key) && !_inFlight.ContainsKey(kv.Key))
                                   .Select(kv => kv.Key).ToList();
                foreach (var id in gone) { _entries[id].Failures = 0; _entries[id].RetryAfterUtc = null; }
                if (gone.Count > 0) Save();
                return gone.Count;
            }
        }

        // Verdadeiro só na primeira vez que o pedido é visto (alerta sonoro/popup uma vez por pedido).
        public bool ShouldAlert(string orderId)
        {
            lock (_lock)
            {
                Entry e;
                if (_entries.TryGetValue(orderId, out e) && e.PrintedAtUtc.HasValue) return false;
                return _alerted.Add(orderId);
            }
        }

        // Remove registros já confirmados e antigos (não toca em ack pendente).
        public int Prune()
        {
            lock (_lock)
            {
                var limit = _utcNow() - RetentionAfterAck;
                var old = _entries.Where(kv => !kv.Value.AckPending && kv.Value.AckedAtUtc.HasValue && kv.Value.AckedAtUtc.Value < limit)
                                  .Select(kv => kv.Key).ToList();
                foreach (var k in old) { _entries.Remove(k); _alerted.Remove(k); }
                if (old.Count > 0) Save();
                return old.Count;
            }
        }

        Entry GetOrAdd(string orderId)
        {
            Entry e;
            if (!_entries.TryGetValue(orderId, out e)) { e = new Entry(); _entries[orderId] = e; }
            return e;
        }

        void Load()
        {
            if (_path == null || !File.Exists(_path)) return;
            try
            {
                var map = JsonConvert.DeserializeObject<Dictionary<string, Entry>>(File.ReadAllText(_path));
                if (map != null) foreach (var kv in map) _entries[kv.Key] = kv.Value ?? new Entry();
            }
            catch
            {
                // Arquivo corrompido: guarda uma cópia e recomeça (melhor reimprimir do que travar).
                try { File.Move(_path, _path + ".corrupt-" + _utcNow().ToString("yyyyMMddHHmmss")); } catch { }
            }
        }

        // Escrita atômica: grava em arquivo temporário e troca.
        void Save()
        {
            if (_path == null) return;
            try
            {
                var dir = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                var tmp = _path + ".tmp";
                File.WriteAllText(tmp, JsonConvert.SerializeObject(_entries, Formatting.Indented));
                if (File.Exists(_path)) File.Replace(tmp, _path, null);
                else File.Move(tmp, _path);
            }
            catch { /* sem permissão: segue só em memória nesta sessão */ }
        }
    }
}
