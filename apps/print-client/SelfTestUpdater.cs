using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using MeuCardapio.PrintClient.Services;

namespace MeuCardapio.PrintClient
{
    // Testes do PC-04 (B17): updater só com https, manifesto assinado e hash conferido antes de
    // executar. Sem instalar nada: o instalador de teste é um arquivo qualquer em %TEMP%.
    static class SelfTestUpdater
    {
        static void Check(string label, bool cond) { SelfTest.Check(label, cond); }

        sealed class FakeTransport : IUpdateTransport
        {
            public readonly Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>();
            public readonly List<string> Requests = new List<string>();
            public bool FailAll, FailDownload;
            public byte[] GetSmall(Uri url, int maxBytes)
            {
                Requests.Add(url.AbsoluteUri);
                if (FailAll) throw new UpdateException("sem rede");
                byte[] b;
                if (!Files.TryGetValue(url.AbsolutePath.TrimStart('/'), out b)) throw new UpdateException("servidor respondeu 404");
                return b;
            }
            public void Download(Uri url, string destPath, long maxBytes)
            {
                Requests.Add(url.AbsoluteUri);
                if (FailDownload) { File.WriteAllBytes(destPath, new byte[] { 1 }); throw new UpdateException("queda no meio do download"); }
                byte[] b;
                if (!Files.TryGetValue(url.AbsolutePath.TrimStart('/'), out b)) throw new UpdateException("servidor respondeu 404");
                File.WriteAllBytes(destPath, b);
            }
            public int Downloads(string suffix) { int n = 0; foreach (var r in Requests) if (r.EndsWith(suffix)) n++; return n; }
        }

        static bool Ready(Func<bool> f) { return f(); }

        static string Sign(byte[] data, string privateXml)
        {
            using (var rsa = new RSACryptoServiceProvider())
            {
                rsa.PersistKeyInCsp = false;
                rsa.FromXmlString(privateXml);
                return Convert.ToBase64String(rsa.SignData(data, CryptoConfig.MapNameToOID("SHA256")));
            }
        }

        static string Hex(byte[] b)
        {
            using (var s = SHA256.Create()) { var sb = new StringBuilder(); foreach (var x in s.ComputeHash(b)) sb.Append(x.ToString("X2")); return sb.ToString(); }
        }

        static byte[] Swapped(byte[] inst, bool differentSize)
        {
            var b = differentSize ? new byte[inst.Length + 7] : (byte[])inst.Clone();
            if (!differentSize) b[0] ^= 0x5A;
            return b;
        }

        static readonly DateTime Now = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);
        const string Issued = "2026-11-10T00:00:00Z", Until = "2027-01-09T00:00:00Z";

        static byte[] Manifest(string version, string file, byte[] installer, string sha = null, long? size = null,
            string keyId = "k1", string issued = Issued, string until = Until, string minVersion = null, string revoke = null)
        {
            return Encoding.UTF8.GetBytes("{\"version\":\"" + version + "\",\"file\":\"" + file + "\",\"sha256\":\"" + (sha ?? Hex(installer)) + "\",\"size\":" + (size ?? installer.Length)
                + ",\"keyId\":\"" + keyId + "\",\"issuedAt\":\"" + issued + "\",\"validUntil\":\"" + until + "\""
                + (minVersion != null ? ",\"minVersion\":\"" + minVersion + "\"" : "")
                + (revoke != null ? ",\"revokeKeys\":" + revoke : "") + "}");
        }

        static TrustedKey[] Keys(string pubXml) { return string.IsNullOrEmpty(pubXml) ? new TrustedKey[0] : new[] { new TrustedKey("k1", pubXml) }; }

        // Atalho dos testes antigos: uma chave (k1), sem arquivo de estado, relogio fixo.
        static UpdateResult Eval(string url, string current, string pubXml, IUpdateTransport t, string dir)
        {
            return Updater.Evaluate(url, current, Keys(pubXml), t, dir, null, () => Now);
        }

        static FakeTransport Server(byte[] manifest, string sig, string file, byte[] installer)
        {
            var t = new FakeTransport();
            t.Files["up/latest.json"] = manifest;
            t.Files["up/latest.json.sig"] = Encoding.ASCII.GetBytes(sig);
            if (file != null) t.Files["up/" + file] = installer;
            return t;
        }

