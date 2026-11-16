using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using MeuCardapio.PrintClient.Services;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient
{
    // Testes do PC-02 (B06, B28, R12): dedupe, ack persistido, recuo e DPAPI. Sem rede, sem
    // impressora, sem WinForms; roda no mesmo run-selftest.ps1.
    static class SelfTestDevice
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        public static void Run()
        {
            var dir = Path.Combine(Path.GetTempPath(), "meucardapio_selftest_ledger_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Ledger(dir);
                Secrets();
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }

        static void Ledger(string dir)
        {
            var now = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);
            Func<DateTime> clock = () => now;

            // dedupe: só um chamador imprime (polling x WS)
            var l = new PrintLedger(null, clock);
            Check("ledger: 1a tentativa pode imprimir", l.TryBeginPrint("A"));
            Check("ledger: 2a tentativa (em impressao) e bloqueada", !l.TryBeginPrint("A"));
            Check("ledger: orderId vazio e recusado", !l.TryBeginPrint("") && !l.TryBeginPrint(null));

            // concorrencia: 50 threads no mesmo pedido, exatamente 1 vence
            var l2 = new PrintLedger(null, clock);
            int winners = 0;
            Task.WaitAll(Enumerable.Range(0, 50).Select(i => Task.Run(() => { if (l2.TryBeginPrint("X")) Interlocked.Increment(ref winners); })).ToArray());
            Check("ledger: 50 threads simultaneas, 1 so imprime", winners == 1);

            // impresso: nao reimprime, ack pendente ate confirmar
            l.MarkPrinted("A");
            Check("ledger: impresso nao reimprime", !l.TryBeginPrint("A") && l.IsPrinted("A"));
            Check("ledger: ack pendente listado", l.PendingAcks().Contains("A"));
            l.MarkAcked("A");
            Check("ledger: ack confirmado sai da lista", l.PendingAcks().Count == 0);
            Check("ledger: confirmado continua sem reimprimir", !l.TryBeginPrint("A"));

            // persistencia: reabrir o app com ack pendente nao reimprime e mantem o ack
            var path = Path.Combine(dir, "printed.json");
            var p1 = new PrintLedger(path, clock);
            p1.TryBeginPrint("B"); p1.MarkPrinted("B");
            var p2 = new PrintLedger(path, clock);
            Check("ledger: persistido, nao reimprime apos reiniciar", !p2.TryBeginPrint("B"));
            Check("ledger: persistido, ack pendente sobrevive ao reinicio", p2.PendingAcks().Contains("B"));
            p2.MarkAcked("B");
            Check("ledger: ack persistido", new PrintLedger(path, clock).PendingAcks().Count == 0);

            // falha de impressao: recuo 15s, 30s, ... teto 5 min; volta a poder imprimir
            var f = new PrintLedger(null, () => now);
            f.TryBeginPrint("F"); f.MarkPrintFailed("F");
            Check("recuo: logo apos a falha nao tenta", !f.TryBeginPrint("F"));
            now = now.AddSeconds(14);
            Check("recuo: 14 s depois ainda nao", !f.TryBeginPrint("F"));
            now = now.AddSeconds(2);
            Check("recuo: 16 s depois tenta de novo", f.TryBeginPrint("F"));
            f.MarkPrintFailed("F");
            now = now.AddSeconds(29);
            Check("recuo: 2a falha espera 30 s", !f.TryBeginPrint("F"));
            now = now.AddSeconds(2);
            Check("recuo: 2a falha libera apos 30 s", f.TryBeginPrint("F"));
            for (int i = 0; i < 12; i++) { f.MarkPrintFailed("F"); now = now.AddMinutes(5).AddSeconds(1); f.TryBeginPrint("F"); }
            f.MarkPrintFailed("F");
            now = now.AddMinutes(4);
            Check("recuo: teto de 5 min (4 min depois ainda espera)", !f.TryBeginPrint("F"));
            now = now.AddMinutes(1).AddSeconds(1);
            Check("recuo: teto de 5 min (libera apos 5 min)", f.TryBeginPrint("F"));

            // alerta sonoro: uma vez por pedido, nunca para pedido ja impresso
            var a = new PrintLedger(null, clock);
            Check("alerta: 1a vez toca", a.ShouldAlert("N"));
            Check("alerta: 2a vez nao toca", !a.ShouldAlert("N"));
            a.TryBeginPrint("P"); a.MarkPrinted("P");
            Check("alerta: pedido impresso nao toca", !a.ShouldAlert("P"));

            // liberar sem resultado nao conta como falha
            var r = new PrintLedger(null, clock);
            r.TryBeginPrint("R"); r.Release("R");
            Check("release: libera na hora, sem recuo", r.TryBeginPrint("R"));

            // arquivo corrompido nao derruba o app
            var bad = Path.Combine(dir, "bad.json");
            File.WriteAllText(bad, "{{{ nao e json");
            bool ok;
            try { var b = new PrintLedger(bad, clock); ok = b.TryBeginPrint("Z"); } catch { ok = false; }
            Check("ledger corrompido: recomeca vazio sem excecao", ok);

            // limpeza: remove confirmados antigos, preserva ack pendente
            var pr = new PrintLedger(null, () => now);
            pr.TryBeginPrint("OLD"); pr.MarkPrinted("OLD"); pr.MarkAcked("OLD");
            pr.TryBeginPrint("PEND"); pr.MarkPrinted("PEND");
            now = now.AddDays(8);
            int removed = pr.Prune();
            Check("prune: remove confirmado com mais de 7 dias", removed == 1 && pr.TryBeginPrint("OLD"));
            Check("prune: preserva ack pendente", pr.PendingAcks().Contains("PEND") && !pr.TryBeginPrint("PEND"));
        }

        static void Secrets()
        {
            const string token = "mc_dev_TOKEN-super-secreto-123";
            var prot = SecretStore.Protect(token);
            Check("dpapi: cifrado nao contem o texto puro", prot.Length > 0 && prot.IndexOf("TOKEN-super", StringComparison.Ordinal) < 0);
            Check("dpapi: ida e volta", SecretStore.Unprotect(prot) == token);
            Check("dpapi: lixo vira vazio, sem excecao", SecretStore.Unprotect("isso-nao-e-base64!") == "" && SecretStore.Unprotect("AAAA") == "");
            Check("dpapi: vazio fica vazio", SecretStore.Protect("") == "" && SecretStore.Unprotect("") == "");

            var s = new AppSettings { ApiBaseUrl = "http://x", DeviceToken = token };
            var json = JsonConvert.SerializeObject(s);
            Check("settings: arquivo nao tem o token em texto puro", json.IndexOf("TOKEN-super", StringComparison.Ordinal) < 0);
            Check("settings: grava DeviceTokenProtected", json.Contains("DeviceTokenProtected"));
            var back = JsonConvert.DeserializeObject<AppSettings>(json);
            Check("settings: ida e volta do token", back.DeviceToken == token && back.IsConfigured && !back.MigratedFromPlaintext);

            var legacy = JsonConvert.DeserializeObject<AppSettings>("{\"ApiBaseUrl\":\"http://x\",\"DeviceToken\":\"" + token + "\"}");
            Check("settings: migra token antigo em texto puro", legacy.DeviceToken == token && legacy.MigratedFromPlaintext);
            Check("settings: depois da migracao, regravar nao deixa o texto puro", JsonConvert.SerializeObject(legacy).IndexOf("TOKEN-super", StringComparison.Ordinal) < 0);
        }
    }
}
