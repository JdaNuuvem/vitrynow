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
                UrlPolicy();
                SettingsFile(dir);
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

        // Parecer Nightingale C1: Bearer só em claro para a própria máquina.
        static void UrlPolicy()
        {
            Check("url: http://api.exemplo.com recusada", !ApiUrlPolicy.IsAllowed("http://api.exemplo.com"));
            Check("url: http://192.168.0.10:3001 recusada (rede local nao e localhost)", !ApiUrlPolicy.IsAllowed("http://192.168.0.10:3001"));
            Check("url: http://localhost:3001 aceita", ApiUrlPolicy.IsAllowed("http://localhost:3001"));
            Check("url: http://127.0.0.1:3001 aceita", ApiUrlPolicy.IsAllowed("http://127.0.0.1:3001"));
            Check("url: http://[::1]:3001 aceita", ApiUrlPolicy.IsAllowed("http://[::1]:3001"));
            Check("url: https://api.exemplo.com aceita", ApiUrlPolicy.IsAllowed("https://api.exemplo.com"));
            Check("url: vazia/lixo/ftp recusadas", !ApiUrlPolicy.IsAllowed("") && !ApiUrlPolicy.IsAllowed(null)
                && !ApiUrlPolicy.IsAllowed("api.exemplo.com") && !ApiUrlPolicy.IsAllowed("ftp://x.com"));
            Check("url: usuario:senha na URL recusado", !ApiUrlPolicy.IsAllowed("https://user:pass@api.exemplo.com"));
            Check("url: host que apenas comeca com localhost recusado", !ApiUrlPolicy.IsAllowed("http://localhost.evil.com"));
            var bad = new AppSettings { ApiBaseUrl = "http://api.exemplo.com", DeviceToken = "t" };
            Check("url: config antiga insegura vira 'nao configurada'", !bad.IsConfigured);
            Check("url: config segura com chave e 'configurada'", new AppSettings { ApiBaseUrl = "https://api.exemplo.com", DeviceToken = "t" }.IsConfigured);
        }

        // Parecer Nightingale C2: gravação atômica, falha visível, migração e ordem das propriedades.
        static void SettingsFile(string dir)
        {
            const string token = "mc_dev_TOKEN-super-secreto-123";

            // gravação normal + arquivo anterior intacto quando a gravação falha
            var path = Path.Combine(dir, "settings.json");
            var s = new AppSettings { ApiBaseUrl = "https://api.exemplo.com", DeviceToken = token };
            Check("save: grava e devolve true", AppSettings.SaveTo(path, s) && File.Exists(path));
            Check("save: nao deixa .tmp para tras", !File.Exists(path + ".tmp"));
            var before = File.ReadAllText(path);
            File.SetAttributes(path, FileAttributes.ReadOnly); // falha de I/O injetada
            bool ok = AppSettings.SaveTo(path, new AppSettings { ApiBaseUrl = "https://outra.exemplo.com", DeviceToken = "outra" });
            File.SetAttributes(path, FileAttributes.Normal);
            Check("save: falha de I/O devolve false (nao engole)", !ok);
            Check("save: falha de I/O deixa o arquivo anterior intacto", File.ReadAllText(path) == before);
            Check("save: falha de I/O nao deixa .tmp", !File.Exists(path + ".tmp"));
            Check("save: arquivo anterior ainda carrega a chave", AppSettings.LoadFrom(path).DeviceToken == token);

            // migração normal: texto puro some do disco, avisa para girar a chave
            var legacyPath = Path.Combine(dir, "legacy.json");
            File.WriteAllText(legacyPath, "{\"ApiBaseUrl\":\"https://api.exemplo.com\",\"DeviceToken\":\"" + token + "\"}");
            var migrated = AppSettings.LoadFrom(legacyPath);
            Check("migracao: token em memoria", migrated.DeviceToken == token);
            Check("migracao: resultado Protected", migrated.Migration == TokenMigration.Protected);
            Check("migracao: texto puro saiu do disco", File.ReadAllText(legacyPath).IndexOf("TOKEN-super", StringComparison.Ordinal) < 0);
            Check("migracao: segunda abertura nao migra de novo", AppSettings.LoadFrom(legacyPath).Migration == TokenMigration.None);

            // migração com disco somente leitura: aviso (SaveFailed), nada tratado como migrado
            var roPath = Path.Combine(dir, "readonly.json");
            var legacyJson = "{\"ApiBaseUrl\":\"https://api.exemplo.com\",\"DeviceToken\":\"" + token + "\"}";
            File.WriteAllText(roPath, legacyJson);
            File.SetAttributes(roPath, FileAttributes.ReadOnly);
            var ro = AppSettings.LoadFrom(roPath);
            File.SetAttributes(roPath, FileAttributes.Normal);
            Check("migracao read-only: resultado SaveFailed (aviso visivel)", ro.Migration == TokenMigration.SaveFailed);
            Check("migracao read-only: o app segue funcionando com a chave em memoria", ro.DeviceToken == token);
            Check("migracao read-only: disco continua como estava (sera repetido no proximo inicio)", File.ReadAllText(roPath) == legacyJson);

            // ordem das propriedades (R5): legado + protegido invalido, em qualquer ordem
            var a = JsonConvert.DeserializeObject<AppSettings>("{\"DeviceToken\":\"" + token + "\",\"DeviceTokenProtected\":\"\"}");
            var b = JsonConvert.DeserializeObject<AppSettings>("{\"DeviceTokenProtected\":\"lixo!!\",\"DeviceToken\":\"" + token + "\"}");
            var c = JsonConvert.DeserializeObject<AppSettings>("{\"DeviceToken\":\"" + token + "\",\"DeviceTokenProtected\":\"lixo!!\"}");
            Check("ordem: legado + protegido vazio preserva o legado", a.DeviceToken == token);
            Check("ordem: protegido invalido antes do legado preserva o legado", b.DeviceToken == token);
            Check("ordem: legado antes de protegido invalido preserva o legado", c.DeviceToken == token);
            var good = SecretStore.Protect("novo");
            var d = JsonConvert.DeserializeObject<AppSettings>("{\"DeviceToken\":\"antigo\",\"DeviceTokenProtected\":\"" + good + "\"}");
            Check("ordem: protegido valido vence o legado e nao conta como migracao", d.DeviceToken == "novo" && !d.MigratedFromPlaintext);
        }

        static void Secrets()
        {
            const string token = "mc_dev_TOKEN-super-secreto-123";
            var prot = SecretStore.Protect(token);
            Check("dpapi: cifrado nao contem o texto puro", prot.Length > 0 && prot.IndexOf("TOKEN-super", StringComparison.Ordinal) < 0);
            Check("dpapi: ida e volta", SecretStore.Unprotect(prot) == token);
            Check("dpapi: lixo vira vazio, sem excecao", SecretStore.Unprotect("isso-nao-e-base64!") == "" && SecretStore.Unprotect("AAAA") == "");
            Check("dpapi: vazio fica vazio", SecretStore.Protect("") == "" && SecretStore.Unprotect("") == "");

            var s = new AppSettings { ApiBaseUrl = "https://api.exemplo.com", DeviceToken = token };
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
