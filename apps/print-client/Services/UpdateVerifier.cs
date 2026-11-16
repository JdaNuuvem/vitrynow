using System;
using System.IO;
using System.Collections.Generic;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Services
{
    // Manifesto de release publicado ao lado do instalador (PC-04, B17):
    //   latest.json      {"version","file","sha256","size"}
    //   latest.json.sig  assinatura RSA-SHA256 (base64) dos bytes EXATOS de latest.json
    // O hash do instalador está dentro do manifesto assinado: trocar o .exe no servidor sem a
    // chave privada de release faz a verificação falhar e nada é executado.
    public sealed class UpdateManifest
    {
        [JsonProperty("version")] public string Version { get; set; }
        [JsonProperty("file")] public string File { get; set; }
        [JsonProperty("sha256")] public string Sha256 { get; set; }
        [JsonProperty("size")] public long Size { get; set; }
        // PC-11 (Nightingale R1/R2): quem assinou, frescor, versão mínima e revogação de chaves antigas.
        [JsonProperty("keyId")] public string KeyId { get; set; }
        [JsonProperty("issuedAt")] public string IssuedAt { get; set; }       // 2026-11-16T12:00:00Z
        [JsonProperty("validUntil")] public string ValidUntil { get; set; }   // janela generosa (ex.: 60 dias)
        [JsonProperty("minVersion")] public string MinVersion { get; set; }   // abaixo dela o app avisa que precisa atualizar
        [JsonProperty("revokeKeys")] public List<string> RevokeKeys { get; set; }
        [JsonIgnore] public DateTime IssuedAtUtc { get; set; }
        [JsonIgnore] public DateTime ValidUntilUtc { get; set; }
    }

    public sealed class TrustedKey
    {
        public readonly string KeyId;
        public readonly string PublicKeyXml;
        public TrustedKey(string keyId, string publicKeyXml) { KeyId = keyId; PublicKeyXml = publicKeyXml; }
    }

    // Chaves PÚBLICAS de release embutidas no binário (nunca vêm do settings.json: quem edita o arquivo
    // não troca a chave). A ORDEM importa: a 1ª é a primária (assina o dia a dia); as seguintes são
    // reservas guardadas offline. Uma chave só pode revogar chaves ANTERIORES na lista (a reserva revoga
    // a primária; a primária nunca revoga a reserva). Lista vazia = auto-update recusa tudo até a chave de
    // release ser provisionada (tools\new-update-key.ps1; custódia: Claudio, CL-10). A chave privada NUNCA
    // entra no repositório. Exemplo (cole a saída do script):
    //   new TrustedKey("k1", "<RSAKeyValue>...</RSAKeyValue>"),   // primária
    //   new TrustedKey("k2", "<RSAKeyValue>...</RSAKeyValue>"),   // reserva offline
    public static class UpdateKeys
    {
        public static readonly TrustedKey[] Trusted = new TrustedKey[]
        {
        };
    }

    public static class UpdateVerifier
    {
        public const int MinKeyBits = 3072;
        public const long MaxInstallerBytes = 200L * 1024 * 1024;
        public const int MaxManifestBytes = 16 * 1024;

        static readonly Regex VersionRx = new Regex(@"^\d{1,5}(\.\d{1,5}){1,3}$", RegexOptions.Compiled);
        static readonly Regex Sha256Rx = new Regex(@"^[0-9a-fA-F]{64}$", RegexOptions.Compiled);
        static readonly Regex KeyIdRx = new Regex(@"^[A-Za-z0-9_-]{1,32}$", RegexOptions.Compiled);
        public const string TimeFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";
        public static readonly TimeSpan MaxValidity = TimeSpan.FromDays(400);
        // Relógio de PC de restaurante erra; só desconfia do relógio acima disso.
        public static readonly TimeSpan ClockTolerance = TimeSpan.FromDays(1);

        public static bool IsValidKeyId(string id) { return id != null && KeyIdRx.IsMatch(id); }

        static bool TryTime(string text, out DateTime utc)
        {
            return DateTime.TryParseExact(text ?? "", TimeFormat, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out utc);
        }

        static readonly Regex FileRx = new Regex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.exe$", RegexOptions.Compiled);

        // null = aceita; senão, o motivo. https:// sempre; http:// só em loopback (testes locais).
        public static string ValidateBaseUrl(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return "URL de atualização não configurada.";
            Uri uri;
            if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out uri)) return "A URL de atualização não é válida.";
            if (!string.IsNullOrEmpty(uri.UserInfo)) return "A URL de atualização não pode conter usuário e senha.";
            if (!string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return "A URL de atualização não pode ter parâmetros.";
            if (uri.Scheme == Uri.UriSchemeHttps) return null;
            if (uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback) return null;
            return "A atualização só é aceita por https:// (http:// apenas em localhost).";
        }

        public static bool IsValidVersion(string v) { return v != null && VersionRx.IsMatch(v); }

        // "1.2.0" x "1.10.0" por partes numéricas (não como texto). Versão inválida = -2.
        public static int CompareVersions(string a, string b)
        {
            if (!IsValidVersion(a) || !IsValidVersion(b)) return -2;
            var pa = a.Split('.'); var pb = b.Split('.');
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int va = i < pa.Length ? int.Parse(pa[i]) : 0;
                int vb = i < pb.Length ? int.Parse(pb[i]) : 0;
                if (va != vb) return va.CompareTo(vb);
            }
            return 0;
        }

        // Confere assinatura RSA PKCS#1 v1.5 / SHA-256. Chave ausente, curta ou inválida => false.
        public static bool VerifySignature(byte[] manifestBytes, string signatureBase64, string publicKeyXml)
        {
            if (manifestBytes == null || string.IsNullOrWhiteSpace(signatureBase64) || string.IsNullOrWhiteSpace(publicKeyXml)) return false;
            byte[] sig;
            try { sig = Convert.FromBase64String(signatureBase64.Trim()); } catch { return false; }
            try
            {
                using (var rsa = new RSACryptoServiceProvider())
                {
                    rsa.PersistKeyInCsp = false;
                    rsa.FromXmlString(publicKeyXml);
                    if (rsa.KeySize < MinKeyBits) return false;
                    return rsa.VerifyData(manifestBytes, CryptoConfig.MapNameToOID("SHA256"), sig);
                }
            }
            catch { return false; }
        }

        // Valida campo a campo; devolve null e o motivo em `error` se qualquer coisa estiver fora do padrão.
        public static UpdateManifest ParseManifest(byte[] json, out string error)
        {
            error = null;
            if (json == null || json.Length == 0 || json.Length > MaxManifestBytes) { error = "manifesto vazio ou grande demais"; return null; }
            UpdateManifest m;
            try { m = JsonConvert.DeserializeObject<UpdateManifest>(new UTF8Encoding(false, true).GetString(json)); }
            catch { error = "manifesto ilegível"; return null; }
            if (m == null) { error = "manifesto vazio"; return null; }
            if (!IsValidVersion(m.Version)) { error = "versão inválida no manifesto"; return null; }
            if (m.File == null || !FileRx.IsMatch(m.File) || m.File.Contains("..") || IsReservedName(m.File)) { error = "nome de arquivo inválido no manifesto"; return null; }
            if (m.Sha256 == null || !Sha256Rx.IsMatch(m.Sha256)) { error = "hash inválido no manifesto"; return null; }
            if (m.Size <= 0 || m.Size > MaxInstallerBytes) { error = "tamanho inválido no manifesto"; return null; }
            if (!IsValidKeyId(m.KeyId)) { error = "keyId inválido no manifesto"; return null; }
            DateTime issued, until;
            if (!TryTime(m.IssuedAt, out issued) || !TryTime(m.ValidUntil, out until)) { error = "datas inválidas no manifesto (use yyyy-MM-ddTHH:mm:ssZ)"; return null; }
            if (until <= issued || until - issued > MaxValidity) { error = "janela de validade inválida no manifesto"; return null; }
            m.IssuedAtUtc = issued; m.ValidUntilUtc = until;
            if (m.MinVersion != null && (!IsValidVersion(m.MinVersion) || CompareVersions(m.MinVersion, m.Version) > 0)) { error = "minVersion inválida no manifesto"; return null; }
            if (m.RevokeKeys != null)
            {
                if (m.RevokeKeys.Count > 8 || m.RevokeKeys.Exists(k => !IsValidKeyId(k)) || m.RevokeKeys.Contains(m.KeyId)) { error = "revokeKeys inválido no manifesto"; return null; }
            }
            m.Sha256 = m.Sha256.ToUpperInvariant();
            return m;
        }

        static readonly Regex ReservedRx = new Regex(@"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
        // Nomes de dispositivo do Windows (CON.exe, NUL.exe, ...) não viram arquivo comum.
        public static bool IsReservedName(string file) { return file != null && ReservedRx.IsMatch(file); }

        public static string Sha256Hex(string path)
        {
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var sha = SHA256.Create())
            {
                var h = sha.ComputeHash(fs);
                var sb = new StringBuilder(h.Length * 2);
                foreach (var b in h) sb.Append(b.ToString("X2"));
                return sb.ToString();
            }
        }

        public static bool VerifyFile(string path, UpdateManifest m)
        {
            try
            {
                var fi = new FileInfo(path);
                if (!fi.Exists || fi.Length != m.Size) return false;
                return string.Equals(Sha256Hex(path), m.Sha256, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }
    }
}
