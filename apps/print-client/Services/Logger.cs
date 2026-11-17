using System;
using System.IO;

namespace MeuCardapio.PrintClient.Services
{
    // Log persistente em arquivo — antes disso, todo erro só existia como um Toast que
    // desaparece (a janela fica minimizada na bandeja na operação normal). Sem isso, um
    // problema de impressão era impossível de investigar depois do fato.
    public static class Logger
    {
        static readonly object _lock = new object();
        static readonly string LogDir = Path.Combine(AppSettings.BaseDirectory, "logs");
        static readonly string LogPath = Path.Combine(LogDir, "print-client.log");
        const long MaxSizeBytes = 5 * 1024 * 1024; // 5 MB — depois disso, rotaciona pra .old (1 geração só)

        // So os testes usam: recebe cada linha ("INFO ..."/"ERROR ...") para provar o que o app GRAVA no log (o alerta de operacao depende do texto).
        internal static Action<string> Sink;

        public static void Info(string message) => Write("INFO", message);
        public static void Error(string message) => Write("ERROR", message);
        public static void Error(string message, Exception ex) => Write("ERROR", message + " — " + ex);

        static void Write(string level, string message)
        {
            try { var sink = Sink; if (sink != null) sink(level + " " + message); } catch { }
            try
            {
                lock (_lock)
                {
                    Directory.CreateDirectory(LogDir);
                    RotateIfNeeded();
                    File.AppendAllText(LogPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{level}] {message}{Environment.NewLine}");
                }
            }
            catch
            {
                // Logging nunca pode ser o motivo de o app quebrar — se não conseguir escrever
                // (disco cheio, permissão), só desiste silenciosamente dessa linha.
            }
        }

        static void RotateIfNeeded()
        {
            if (!File.Exists(LogPath)) return;
            if (new FileInfo(LogPath).Length < MaxSizeBytes) return;

            string oldPath = LogPath + ".old";
            try
            {
                if (File.Exists(oldPath)) File.Delete(oldPath);
                File.Move(LogPath, oldPath);
            }
            catch { /* falha ao rotacionar não deve impedir o log atual */ }
        }
    }
}
