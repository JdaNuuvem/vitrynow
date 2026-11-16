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

        static byte[] Manifest(string version, string file, byte[] installer, string sha = null, long? size = null)
        {
            return Encoding.UTF8.GetBytes("{\"version\":\"" + version + "\",\"file\":\"" + file + "\",\"sha256\":\"" + (sha ?? Hex(installer)) + "\",\"size\":" + (size ?? installer.Length) + "}");
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
                Updater.Evaluate("", "1.0.0", pub, new FakeTransport(), upd).Outcome == UpdateOutcome.NotConfigured);
            var tNoKey = Server(man, sig, file, inst);
            var rNoKey = Updater.Evaluate(baseUrl, "1.0.0", "", tNoKey, upd);
            Check("fluxo: build sem chave de release recusa e nao toca a rede (fecha por padrao)", rNoKey.Outcome == UpdateOutcome.Rejected && tNoKey.Requests.Count == 0);
            var tHttp = Server(man, sig, file, inst);
            var rHttp = Updater.Evaluate("http://dl.exemplo.com/up", "1.0.0", pub, tHttp, upd);
            Check("fluxo: http remoto recusado antes de qualquer pedido", rHttp.Outcome == UpdateOutcome.Rejected && tHttp.Requests.Count == 0);

            var ok = Server(man, sig, file, inst);
            var r = Updater.Evaluate(baseUrl, "1.0.0", pub, ok, upd);
            Check("fluxo: release valido fica pronto", r.Outcome == UpdateOutcome.Ready && r.Version == "1.1.0" && File.Exists(r.InstallerPath));
            Check("fluxo: arquivo pronto tem exatamente o hash assinado", r.InstallerPath != null && UpdateVerifier.Sha256Hex(r.InstallerPath) == Hex(inst));
            Check("fluxo: instalador fica na pasta privada de updates, sem .part sobrando",
                r.InstallerPath != null && Path.GetDirectoryName(r.InstallerPath) == upd && Directory.GetFiles(upd, "*.part").Length == 0);

            // mesma versao e versao menor: nada e baixado (anti-downgrade/replay de manifesto antigo)
            var tSame = Server(man, sig, file, inst);
            Check("fluxo: mesma versao = em dia, instalador nao e baixado", Updater.Evaluate(baseUrl, "1.1.0", pub, tSame, upd).Outcome == UpdateOutcome.UpToDate && tSame.Downloads(file) == 0);
            var tOld = Server(man, sig, file, inst);
            Check("fluxo: manifesto mais antigo que o app (downgrade) e ignorado", Updater.Evaluate(baseUrl, "2.0.0", pub, tOld, upd).Outcome == UpdateOutcome.UpToDate && tOld.Downloads(file) == 0);

            // adulteracao do manifesto (ex.: apontar para outro hash/arquivo) com a assinatura antiga
            var evilMan = Manifest("1.1.0", file, new byte[] { 9, 9, 9 });
            var tEvilMan = Server(evilMan, sig, file, inst);
            var rEvilMan = Updater.Evaluate(baseUrl, "1.0.0", pub, tEvilMan, upd);
            Check("fluxo: manifesto adulterado => recusado e nada baixado", rEvilMan.Outcome == UpdateOutcome.Rejected && tEvilMan.Downloads(file) == 0);
            var tNoSig = Server(man, "", file, inst);
            Check("fluxo: sem assinatura => recusado", Updater.Evaluate(baseUrl, "1.0.0", pub, tNoSig, upd).Outcome == UpdateOutcome.Rejected && tNoSig.Downloads(file) == 0);
            var tOtherSig = Server(man, Sign(man, OtherPrivate()), file, inst);
            Check("fluxo: assinado por outra chave => recusado", Updater.Evaluate(baseUrl, "1.0.0", pub, tOtherSig, upd).Outcome == UpdateOutcome.Rejected && tOtherSig.Downloads(file) == 0);

            // instalador trocado no servidor (manifesto e assinatura legitimos)
            var evilInst = (byte[])inst.Clone(); evilInst[100] ^= 0xFF;
            var tEvilInst = Server(man, sig, file, evilInst);
            var rEvilInst = Updater.Evaluate(baseUrl, "1.0.0", pub, tEvilInst, upd);
            Check("fluxo: instalador trocado (mesmo tamanho) => hash nao confere, recusado", rEvilInst.Outcome == UpdateOutcome.Rejected);
            Check("fluxo: instalador recusado nao fica no disco", Directory.GetFiles(upd).Length == 0);
            var tShort = Server(man, sig, file, new byte[10]);
            Check("fluxo: instalador de tamanho errado => recusado", Updater.Evaluate(baseUrl, "1.0.0", pub, tShort, upd).Outcome == UpdateOutcome.Rejected && Directory.GetFiles(upd).Length == 0);

            // manifesto legitimamente assinado, mas com nome malicioso: ainda e recusado
            var badNameMan = Manifest("1.1.0", "..\\\\evil.exe", inst);
            var tBadName = Server(badNameMan, Sign(badNameMan, priv), null, inst);
            var rBadName = Updater.Evaluate(baseUrl, "1.0.0", pub, tBadName, upd);
            Check("fluxo: nome de arquivo com caminho, mesmo assinado, e recusado", rBadName.Outcome == UpdateOutcome.Rejected && tBadName.Downloads(".exe") == 0);

            // rede
            var tDown = new FakeTransport { FailAll = true };
            Check("fluxo: sem rede => falha limpa, nada executa", Updater.Evaluate(baseUrl, "1.0.0", pub, tDown, upd).Outcome == UpdateOutcome.Failed);
            var tCut = Server(man, sig, file, inst); tCut.FailDownload = true;
            var rCut = Updater.Evaluate(baseUrl, "1.0.0", pub, tCut, upd);
            Check("fluxo: queda no meio do download => falha e nao deixa .part", rCut.Outcome == UpdateOutcome.Failed && Directory.GetFiles(upd).Length == 0);
            var tMissing = Server(man, sig, null, inst);
            Check("fluxo: instalador 404 => falha limpa", Updater.Evaluate(baseUrl, "1.0.0", pub, tMissing, upd).Outcome == UpdateOutcome.Failed);

            // URL do arquivo montada so a partir do host configurado
            Check("fluxo: pedidos vao so ao host configurado, por https",
                ok.Requests.Count == 3 && ok.Requests.TrueForAll(u => u.StartsWith("https://dl.exemplo.com/up/")));
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
                var r = Updater.Evaluate("http://127.0.0.1:" + port + "/up", "1.0.0", pub, tr, upd);
                Check("http real: release assinado baixa e confere pelo transporte HTTP", r.Outcome == UpdateOutcome.Ready && r.InstallerPath != null && UpdateVerifier.Sha256Hex(r.InstallerPath) == Hex(inst));
                var rr = Updater.Evaluate("http://127.0.0.1:" + port + "/redir", "1.0.0", pub, tr, upd);
                Check("http real: redirecionamento 302 NAO e seguido (falha limpa)", rr.Outcome == UpdateOutcome.Failed);
                var r404 = Updater.Evaluate("http://127.0.0.1:" + port + "/nada", "1.0.0", pub, tr, upd);
                Check("http real: 404 => falha limpa", r404.Outcome == UpdateOutcome.Failed);
                bool big = false;
                try { tr.GetSmall(new Uri("http://127.0.0.1:" + port + "/up/" + file), 1000); } catch (UpdateException) { big = true; }
                Check("http real: resposta maior que o limite e abortada", big);
            }
            finally { cts.Cancel(); try { l.Stop(); l.Close(); } catch { } }
        }
    }
}