        public static void Run()
        {
            var dir = Path.Combine(Path.GetTempPath(), "meucardapio_selftest_upd_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            try
            {
                Policy();
                string pubXml, privXml, otherPubXml, smallPubXml, smallPrivXml;
                using (var k = new RSACryptoServiceProvider(3072) { PersistKeyInCsp = false }) { pubXml = k.ToXmlString(false); privXml = k.ToXmlString(true); }
                using (var k = new RSACryptoServiceProvider(3072) { PersistKeyInCsp = false }) { otherPubXml = k.ToXmlString(false); }
                using (var k = new RSACryptoServiceProvider(2048) { PersistKeyInCsp = false }) { smallPubXml = k.ToXmlString(false); smallPrivXml = k.ToXmlString(true); }
                Signatures(pubXml, privXml, otherPubXml, smallPubXml, smallPrivXml);
                Manifests();
                Flow(dir, pubXml, privXml);
                string pub2, priv2;
                using (var k = new RSACryptoServiceProvider(3072) { PersistKeyInCsp = false }) { pub2 = k.ToXmlString(false); priv2 = k.ToXmlString(true); }
                KeysAndFreshness(dir, pubXml, privXml, pub2, priv2);
                RealHttp(dir, pubXml, privXml);
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }

        static void Policy()
        {
            Check("updater url: https aceita", UpdateVerifier.ValidateBaseUrl("https://dl.exemplo.com/print") == null);
            Check("updater url: http remoto recusada", UpdateVerifier.ValidateBaseUrl("http://dl.exemplo.com/print") != null);
            Check("updater url: http localhost aceita (so testes locais)", UpdateVerifier.ValidateBaseUrl("http://localhost:8080/up") == null && UpdateVerifier.ValidateBaseUrl("http://127.0.0.1/up") == null);
            Check("updater url: ftp/file recusados", UpdateVerifier.ValidateBaseUrl("ftp://x/y") != null && UpdateVerifier.ValidateBaseUrl("file:///c:/x") != null);
            Check("updater url: usuario e senha recusados", UpdateVerifier.ValidateBaseUrl("https://u:p@dl.exemplo.com/") != null);
            Check("updater url: query recusada", UpdateVerifier.ValidateBaseUrl("https://dl.exemplo.com/?a=1") != null);
            Check("updater url: vazia/lixo recusadas", UpdateVerifier.ValidateBaseUrl("") != null && UpdateVerifier.ValidateBaseUrl("nao e url") != null);
            Check("versao: 1.10.0 > 1.2.0 (numerico, nao texto)", UpdateVerifier.CompareVersions("1.10.0", "1.2.0") > 0);
            Check("versao: 1.0 == 1.0.0 e menor", UpdateVerifier.CompareVersions("1.0", "1.0.0") == 0 && UpdateVerifier.CompareVersions("0.9.9", "1.0.0") < 0);
            Check("versao: invalida vira -2", UpdateVerifier.CompareVersions("1.x", "1.0.0") == -2 && UpdateVerifier.CompareVersions("", "1.0.0") == -2 && UpdateVerifier.CompareVersions("1.0.0-beta", "1.0.0") == -2);
        }

        static void Signatures(string pub, string priv, string otherPub, string smallPub, string smallPriv)
        {
            var data = Encoding.UTF8.GetBytes("{\"version\":\"1.1.0\"}");
            var sig = Sign(data, priv);
            Check("assinatura: valida confere", UpdateVerifier.VerifySignature(data, sig, pub));
            var tampered = (byte[])data.Clone(); tampered[5] ^= 1;
            Check("assinatura: manifesto adulterado (1 bit) falha", !UpdateVerifier.VerifySignature(tampered, sig, pub));
            Check("assinatura: outra chave publica falha", !UpdateVerifier.VerifySignature(data, sig, otherPub));
            Check("assinatura: lixo / vazio / sem chave falham sem excecao",
                !UpdateVerifier.VerifySignature(data, "isso-nao-e-base64!", pub) && !UpdateVerifier.VerifySignature(data, "", pub)
                && !UpdateVerifier.VerifySignature(data, sig, "") && !UpdateVerifier.VerifySignature(data, sig, "<xml>quebrado") && !UpdateVerifier.VerifySignature(null, sig, pub));
            Check("assinatura: chave de 2048 bits e recusada (minimo 3072)", !UpdateVerifier.VerifySignature(data, Sign(data, smallPriv), smallPub));
        }

        static void Manifests()
        {
            string e;
            var inst = new byte[] { 1, 2, 3 };
            Check("manifesto: valido", UpdateVerifier.ParseManifest(Manifest("1.1.0", "Setup-1.1.0.exe", inst), out e) != null && e == null);
            Check("manifesto: nome com .. ou pasta recusado",
                UpdateVerifier.ParseManifest(Manifest("1.1.0", "..\\\\x.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "a/b.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "a..b.exe", inst), out e) == null);
            Check("manifesto: so .exe (bat/ps1/msi recusados)",
                UpdateVerifier.ParseManifest(Manifest("1.1.0", "x.bat", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "x.ps1", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "x.exe.bat", inst), out e) == null);
            Check("manifesto: nomes reservados do Windows recusados (CON, NUL, COM1, LPT9)",
                UpdateVerifier.ParseManifest(Manifest("1.1.0", "CON.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "nul.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "COM1.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "lpt9.exe", inst), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "Console-Setup.exe", inst), out e) != null);
            Check("manifesto: hash curto/nao-hex recusado", UpdateVerifier.ParseManifest(Manifest("1.1.0", "s.exe", inst, "ABC"), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "s.exe", inst, new string('Z', 64)), out e) == null);
            Check("manifesto: tamanho 0, negativo ou gigante recusado", UpdateVerifier.ParseManifest(Manifest("1.1.0", "s.exe", inst, null, 0), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "s.exe", inst, null, -5), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.1.0", "s.exe", inst, null, 1L << 40), out e) == null);
            Check("manifesto: versao invalida recusada", UpdateVerifier.ParseManifest(Manifest("latest", "s.exe", inst), out e) == null);
            Check("manifesto: JSON quebrado / vazio / grande demais recusados", UpdateVerifier.ParseManifest(Encoding.UTF8.GetBytes("{nao"), out e) == null
                && UpdateVerifier.ParseManifest(new byte[0], out e) == null && UpdateVerifier.ParseManifest(new byte[UpdateVerifier.MaxManifestBytes + 1], out e) == null);
        }

        static void Flow(string root, string pub, string priv)
        {
            var upd = Path.Combine(root, "flow");
            const string baseUrl = "https://dl.exemplo.com/up";
            var inst = new byte[5000]; new Random(7).NextBytes(inst);
            const string file = "Setup-1.1.0.exe";
            var man = Manifest("1.1.0", file, inst);
            var sig = Sign(man, priv);

            Check("fluxo: sem URL = nao configurado, zero rede",
                Eval("", "1.0.0", pub, new FakeTransport(), upd).Outcome == UpdateOutcome.NotConfigured);
            var tNoKey = Server(man, sig, file, inst);
            var rNoKey = Eval(baseUrl, "1.0.0", "", tNoKey, upd);
            Check("fluxo: build sem chave de release recusa e nao toca a rede (fecha por padrao)", rNoKey.Outcome == UpdateOutcome.Rejected && tNoKey.Requests.Count == 0);
            var tHttp = Server(man, sig, file, inst);
            var rHttp = Eval("http://dl.exemplo.com/up", "1.0.0", pub, tHttp, upd);
            Check("fluxo: http remoto recusado antes de qualquer pedido", rHttp.Outcome == UpdateOutcome.Rejected && tHttp.Requests.Count == 0);

            var ok = Server(man, sig, file, inst);
            var r = Eval(baseUrl, "1.0.0", pub, ok, upd);
            Check("fluxo: release valido fica pronto", r.Outcome == UpdateOutcome.Ready && r.Version == "1.1.0" && File.Exists(r.InstallerPath));
            Check("fluxo: arquivo pronto tem exatamente o hash assinado", r.InstallerPath != null && UpdateVerifier.Sha256Hex(r.InstallerPath) == Hex(inst));
            Check("fluxo: instalador fica na pasta privada de updates, sem .part sobrando",
                r.InstallerPath != null && Path.GetDirectoryName(r.InstallerPath) == upd && Directory.GetFiles(upd, "*.part").Length == 0);

            // U1 (Nightingale): reverifica o arquivo final antes de executar e o mantem travado durante o inicio
            int started = 0; string startedPath = null; bool lockedDuringStart = false; var msgs = new List<string>();
            bool launched = Updater.TryLaunch(r, p =>
            {
                started++; startedPath = p;
                try { File.WriteAllBytes(p, new byte[] { 0 }); } catch (IOException) { lockedDuringStart = true; }
                try { File.Delete(p); lockedDuringStart = lockedDuringStart && File.Exists(p); } catch (IOException) { }
            }, m => msgs.Add(m));
            Check("lancamento: arquivo conferido e iniciado 1 vez", launched && started == 1 && startedPath == r.InstallerPath);
            Check("lancamento: arquivo fica travado (sem gravar/apagar) enquanto o instalador inicia", lockedDuringStart);
            Check("lancamento: conteudo intacto depois do inicio", UpdateVerifier.Sha256Hex(r.InstallerPath) == Hex(inst));

            var r2 = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            File.WriteAllBytes(r2.InstallerPath, Swapped(inst, false)); // trocado depois de verificado, mesmo tamanho
            int started2 = 0; var msgs2 = new List<string>();
            bool launched2 = Updater.TryLaunch(r2, p => started2++, m => msgs2.Add(m));
            Check("lancamento: arquivo trocado (mesmo tamanho) apos Evaluate => NAO executa", !launched2 && started2 == 0 && msgs2.Count > 0);
            Check("lancamento: arquivo trocado e descartado do disco", !File.Exists(r2.InstallerPath));
            var r3 = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            File.WriteAllBytes(r3.InstallerPath, Swapped(inst, true)); // tamanho diferente
            int started3 = 0;
            Check("lancamento: arquivo com tamanho diferente => NAO executa", !Updater.TryLaunch(r3, p => started3++, m => { }) && started3 == 0);
            var r4 = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            File.Delete(r4.InstallerPath);
            int started4 = 0;
            Check("lancamento: arquivo sumiu => NAO executa e nao estoura", !Updater.TryLaunch(r4, p => started4++, m => { }) && started4 == 0);
            Check("lancamento: resultado nao-Ready nunca executa", !Updater.TryLaunch(new UpdateResult { Outcome = UpdateOutcome.Rejected, InstallerPath = "x.exe" }, p => started4++, m => { }) && started4 == 0);

            // PC-13: atualizacao verificada FICA PENDENTE e so instala depois do "sim" do lojista
            Updater.ClearPending();
            var rp = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            int startedP = 0;
            Check("confirmacao: Evaluate/Stage NUNCA executam o instalador (so deixam pronto)", rp.Outcome == UpdateOutcome.Ready && Updater.Stage(rp) && Updater.Pending == rp && startedP == 0 && File.Exists(rp.InstallerPath));
            Check("confirmacao: sem pendencia, instalar nao faz nada", Ready(() => { Updater.ClearPending(); return !Updater.InstallPending(p => startedP++, m => { }) && startedP == 0; }));
            Updater.Stage(rp);
            bool boom = Updater.InstallPending(p => { throw new InvalidOperationException("x"); }, m => { });
            Check("confirmacao: instalador que falha ao iniciar volta falso e a pendencia fica (da para tentar de novo)", !boom && Updater.Pending == rp);
            bool ok1 = Updater.InstallPending(p => startedP++, m => { });
            Check("confirmacao: depois do 'sim', o instalador inicia 1 vez e a pendencia sai", ok1 && startedP == 1 && Updater.Pending == null);
            Check("confirmacao: instalar de novo nao inicia segunda vez", !Updater.InstallPending(p => startedP++, m => { }) && startedP == 1);
            var rOld = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            Check("confirmacao: resultado que nao e Ready nao fica pendente", !Updater.Stage(new UpdateResult { Outcome = UpdateOutcome.Rejected }) && !Updater.Stage(null) && Updater.Pending == null);
            var newer = new UpdateResult { Outcome = UpdateOutcome.Ready, Version = "2.0.0", InstallerPath = rOld.InstallerPath, ExpectedSha256 = rOld.ExpectedSha256, ExpectedSize = rOld.ExpectedSize };
            Updater.Stage(newer);
            Check("confirmacao: versao mais nova substitui a pendente; mais antiga nao", Updater.Stage(new UpdateResult { Outcome = UpdateOutcome.Ready, Version = "3.0.0", InstallerPath = newer.InstallerPath }) && !Updater.Stage(new UpdateResult { Outcome = UpdateOutcome.Ready, Version = "1.5.0", InstallerPath = newer.InstallerPath }) && Updater.Pending.Version == "3.0.0");
            Updater.ClearPending();
            var rSwap = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            Updater.Stage(rSwap);
            File.WriteAllBytes(rSwap.InstallerPath, Swapped(inst, false)); // trocado enquanto esperava o 'sim'
            int startedS = 0;
            Check("confirmacao: arquivo trocado enquanto a pergunta esperava => reverifica e NAO executa", !Updater.InstallPending(p => startedS++, m => { }) && startedS == 0);
            Updater.ClearPending();
            var rDisc = Eval(baseUrl, "1.0.0", pub, Server(man, sig, file, inst), upd);
            Updater.Stage(rDisc);
            Updater.DiscardPending();
            Check("confirmacao: 'nao agora' descarta a pendencia E apaga o instalador (nada executavel esperando em disco)", Updater.Pending == null && !File.Exists(rDisc.InstallerPath));
            int startedD = 0;
            Check("confirmacao: depois de descartar, instalar nao faz nada", !Updater.InstallPending(p => startedD++, m => { }) && startedD == 0);
            Updater.DiscardPending(); // sem pendencia: nao estoura
            Check("confirmacao: descartar sem pendencia e inofensivo", Updater.Pending == null);

            // mesma versao e versao menor: nada e baixado (anti-downgrade/replay de manifesto antigo)
            var tSame = Server(man, sig, file, inst);
            Check("fluxo: mesma versao = em dia, instalador nao e baixado", Eval(baseUrl, "1.1.0", pub, tSame, upd).Outcome == UpdateOutcome.UpToDate && tSame.Downloads(file) == 0);
            var tOld = Server(man, sig, file, inst);
            Check("fluxo: manifesto mais antigo que o app (downgrade) e ignorado", Eval(baseUrl, "2.0.0", pub, tOld, upd).Outcome == UpdateOutcome.UpToDate && tOld.Downloads(file) == 0);

            // adulteracao do manifesto (ex.: apontar para outro hash/arquivo) com a assinatura antiga
            var evilMan = Manifest("1.1.0", file, new byte[] { 9, 9, 9 });
            var tEvilMan = Server(evilMan, sig, file, inst);
            var rEvilMan = Eval(baseUrl, "1.0.0", pub, tEvilMan, upd);
            Check("fluxo: manifesto adulterado => recusado e nada baixado", rEvilMan.Outcome == UpdateOutcome.Rejected && tEvilMan.Downloads(file) == 0);
            var tNoSig = Server(man, "", file, inst);
            Check("fluxo: sem assinatura => recusado", Eval(baseUrl, "1.0.0", pub, tNoSig, upd).Outcome == UpdateOutcome.Rejected && tNoSig.Downloads(file) == 0);
            var tOtherSig = Server(man, Sign(man, OtherPrivate()), file, inst);
            Check("fluxo: assinado por outra chave => recusado", Eval(baseUrl, "1.0.0", pub, tOtherSig, upd).Outcome == UpdateOutcome.Rejected && tOtherSig.Downloads(file) == 0);

            // instalador trocado no servidor (manifesto e assinatura legitimos)
            var evilInst = (byte[])inst.Clone(); evilInst[100] ^= 0xFF;
            var tEvilInst = Server(man, sig, file, evilInst);
            var rEvilInst = Eval(baseUrl, "1.0.0", pub, tEvilInst, upd);
            Check("fluxo: instalador trocado (mesmo tamanho) => hash nao confere, recusado", rEvilInst.Outcome == UpdateOutcome.Rejected);
            Check("fluxo: instalador recusado nao fica no disco", Directory.GetFiles(upd).Length == 0);
            var tShort = Server(man, sig, file, new byte[10]);
            Check("fluxo: instalador de tamanho errado => recusado", Eval(baseUrl, "1.0.0", pub, tShort, upd).Outcome == UpdateOutcome.Rejected && Directory.GetFiles(upd).Length == 0);

            // manifesto legitimamente assinado, mas com nome malicioso: ainda e recusado
            var badNameMan = Manifest("1.1.0", "..\\\\evil.exe", inst);
            var tBadName = Server(badNameMan, Sign(badNameMan, priv), null, inst);
            var rBadName = Eval(baseUrl, "1.0.0", pub, tBadName, upd);
            Check("fluxo: nome de arquivo com caminho, mesmo assinado, e recusado", rBadName.Outcome == UpdateOutcome.Rejected && tBadName.Downloads(".exe") == 0);

            // rede
            var tDown = new FakeTransport { FailAll = true };
            Check("fluxo: sem rede => falha limpa, nada executa", Eval(baseUrl, "1.0.0", pub, tDown, upd).Outcome == UpdateOutcome.Failed);
            var tCut = Server(man, sig, file, inst); tCut.FailDownload = true;
            var rCut = Eval(baseUrl, "1.0.0", pub, tCut, upd);
            Check("fluxo: queda no meio do download => falha e nao deixa .part", rCut.Outcome == UpdateOutcome.Failed && Directory.GetFiles(upd).Length == 0);
            var tMissing = Server(man, sig, null, inst);
            Check("fluxo: instalador 404 => falha limpa", Eval(baseUrl, "1.0.0", pub, tMissing, upd).Outcome == UpdateOutcome.Failed);

            // URL do arquivo montada so a partir do host configurado
            Check("fluxo: pedidos vao so ao host configurado, por https",
                ok.Requests.Count == 3 && ok.Requests.TrueForAll(u => u.StartsWith("https://dl.exemplo.com/up/")));
        }

        // ---- PC-11 (Nightingale R1/R2): duas chaves com keyId, revogacao, anti-replay, validade, minVersion ----
        static void KeysAndFreshness(string root, string pub1, string priv1, string pub2, string priv2)
        {
            const string baseUrl = "https://dl.exemplo.com/up";
            var inst = new byte[3000]; new Random(11).NextBytes(inst);
            const string file = "Setup-1.2.0.exe";
            var twoKeys = new[] { new TrustedKey("k1", pub1), new TrustedKey("k2", pub2) }; // k1 primaria, k2 reserva offline
            Func<byte[], string, FakeTransport> srv = (man, priv) => Server(man, Sign(man, priv), file, inst);
            Func<IList<TrustedKey>, FakeTransport, string, string, DateTime, UpdateResult> run = (keys, t, dir, st, now) =>
                Updater.Evaluate(baseUrl, "1.0.0", keys, t, dir, st, () => now);
            Func<string> newDir = () => Path.Combine(root, "pc11_" + Guid.NewGuid().ToString("N"));

            // duas chaves: qualquer uma assina, o keyId escolhe qual conferir
            var d = newDir();
            Check("chaves: manifesto da primaria (k1) aceito", run(twoKeys, srv(Manifest("1.2.0", file, inst), priv1), d, null, Now).Outcome == UpdateOutcome.Ready);
            Check("chaves: manifesto da reserva (k2) aceito", run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k2"), priv2), newDir(), null, Now).Outcome == UpdateOutcome.Ready);
            var tSwap = srv(Manifest("1.2.0", file, inst, null, null, "k2"), priv1); // diz k2 mas foi assinado com k1
            Check("chaves: keyId diz uma chave e a assinatura e de outra => recusado, nada baixado",
                run(twoKeys, tSwap, newDir(), null, Now).Outcome == UpdateOutcome.Rejected && tSwap.Downloads(file) == 0);
            var tUnknown = srv(Manifest("1.2.0", file, inst, null, null, "k9"), priv1);
            Check("chaves: keyId desconhecido => recusado, nada baixado", run(twoKeys, tUnknown, newDir(), null, Now).Outcome == UpdateOutcome.Rejected && tUnknown.Downloads(file) == 0);
            Check("chaves: lista de chaves vazia => build sem chave recusa tudo", run(new TrustedKey[0], srv(Manifest("1.2.0", file, inst), priv1), newDir(), null, Now).Outcome == UpdateOutcome.Rejected);
            Check("chaves: chave sem XML (slot vazio) nao vale", run(new[] { new TrustedKey("k1", "") }, srv(Manifest("1.2.0", file, inst), priv1), newDir(), null, Now).Outcome == UpdateOutcome.Rejected);

            // revogacao: a reserva revoga a primaria (so chaves ANTERIORES da lista)
            var st = Path.Combine(root, "state_revoke.json");
            var rRevoke = run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k2", Issued, Until, null, "[\"k1\"]"), priv2), newDir(), st, Now);
            Check("revogacao: manifesto da reserva (k2) que revoga k1 e aceito", rRevoke.Outcome == UpdateOutcome.Ready);
            var tAfter = srv(Manifest("1.2.0", file, inst), priv1);
            var rAfter = run(twoKeys, tAfter, newDir(), st, Now);
            Check("revogacao: depois disso, manifesto valido assinado com k1 e RECUSADO e nada baixado", rAfter.Outcome == UpdateOutcome.Rejected && rAfter.Message.Contains("revogada") && tAfter.Downloads(file) == 0);
            Check("revogacao: continua valendo depois de reabrir (estado persistido)", UpdateState.Load(st).RevokedKeys.Contains("k1"));
            Check("revogacao: k2 continua valendo", run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k2", "2026-11-11T00:00:00Z", Until), priv2), newDir(), st, Now).Outcome == UpdateOutcome.Ready);
            var st2 = Path.Combine(root, "state_norevoke.json");
            var rBad = run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, null, "[\"k2\"]"), priv1), newDir(), st2, Now);
            Check("revogacao: a primaria (k1) NAO pode revogar a reserva (k2)", rBad.Outcome == UpdateOutcome.Rejected && !UpdateState.Load(st2).RevokedKeys.Contains("k2"));
            Check("revogacao: revogar chave desconhecida e recusado", run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k2", Issued, Until, null, "[\"k7\"]"), priv2), newDir(), null, Now).Outcome == UpdateOutcome.Rejected);
            string e;
            Check("revogacao: chave nao pode revogar a si mesma (manifesto invalido)", UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k2", Issued, Until, null, "[\"k2\"]"), out e) == null);

