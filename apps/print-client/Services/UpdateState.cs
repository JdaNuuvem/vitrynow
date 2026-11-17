using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace MeuCardapio.PrintClient.Services
{
    // O que o updater já aprendeu de manifestos AUTÊNTICOS (PC-11): o maior issuedAt aceito (anti-replay
    // de manifesto antigo) e as chaves que um manifesto de reserva revogou. Arquivo local, fora da pasta
    // de updates (que é limpa a cada verificação). Corrompido/ausente = estado vazio (nunca trava o app).
    public sealed class UpdateState
    {
        [JsonProperty("maxIssuedAt")] public DateTime? MaxIssuedAtUtc { get; set; }
        [JsonProperty("revokedKeys")] public List<string> RevokedKeys { get; set; } = new List<string>();

        public static UpdateState Load(string path)
        {
            try
            {
                if (path != null && File.Exists(path))
                {
                    var s = JsonConvert.DeserializeObject<UpdateState>(File.ReadAllText(path));
                    if (s != null) { if (s.RevokedKeys == null) s.RevokedKeys = new List<string>(); return s; }
                }
            }
            catch { }
            return new UpdateState();
        }

        // Escrita atômica (.tmp + troca), como o settings.json.
        public bool Save(string path)
        {
            var tmp = path + ".tmp";
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(tmp, JsonConvert.SerializeObject(this, Formatting.Indented));
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
    }
}
