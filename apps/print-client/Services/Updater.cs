using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace MeuCardapio.PrintClient.Services
{
    public enum UpdateOutcome { NotConfigured, UpToDate, Failed, Rejected, Ready }

    public sealed class UpdateResult
    {
        public UpdateOutcome Outcome;
        public string Message;
        public string Version;
        public string InstallerPath; // só em Ready: arquivo JÁ verificado
        public string ExpectedSha256; // do manifesto assinado (só em Ready)
        public long ExpectedSize;
    }

    // Auto-update seguro (PC-04, B17). Servidor NOSSO, em {UpdateBaseUrl}:
    //   latest.json + latest.json.sig + <file do manifesto>
    // Regras: https obrigatório (http só em localhost); manifesto com assinatura RSA válida contra a
    // chave embutida (UpdateKeys); versão estritamente maior que a atual (sem downgrade/replay);
    // instalador baixado numa pasta privada do usuário, com tamanho e SHA-256 do manifesto
    // conferidos ANTES de qualquer execução; nada é executado se algo falhar. Sem chave de release
    // provisionada, recusa tudo (fecha por padrão).
    public static class Updater
    {
        // Versão do app = versão do assembly (Properties\AssemblyInfo.cs), sem o 4º número ("1.0.0").
        public static readonly string CurrentVersion = ReadVersion();

        static string ReadVersion()
        {
            var v = typeof(Updater).Assembly.GetName().Version;
            return v == null ? "0.0.0" : v.Major + "." + v.Minor + "." + Math.Max(0, v.Build);
        }
        public static event Action<string> StatusChanged;

        public static bool IsConfigured => !string.IsNullOrWhiteSpace(AppSettings.Current.UpdateBaseUrl);

        public static string UpdatesDirectory => Path.Combine(AppSettings.BaseDirectory, "updates");

        static int _running;

        public static void CheckForUpdate()
        {
            // Duas verificações ao mesmo tempo (início + menu) usariam a mesma pasta: só uma roda.
            if (System.Threading.Interlocked.Exchange(ref _running, 1) == 1) return;
            try
            {
                var r = Evaluate(AppSettings.Current.UpdateBaseUrl, CurrentVersion, UpdateKeys.PublicKeyXml,
                    new HttpUpdateTransport(), UpdatesDirectory);
                if (r.Outcome == UpdateOutcome.Rejected) Logger.Error("Atualização recusada: " + r.Message);
                else Logger.Info("Atualização: " + r.Outcome + " — " + r.Message);
                StatusChanged?.Invoke(r.Message);
                if (r.Outcome != UpdateOutcome.Ready) return;

                // Reverifica o arquivo FINAL (tamanho + SHA-256 do manifesto assinado) imediatamente antes
                // de executar e o mantém aberto (FileShare.Read: ninguém grava nem apaga) enquanto o
                // instalador inicia. Fecha a janela entre Evaluate e o Process.Start (parecer U1).
                TryLaunch(r, path => Process.Start(path), msg => StatusChanged?.Invoke(msg));
            }
            finally { System.Threading.Interlocked.Exchange(ref _running, 0); }
        }

        // Toda a decisão, sem executar nada (testável com transporte falso).
        public static UpdateResult Evaluate(string baseUrl, string currentVersion, string publicKeyXml,
            IUpdateTransport transport, string updatesDir)
        {
            if (string.IsNullOrWhiteSpace(baseUrl))
                return Res(UpdateOutcome.NotConfigured, "Auto-update não configurado.");
            var urlError = UpdateVerifier.ValidateBaseUrl(baseUrl);
            if (urlError != null) return Res(UpdateOutcome.Rejected, urlError);
            if (string.IsNullOrWhiteSpace(publicKeyXml))
                return Res(UpdateOutcome.Rejected, "Auto-update desligado: chave de assinatura de release não provisionada neste build.");

            var root = new Uri(baseUrl.Trim().TrimEnd('/') + "/");
            byte[] manifestBytes, sigBytes;
            try
            {
                manifestBytes = transport.GetSmall(new Uri(root, "latest.json"), UpdateVerifier.MaxManifestBytes);
                sigBytes = transport.GetSmall(new Uri(root, "latest.json.sig"), 4096);
            }
            catch (Exception ex) { return Res(UpdateOutcome.Failed, "Não foi possível verificar atualização: " + ex.Message); }

            var sig = Encoding.ASCII.GetString(sigBytes ?? new byte[0]);
            if (!UpdateVerifier.VerifySignature(manifestBytes, sig, publicKeyXml))
                return Res(UpdateOutcome.Rejected, "Assinatura do manifesto de atualização inválida. Nada foi baixado.");

            string err;
            var m = UpdateVerifier.ParseManifest(manifestBytes, out err);
            if (m == null) return Res(UpdateOutcome.Rejected, "Manifesto de atualização inválido: " + err);

            int cmp = UpdateVerifier.CompareVersions(m.Version, currentVersion);
            if (cmp == -2) return Res(UpdateOutcome.Rejected, "Versão do manifesto ou do app inválida.");
            if (cmp <= 0) return Res(UpdateOutcome.UpToDate, "Você já está na versão mais recente (" + currentVersion + ").");

            string part = null;
            try
            {
                Directory.CreateDirectory(updatesDir);
                Cleanup(updatesDir);
                part = Path.Combine(updatesDir, Guid.NewGuid().ToString("N") + ".part");
                transport.Download(new Uri(root, Uri.EscapeDataString(m.File)), part, m.Size);
                if (!UpdateVerifier.VerifyFile(part, m))
                {
                    TryDelete(part);
                    return Res(UpdateOutcome.Rejected, "O instalador baixado não confere com o hash assinado. Descartado, nada foi executado.");
                }
                var final = Path.Combine(updatesDir, m.File);
                File.Move(part, final);
                return new UpdateResult { Outcome = UpdateOutcome.Ready, Version = m.Version, InstallerPath = final,
                    ExpectedSha256 = m.Sha256, ExpectedSize = m.Size,
                    Message = "Atualização " + m.Version + " verificada." };
            }
            catch (Exception ex)
            {
                TryDelete(part);
                return Res(UpdateOutcome.Failed, "Falha ao baixar a atualização: " + ex.Message);
            }
        }

        // Reverifica tamanho + SHA-256 do arquivo final contra o manifesto assinado, lendo pelo MESMO
        // handle que fica aberto (FileShare.Read) enquanto `start` roda: não dá para trocar o arquivo
        // entre a conferência e a execução. `start` só é chamado se tudo conferir. Devolve se iniciou.
        public static bool TryLaunch(UpdateResult r, Action<string> start, Action<string> status)
        {
            if (r == null || r.Outcome != UpdateOutcome.Ready || string.IsNullOrEmpty(r.InstallerPath)) return false;
            bool mismatch = false;
            try
            {
                using (var fs = new FileStream(r.InstallerPath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    string hash = null;
                    if (fs.Length == r.ExpectedSize)
                    {
                        using (var sha = System.Security.Cryptography.SHA256.Create())
                        {
                            var h = sha.ComputeHash(fs);
                            var sb = new StringBuilder(h.Length * 2);
                            foreach (var x in h) sb.Append(x.ToString("X2"));
                            hash = sb.ToString();
                        }
                    }
                    if (hash == null || !string.Equals(hash, r.ExpectedSha256, StringComparison.OrdinalIgnoreCase)) mismatch = true;
                    else
                    {
                        status?.Invoke("Instalando atualização " + r.Version + "...");
                        start(r.InstallerPath);
                        return true;
                    }
                }
            }
            catch (Exception ex)
            {
                status?.Invoke("Erro ao iniciar o instalador: " + ex.Message);
                return false;
            }
            if (mismatch) Refuse(r, status); // handle já fechado: dá para apagar
            return false;
        }

        static void Refuse(UpdateResult r, Action<string> status)
        {
            try { File.Delete(r.InstallerPath); } catch { }
            status?.Invoke("O instalador mudou depois de verificado. Descartado, nada foi executado.");
        }

        static UpdateResult Res(UpdateOutcome o, string msg) { return new UpdateResult { Outcome = o, Message = msg }; }
        static void TryDelete(string p) { try { if (p != null && File.Exists(p)) File.Delete(p); } catch { } }

        // Instaladores e .part antigos não ficam acumulando.
        static void Cleanup(string dir)
        {
            try { foreach (var f in Directory.GetFiles(dir)) TryDelete(f); } catch { }
        }
    }
}