            // anti-replay: nunca aceita issuedAt menor que o ultimo aceito
            var stR = Path.Combine(root, "state_replay.json");
            var newer = Manifest("1.2.0", file, inst, null, null, "k1", "2026-11-12T00:00:00Z", Until);
            var older = Manifest("1.2.0", file, inst, null, null, "k1", "2026-11-05T00:00:00Z", Until);
            Check("replay: 1o manifesto (issuedAt 12/11) aceito", run(twoKeys, srv(newer, priv1), newDir(), stR, Now).Outcome == UpdateOutcome.Ready);
            var tOld = srv(older, priv1);
            var rOld = run(twoKeys, tOld, newDir(), stR, Now);
            Check("replay: manifesto mais antigo (5/11), mesmo assinado e valido, e RECUSADO", rOld.Outcome == UpdateOutcome.Rejected && rOld.Message.Contains("mais antigo") && tOld.Downloads(file) == 0);
            Check("replay: reenvio do mesmo manifesto (mesmo issuedAt) continua aceito", run(twoKeys, srv(newer, priv1), newDir(), stR, Now).Outcome == UpdateOutcome.Ready);
            Check("replay: maior issuedAt fica gravado", UpdateState.Load(stR).MaxIssuedAtUtc == new DateTime(2026, 11, 12, 0, 0, 0, DateTimeKind.Utc));
            File.WriteAllText(stR, "{{{ lixo");
            Check("replay: arquivo de estado corrompido = estado vazio, nao trava (aceita)", run(twoKeys, srv(older, priv1), newDir(), stR, Now).Outcome == UpdateOutcome.Ready);

