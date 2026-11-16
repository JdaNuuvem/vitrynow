using System;
using System.IO;
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
    }

    // Chave PÚBLICA de release embutida no binário (nunca vem do settings.json: quem edita o
    // arquivo não pode trocar a chave). Vazia = auto-update recusa tudo até a chave de release
    // ser provisionada (tools\new-update-key.ps1). A chave privada NUNCA entra no repositório.
    public static class UpdateKeys
    {
        public const string PublicKeyXml = "";
    }

    public static class UpdateVerifier
    {
        public const int MinKeyBits = 3072;
        public const long MaxInstallerBytes = 200L * 1024 * 1024;
        public const int MaxManifestBytes = 16 * 1024;

        static readonly Regex VersionRx = new Regex(@"^\d{1,5}(\.\d{1,5}){1,3}$", RegexOptions.Compiled);
        static readonly Regex Sha256Rx = new Regex(@"^[0-9a-fA-F]{64}$", RegexOptions.Compiled);
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
