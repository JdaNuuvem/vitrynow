using System;
using System.Diagnostics;
using System.IO;
using System.Net;

namespace MeuCardapio.PrintClient.Services
{
    // Auto-update apontando para o NOSSO servidor de downloads (não cardapio.ai/S3 deles).
    // Convenção: em UpdateBaseUrl ficam dois arquivos lado a lado:
    //   version.txt         -> versão mais recente publicada, ex. "1.1.0"
    //   InstallerFileName    -> o instalador .exe dessa versão
    // AppSettings.UpdateBaseUrl fica vazio por padrão (auto-update desligado) até você publicar
    // esses dois arquivos num domínio/CDN próprio e configurar a URL.
    public static class Updater
    {
        public const string CurrentVersion = "1.0.0";
        public static string InstallerFileName { get; set; } = "MeuCardapio-PrintClient-Setup.exe";

        public static event Action<string> StatusChanged;

        public static bool IsConfigured => !string.IsNullOrWhiteSpace(AppSettings.Current.UpdateBaseUrl);

        public static void CheckForUpdate()
        {
            if (!IsConfigured)
            {
                StatusChanged?.Invoke("Auto-update não configurado.");
                return;
            }

            string baseUrl = AppSettings.Current.UpdateBaseUrl.TrimEnd('/') + "/";

            try
            {
                using (var wc = new WebClient())
                {
                    string remoteVersion;
                    try
                    {
                        remoteVersion = wc.DownloadString(baseUrl + "version.txt")?.Trim();
                    }
                    catch
                    {
                        remoteVersion = null;
                    }

                    if (string.IsNullOrEmpty(remoteVersion) || Compare(remoteVersion, CurrentVersion) <= 0)
                    {
                        StatusChanged?.Invoke("Você já está na versão mais recente (" + CurrentVersion + ").");
                        return;
                    }

                    StatusChanged?.Invoke("Nova versão " + remoteVersion + " disponível. Baixando...");
                    string tmp = Path.Combine(Path.GetTempPath(), InstallerFileName);
                    wc.DownloadFile(baseUrl + Uri.EscapeDataString(InstallerFileName), tmp);

                    if (File.Exists(tmp))
                    {
                        StatusChanged?.Invoke("Instalando atualização...");
                        Process.Start(tmp);
                    }
                }
            }
            catch (Exception ex)
            {
                StatusChanged?.Invoke("Erro ao verificar atualização: " + ex.Message);
            }
        }

        // Compara "1.2.0" com "1.10.0" corretamente (não como string nem como double).
        static int Compare(string a, string b)
        {
            var pa = ParseParts(a);
            var pb = ParseParts(b);
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int va = i < pa.Length ? pa[i] : 0;
                int vb = i < pb.Length ? pb[i] : 0;
                if (va != vb) return va.CompareTo(vb);
            }
            return 0;
        }

        static int[] ParseParts(string v)
        {
            var parts = (v ?? "0").Split('.');
            var result = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++)
                int.TryParse(parts[i], out result[i]);
            return result;
        }
    }
}
