using System;
using System.IO;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Services
{
    // Settings locais do print-client — nada aqui aponta para o cardapio.ai: ApiBaseUrl é a URL
    // do NOSSO backend (apps/api) e DeviceToken é a "chave de impressora" emitida no NOSSO painel.
    public class AppSettings
    {
        public string ApiBaseUrl { get; set; } = "http://localhost:3001";
        public string DeviceToken { get; set; } = "";
        // URL do servidor de downloads (nosso, não cardapio.ai) onde version.txt + instalador
        // ficam publicados. Vazio = auto-update desligado (padrão até você publicar isso).
        public string UpdateBaseUrl { get; set; } = "";
        public bool ReceivePrints { get; set; } = true;
        public bool ReceiveAlerts { get; set; } = true;
        public int FontSize { get; set; } = 12;
        public int PaperWidthMm { get; set; } = 57;
        public string SelectedPrinter { get; set; } = "";
        public int DropdownPrintIndex { get; set; } = 0;
        public int SoundVolume { get; set; } = 100;
        public int DropdownIndex { get; set; } = 1; // 1=Sino 2=Padrão 3=Custom
        public string CustomSound { get; set; } = "";

        public static readonly string BaseDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeuCardapioPrintClient");
        public static readonly string FilePath = Path.Combine(BaseDirectory, "settings.json");

        static AppSettings _current;
        public static AppSettings Current => _current ?? (_current = Load());

        public static AppSettings Load()
        {
            try
            {
                if (File.Exists(FilePath))
                    return JsonConvert.DeserializeObject<AppSettings>(File.ReadAllText(FilePath)) ?? new AppSettings();
            }
            catch { /* settings corrompidas -> padrões */ }
            return new AppSettings();
        }

        public static void Save()
        {
            try
            {
                Directory.CreateDirectory(BaseDirectory);
                File.WriteAllText(FilePath, JsonConvert.SerializeObject(_current, Formatting.Indented));
            }
            catch { /* sem permissão -> mantém em memória */ }
        }

        public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiBaseUrl) && !string.IsNullOrWhiteSpace(DeviceToken);
    }
}
