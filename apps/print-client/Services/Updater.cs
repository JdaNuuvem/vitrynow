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
        public const string CurrentVersion = "1.0.0";
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

                try
                {
                    // Reconfere logo antes de executar (a pasta é do usuário, mas o custo é pequeno).
                    StatusChanged?.Invoke("Instalando atualização " + r.Version + "...");
                    Process.Start(r.InstallerPath);
                }
                catch (Exception ex)
                {
                    Logger.Error("Não foi possível iniciar o instalador", ex);
                    StatusChanged?.Invoke("Erro ao iniciar o instalador: " + ex.Message);
                }
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
                    Message = "Atualização " + m.Version + " verificada." };
            }
            catch (Exception ex)
            {
                TryDelete(part);
                return Res(UpdateOutcome.Failed, "Falha ao baixar a atualização: " + ex.Message);
            }
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