            // validade (60 dias) e relogio
            var man = Manifest("1.2.0", file, inst);
            var stV = Path.Combine(root, "state_valid.json");
            var tExp = srv(man, priv1);
            var rExp = run(twoKeys, tExp, newDir(), stV, new DateTime(2027, 1, 10, 0, 0, 0, DateTimeKind.Utc));
            Check("validade: manifesto vencido => 'nao consegui confirmar', nada baixado", rExp.Outcome == UpdateOutcome.Unconfirmed && rExp.Message.Contains("venceu") && tExp.Downloads(file) == 0);
            Check("validade: vencido nao grava estado", !File.Exists(stV));
            Check("validade: no ultimo dia ainda vale", run(twoKeys, srv(man, priv1), newDir(), null, new DateTime(2027, 1, 8, 0, 0, 0, DateTimeKind.Utc)).Outcome == UpdateOutcome.Ready);
            var rBehind = run(twoKeys, srv(man, priv1), newDir(), null, new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc));
            Check("relogio: PC com data muito atrasada (> 1 dia antes do issuedAt) => 'nao consegui confirmar'", rBehind.Outcome == UpdateOutcome.Unconfirmed && rBehind.Message.Contains("relógio"));
            Check("relogio: atraso dentro da tolerancia de 1 dia e aceito", run(twoKeys, srv(man, priv1), newDir(), null, new DateTime(2026, 11, 9, 12, 0, 0, DateTimeKind.Utc)).Outcome == UpdateOutcome.Ready);
            Check("validade: autentico + vencido NAO derruba o app (so mensagem, sem excecao)", rExp.Outcome != UpdateOutcome.Failed && rExp.InstallerPath == null);

            // minVersion
            var rReq = run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, "1.1.0"), priv1), newDir(), null, Now);
            Check("minVersion: app abaixo do minimo => atualizacao marcada obrigatoria", rReq.Outcome == UpdateOutcome.Ready && rReq.Required && rReq.Message.Contains("obrigatória"));
            var rNotReq = run(twoKeys, srv(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, "1.0.0"), priv1), newDir(), null, Now);
            Check("minVersion: app no minimo => nao obrigatoria", rNotReq.Outcome == UpdateOutcome.Ready && !rNotReq.Required);
            var tCutReq = srv(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, "1.1.0"), priv1); tCutReq.FailDownload = true;
            var rCutReq = run(twoKeys, tCutReq, newDir(), null, Now);
            Check("minVersion: obrigatoria + download falhou => avisa que a versao nao e mais suportada", rCutReq.Outcome == UpdateOutcome.Failed && rCutReq.Required && rCutReq.Message.Contains("não é mais suportada"));

            // forma do manifesto (campos novos)
            Check("manifesto: keyId invalido recusado", UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k 1!"), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, ""), out e) == null);
            Check("manifesto: data fora do formato yyyy-MM-ddTHH:mm:ssZ recusada", UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", "10/11/2026", Until), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", "2026-11-10T00:00:00+03:00", Until), out e) == null);
            Check("manifesto: validUntil <= issuedAt ou janela > 400 dias recusados", UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", Until, Issued), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", "2026-01-01T00:00:00Z", "2028-01-01T00:00:00Z"), out e) == null);
            Check("manifesto: minVersion maior que a versao ou invalida recusada", UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, "1.3.0"), out e) == null
                && UpdateVerifier.ParseManifest(Manifest("1.2.0", file, inst, null, null, "k1", Issued, Until, "x"), out e) == null);
            Check("manifesto: sem keyId/datas (formato antigo) recusado", UpdateVerifier.ParseManifest(Encoding.UTF8.GetBytes("{\"version\":\"1.2.0\",\"file\":\"Setup-1.2.0.exe\",\"sha256\":\"" + Hex(inst) + "\",\"size\":" + inst.Length + "}"), out e) == null);
        }

        static string _otherPriv;
        static string OtherPrivate()
        {
            if (_otherPriv == null) using (var k = new RSACryptoServiceProvider(3072) { PersistKeyInCsp = false }) _otherPriv = k.ToXmlString(true);
            return _otherPriv;
        }

        // Transporte HTTP de verdade contra um servidor local (loopback): redirecionamento e limites.
        static void RealHttp(string root, string pub, string priv)
        {
            HttpListener l = null; int port = 0;
            var rnd = new Random();
            for (int i = 0; i < 20 && l == null; i++)
            {
                port = 20000 + rnd.Next(20000);
                try { var x = new HttpListener(); x.Prefixes.Add("http://127.0.0.1:" + port + "/"); x.Start(); l = x; } catch { }
            }
            if (l == null) { Console.WriteLine("SKIP transporte http real (HttpListener indisponivel)"); return; }

            var inst = new byte[300000]; new Random(3).NextBytes(inst);
            const string file = "Setup-2.0.0.exe";
            var man = Manifest("2.0.0", file, inst);
            var sig = Encoding.ASCII.GetBytes(Sign(man, priv));
            var served = new List<string>();
            var cts = new CancellationTokenSource();
            var th = new Thread(() =>
            {
                while (!cts.IsCancellationRequested)
                {
                    HttpListenerContext c;
                    try { c = l.GetContext(); } catch { return; }
                    try
                    {
                        var p = c.Request.Url.AbsolutePath; lock (served) served.Add(p);
                        byte[] body = null;
                        if (p == "/up/latest.json") body = man;
                        else if (p == "/up/latest.json.sig") body = sig;
                        else if (p == "/up/" + file) body = inst;
                        else if (p == "/redir/latest.json") { c.Response.StatusCode = 302; c.Response.RedirectLocation = "http://127.0.0.1:" + port + "/up/latest.json"; c.Response.Close(); continue; }
                        if (body == null) { c.Response.StatusCode = 404; c.Response.Close(); continue; }
                        c.Response.StatusCode = 200; c.Response.ContentLength64 = body.Length;
                        c.Response.OutputStream.Write(body, 0, body.Length); c.Response.Close();
                    }
                    catch { }
                }
            }) { IsBackground = true };
            th.Start();
            try
            {
                var upd = Path.Combine(root, "http");
                var tr = new HttpUpdateTransport { TimeoutMs = 5000, ReadTimeoutMs = 5000 };
                var r = Eval("http://127.0.0.1:" + port + "/up", "1.0.0", pub, tr, upd);
                Check("http real: release assinado baixa e confere pelo transporte HTTP", r.Outcome == UpdateOutcome.Ready && r.InstallerPath != null && UpdateVerifier.Sha256Hex(r.InstallerPath) == Hex(inst));
                var rr = Eval("http://127.0.0.1:" + port + "/redir", "1.0.0", pub, tr, upd);
                Check("http real: redirecionamento 302 NAO e seguido (falha limpa)", rr.Outcome == UpdateOutcome.Failed);
                var r404 = Eval("http://127.0.0.1:" + port + "/nada", "1.0.0", pub, tr, upd);
                Check("http real: 404 => falha limpa", r404.Outcome == UpdateOutcome.Failed);
                bool big = false;
                try { tr.GetSmall(new Uri("http://127.0.0.1:" + port + "/up/" + file), 1000); } catch (UpdateException) { big = true; }
                Check("http real: resposta maior que o limite e abortada", big);
            }
            finally { cts.Cancel(); try { l.Stop(); l.Close(); } catch { } }
        }
    }
}
