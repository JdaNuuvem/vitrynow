using System;
using System.IO;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Services
{
    // Como terminou a migração do token em texto puro (settings.json de versões antigas).
    public enum TokenMigration
    {
        None,        // nada a migrar
        Protected,   // migrou e regravou o arquivo já protegido (a chave antiga circulou em texto puro: girar)
        SaveFailed,  // não conseguiu regravar: o texto puro CONTINUA no disco; tenta de novo no próximo início
    }

    // Settings locais do print-client — nada aqui aponta para um serviço de terceiro: ApiBaseUrl é a URL
    // do NOSSO backend (apps/api) e DeviceToken é a "chave de impressora" emitida no NOSSO painel.
    public class AppSettings
    {
        public string ApiBaseUrl { get; set; } = "http://localhost:3001";
        // A chave de impressora NUNCA vai em texto puro para o disco: só `DeviceTokenProtected`
        // (DPAPI, usuário atual) é gravado. `DeviceToken` vive só em memória.
        [JsonIgnore] public string DeviceToken { get; set; } = "";

        [JsonProperty("DeviceTokenProtected")]
        public string DeviceTokenProtected
        {
            get { return SecretStore.Protect(DeviceToken); }
            set
            {
                // Valor vazio/ilegível (outro usuário, arquivo editado) não apaga um token legado
                // que já foi lido, qualquer que seja a ordem das propriedades no JSON.
                var token = SecretStore.Unprotect(value);
                if (string.IsNullOrEmpty(token)) return;
                DeviceToken = token;
                MigratedFromPlaintext = false; // o protegido vale mais que o legado
            }
        }

        // Migração: settings.json antigos tinham "DeviceToken" em texto puro. Só leitura; ao
        // carregar, o valor entra em memória e o arquivo é regravado já protegido (LoadFrom).
        [JsonProperty("DeviceToken")]
        string LegacyDeviceToken
        {
            set
            {
                if (!string.IsNullOrEmpty(value) && string.IsNullOrEmpty(DeviceToken))
                {
                    DeviceToken = value;
                    MigratedFromPlaintext = true;
                }
            }
        }

        [JsonIgnore] public bool MigratedFromPlaintext { get; private set; }
        [JsonIgnore] public TokenMigration Migration { get; private set; }

        // URL do servidor de downloads (nosso, não de terceiro) onde version.txt + instalador
        // ficam publicados. Vazio = auto-update desligado (padrão até você publicar isso).
        public string UpdateBaseUrl { get; set; } = "";
        public bool ReceivePrints { get; set; } = true;
        // PC-03: consome a fila de PrintJob (claim/ack, ADR-0004) em vez de /api/device/orders/pending. DESLIGADO por padrão
        // até a API-12 existir e as lojas-piloto migrarem (o endpoint antigo some depois, D4-4).
        public bool UsePrintJobs { get; set; } = false;
        public bool ReceiveAlerts { get; set; } = true;
        public int FontSize { get; set; } = 12;
        public int PaperWidthMm { get; set; } = 57;
        public string SelectedPrinter { get; set; } = "";
        // Se preenchida, os tíquetes vão para esta pasta (txt + png) em vez da impressora: conferir o layout sem gastar bobina.
        public string VirtualPrinterFolder { get; set; } = "";
        public int DropdownPrintIndex { get; set; } = 0;
        public int SoundVolume { get; set; } = 100;
        public int DropdownIndex { get; set; } = 1; // 1=Sino 2=Padrão 3=Custom
        public string CustomSound { get; set; } = "";

        public static readonly string BaseDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MeuCardapioPrintClient");
        public static readonly string FilePath = Path.Combine(BaseDirectory, "settings.json");
        public static readonly string LedgerPath = Path.Combine(BaseDirectory, "printed.json");

        static AppSettings _current;
        public static AppSettings Current => _current ?? (_current = Load());

        public static AppSettings Load() { return LoadFrom(FilePath); }

        public static AppSettings LoadFrom(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    var loaded = JsonConvert.DeserializeObject<AppSettings>(File.ReadAllText(path)) ?? new AppSettings();
                    if (loaded.MigratedFromPlaintext)
                        loaded.Migration = SaveTo(path, loaded) ? TokenMigration.Protected : TokenMigration.SaveFailed;
                    return loaded;
                }
            }
            catch { /* settings corrompidas -> padrões */ }
            return new AppSettings();
        }

        // Devolve false se não conseguiu gravar (quem chama avisa o usuário).
        public static bool Save() { return SaveTo(FilePath, _current); }

        // Escrita atômica: grava um .tmp completo e só então troca o arquivo. Uma queda no meio
        // deixa o settings.json anterior intacto (antes, WriteAllText direto podia truncá-lo e
        // perder a chave).
        public static bool SaveTo(string path, AppSettings settings)
        {
            if (settings == null) return false;
            var tmp = path + ".tmp";
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(tmp, JsonConvert.SerializeObject(settings, Formatting.Indented));
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
                return true;
            }
            catch
            {
                try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
                return false;
            }
        }

        // Configurado = tem chave E uma URL aceita pela política (http só para localhost).
        // Settings antigos com URL insegura caem em "não configurado" e pedem a configuração.
        public bool IsConfigured => ApiUrlPolicy.IsAllowed(ApiBaseUrl) && !string.IsNullOrWhiteSpace(DeviceToken);
    }
}
